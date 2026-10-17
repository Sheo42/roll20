// ==UserScript==
// @name         Roll20 : synchro des scripts API avec GitHub
// @namespace    https://github.com/Sheo42/roll20
// @version      1.0.0
// @description  Bouton « GitHub » sur la page des scripts API Roll20 : compare chaque script au dépôt Sheo42/roll20 et met à jour ceux qui ont changé.
// @match        https://app.roll20.net/campaigns/scripts/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Sheo42/roll20/main/sync/roll20-github-sync.user.js
// @downloadURL  https://raw.githubusercontent.com/Sheo42/roll20/main/sync/roll20-github-sync.user.js
// ==/UserScript==

// Fonctionnement :
// - lit la liste des fichiers .js du dossier scripts/ du dépôt, au dernier commit de la branche main
//   (adresse figée par le commit : pas de copie périmée en cache) ;
// - associe chaque fichier à l'onglet de script Roll20 du même nom (casse, espaces, tirets et accents
//   ignorés : « token tool.js » = token-tool.js, « TokenInfo.js » = tokeninfo.js) ;
// - montre pour chacun : à jour, modifié (+lignes / -lignes), ou absent du jeu ; les scripts de la
//   bibliothèque Roll20 (one-click) et les onglets sans fichier dans le dépôt ne sont jamais touchés ;
// - « Mettre à jour » remplace le contenu des onglets cochés (et crée ceux à installer) avec le bouton
//   « Save Mod Script » de Roll20 lui-même, un script par chargement de page (Roll20 recharge la page
//   après chaque enregistrement), puis vérifie après le rechargement que le contenu enregistré est bien
//   celui du dépôt. Au premier écart, la synchro s'arrête et le dit.
// Chaque enregistrement redémarre le sandbox API, comme un enregistrement à la main.

var R20Sync = (function () {
  'use strict';
  var REPO = 'Sheo42/roll20', BRANCH = 'main', DIR = 'scripts';

  // nom comparable : « token tool.js », « Token-Tool.js » et « tokentool » se valent
  function normName(n) {
    return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/\.js$/, '').replace(/[^a-z0-9]/g, '');
  }
  // texte comparable : fins de ligne unifiées, blancs de fin ignorés
  function normText(t) {
    return String(t == null ? '' : t).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  }
  // lignes ajoutées / retirées (comptage par multiensemble, sans tenir compte de l'ordre)
  function lineDiff(oldText, newText) {
    var count = {}, added = 0, removed = 0;
    normText(oldText).split('\n').forEach(function (l) { count[l] = (count[l] || 0) + 1; });
    normText(newText).split('\n').forEach(function (l) { if (count[l]) count[l]--; else added++; });
    Object.keys(count).forEach(function (l) { removed += count[l]; });
    return { added: added, removed: removed };
  }
  // fichiers du dépôt à synchroniser (pas les tests)
  function repoFiles(listing) {
    return (listing || []).filter(function (f) {
      return f && f.type === 'file' && /\.js$/i.test(f.name) && !/\.test\.js$/i.test(f.name);
    }).map(function (f) { return f.name; }).sort();
  }

  // tabs : [{id, name, content}] (scripts utilisateur seulement) ; files : [{file, content}]
  // -> {rows: [{file, tabId, tabName, status, added, removed}], extra: [noms d'onglets sans fichier]}
  function plan(tabs, files) {
    var byName = {};
    tabs.forEach(function (t) { (byName[normName(t.name)] = byName[normName(t.name)] || []).push(t); });
    var used = {};
    var rows = files.map(function (f) {
      var hits = byName[normName(f.file)] || [];
      hits.forEach(function (t) { used[t.id] = true; });
      if (hits.length > 1) {
        return { file: f.file, tabId: null, tabName: hits.map(function (t) { return t.name; }).join(', '), status: 'ambiguous', added: 0, removed: 0 };
      }
      if (!hits.length) {
        var d0 = lineDiff('', f.content);
        return { file: f.file, tabId: null, tabName: null, status: 'new', added: d0.added, removed: 0, content: f.content };
      }
      var t = hits[0];
      if (normText(t.content) === normText(f.content)) {
        return { file: f.file, tabId: t.id, tabName: t.name, status: 'same', added: 0, removed: 0 };
      }
      var d = lineDiff(t.content, f.content);
      return { file: f.file, tabId: t.id, tabName: t.name, status: 'changed', added: d.added, removed: d.removed, content: f.content };
    });
    var extra = tabs.filter(function (t) { return !used[t.id]; }).map(function (t) { return t.name; });
    return { rows: rows, extra: extra };
  }

  // file d'attente des enregistrements, gardée entre deux chargements de page
  function makeQueue(campaign, sha, rows) {
    return {
      campaign: String(campaign), sha: sha, i: 0, pending: null, results: [],
      items: rows.filter(function (r) { return r.status === 'changed' || r.status === 'new'; }).map(function (r) {
        return r.status === 'new'
          ? { kind: 'install', tabId: 'new', name: r.file, file: r.file, content: r.content }
          : { kind: 'update', tabId: r.tabId, name: r.tabName, file: r.file, content: r.content };
      })
    };
  }
  // l'enregistrement d'un élément est-il visible sur la page rechargée ?
  function verify(item, tabs) {
    var t = item.kind === 'update'
      ? tabs.filter(function (x) { return String(x.id) === String(item.tabId); })[0]
      : tabs.filter(function (x) { return normName(x.name) === normName(item.name); })[0];
    return !!t && normText(t.content) === normText(item.content);
  }

  // Avance la file d'un pas. env : {campaign, tabs(), save(item), store, reload(), later(fn, ms), now(), report(q, done)}
  // Renvoie 'idle' | 'saving' | 'done' | 'failed' | 'other-campaign'.
  var PENDING_TIMEOUT = 20000;
  function step(env) {
    var q = env.store.get();
    if (!q) return 'idle';
    if (q.campaign !== String(env.campaign)) return 'other-campaign';
    if (q.pending) {
      var item = q.items[q.pending.i];
      var ok = verify(item, env.tabs());
      q.results.push({ file: item.file, kind: item.kind, ok: ok });
      q.pending = null;
      q.i++;
      if (!ok) { env.store.del(); env.report(q, 'failed'); return 'failed'; }
    }
    if (q.i >= q.items.length) { env.store.del(); env.report(q, 'done'); return 'done'; }
    q.pending = { i: q.i, t: env.now() };
    env.store.set(q);
    env.report(q, 'saving');
    env.save(q.items[q.i]);
    // si Roll20 ne recharge pas la page, on la recharge nous-mêmes pour vérifier et continuer
    env.later(function () { env.reload(); }, PENDING_TIMEOUT);
    return 'saving';
  }

  return { REPO: REPO, BRANCH: BRANCH, DIR: DIR, normName: normName, normText: normText, lineDiff: lineDiff,
    repoFiles: repoFiles, plan: plan, makeQueue: makeQueue, verify: verify, step: step };
})();

if (typeof module !== 'undefined') module.exports = R20Sync;

(function () {
  'use strict';
  if (typeof GM_xmlhttpRequest !== 'function' || typeof document === 'undefined') return;
  var S = R20Sync;
  var W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  var m = /\/campaigns\/scripts\/(\d+)/.exec(location.pathname);
  if (!m) return;
  var CAMPAIGN = m[1];
  var KEY = 'r20sync-queue';
  var store = {
    get: function () { var v = GM_getValue(KEY, null); return v ? JSON.parse(v) : null; },
    set: function (q) { GM_setValue(KEY, JSON.stringify(q)); },
    del: function () { GM_deleteValue(KEY); }
  };

  // ---------- page Roll20 ----------
  function userTabs() {
    var out = [];
    document.querySelectorAll('.nav-tabs a[href^="#script-"]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (href === '#script-library' || href === '#script-new') return;
      var pane = document.querySelector(href);
      var input = pane && pane.querySelector('input[type=text]');
      var ed = pane && pane.querySelector('.editor');
      if (!input || !ed) return; // script de la bibliothèque Roll20 : pas d'éditeur
      // contenu enregistré chez Roll20 (le textarea caché de l'onglet), sinon celui de l'éditeur
      var saved = pane.querySelector('textarea:not(.ace_text-input)');
      out.push({ id: href.replace('#script-', ''), name: input.value, content: saved ? saved.value : W.ace.edit(ed).getValue() });
    });
    return out;
  }
  function saveTab(item) {
    var pane = document.getElementById('script-' + item.tabId);
    if (!pane) throw new Error('onglet introuvable : ' + item.tabId);
    if (item.kind === 'install') pane.querySelector('input[type=text]').value = item.name;
    W.ace.edit(pane.querySelector('.editor')).setValue(item.content, -1);
    // sans ancre dans l'adresse, le rechargement que fait Roll20 recharge vraiment la page
    history.replaceState(null, '', location.pathname + location.search);
    pane.querySelector('.savescript').click();
  }
  function ready(cb, tries) {
    tries = tries || 0;
    if (W.ace && document.querySelector('.nav-tabs a[href^="#script-"]') && document.querySelector('.ace_editor')) { cb(); return; }
    if (tries > 40) return;
    setTimeout(function () { ready(cb, tries + 1); }, 250);
  }

  // ---------- GitHub ----------
  function get(url, json) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET', url: url, headers: json ? { Accept: 'application/vnd.github+json' } : {},
        onload: function (r) {
          if (r.status !== 200) { reject(new Error(url.replace(/^https:\/\/[^/]+/, '') + ' : HTTP ' + r.status)); return; }
          try { resolve(json ? JSON.parse(r.responseText) : r.responseText); } catch (e) { reject(e); }
        },
        onerror: function () { reject(new Error('réseau : ' + url)); }
      });
    });
  }
  function fetchRepo() {
    var api = 'https://api.github.com/repos/' + S.REPO;
    return get(api + '/commits/' + S.BRANCH, true).then(function (c) {
      var sha = c.sha;
      return get(api + '/contents/' + S.DIR + '?ref=' + sha, true).then(function (list) {
        var names = S.repoFiles(list);
        return Promise.all(names.map(function (n) {
          return get('https://raw.githubusercontent.com/' + S.REPO + '/' + sha + '/' + S.DIR + '/' + n, false)
            .then(function (t) { return { file: n, content: t }; });
        })).then(function (files) { return { sha: sha, files: files }; });
      });
    });
  }

  // ---------- interface ----------
  var css = 'position:fixed;z-index:100000;font:13px/1.4 sans-serif;';
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function panel() {
    var old = document.getElementById('r20sync-panel');
    if (old) old.remove();
    var p = el('div', { id: 'r20sync-panel', style: css + 'right:16px;bottom:64px;max-width:640px;max-height:70vh;overflow:auto;background:#fff;color:#222;border:1px solid #999;border-radius:6px;padding:12px;box-shadow:0 4px 16px rgba(0,0,0,.3);' });
    document.body.appendChild(p);
    return p;
  }
  function button(text, onClick, primary) {
    var b = el('button', { type: 'button', style: 'margin:8px 8px 0 0;padding:4px 10px;border-radius:4px;border:1px solid #888;cursor:pointer;' + (primary ? 'background:#2a6ebb;color:#fff;border-color:#2a6ebb;' : 'background:#eee;') }, text);
    b.addEventListener('click', onClick);
    return b;
  }
  var LABEL = { same: 'à jour', changed: 'modifié', new: 'absent du jeu : à installer', ambiguous: 'plusieurs onglets portent ce nom : ignoré' };

  function showPlan() {
    var p = panel();
    p.appendChild(el('div', {}, 'Lecture du dépôt ' + S.REPO + '…'));
    fetchRepo().then(function (repo) {
      var res = S.plan(userTabs(), repo.files);
      p.textContent = '';
      p.appendChild(el('b', {}, 'GitHub ' + S.REPO + ' @ ' + repo.sha.slice(0, 7)));
      var table = el('table', { style: 'border-collapse:collapse;margin-top:8px;width:100%;' });
      var checks = [];
      res.rows.forEach(function (r) {
        var tr = el('tr', { style: 'border-top:1px solid #ddd;' });
        var td0 = el('td', { style: 'padding:3px 6px;' });
        if (r.status === 'changed' || r.status === 'new') {
          var cb = el('input', { type: 'checkbox' });
          cb.checked = r.status === 'changed';
          checks.push({ cb: cb, row: r });
          td0.appendChild(cb);
        }
        tr.appendChild(td0);
        tr.appendChild(el('td', { style: 'padding:3px 6px;' }, r.file));
        tr.appendChild(el('td', { style: 'padding:3px 6px;color:#555;' }, r.tabName || '—'));
        var txt = LABEL[r.status] + (r.status === 'changed' ? ' : +' + r.added + ' / -' + r.removed + ' lignes' : '');
        tr.appendChild(el('td', { style: 'padding:3px 6px;' + (r.status === 'same' ? 'color:#2a7a2a;' : 'color:#b05a00;') }, txt));
        table.appendChild(tr);
      });
      p.appendChild(table);
      if (res.extra.length) p.appendChild(el('div', { style: 'margin-top:8px;color:#555;' }, 'Onglets sans fichier dans le dépôt (non touchés) : ' + res.extra.join(', ')));
      p.appendChild(el('div', { style: 'margin-top:8px;color:#555;' }, 'Chaque enregistrement redémarre le sandbox API et recharge la page.'));
      p.appendChild(button('Mettre à jour la sélection', function () {
        var rows = checks.filter(function (c) { return c.cb.checked; }).map(function (c) { return c.row; });
        if (!rows.length) return;
        store.set(S.makeQueue(CAMPAIGN, repo.sha, rows));
        run();
      }, true));
      p.appendChild(button('Fermer', function () { p.remove(); }));
    }).catch(function (e) {
      p.textContent = 'Échec de la lecture du dépôt : ' + e.message;
      p.appendChild(button('Fermer', function () { p.remove(); }));
    });
  }

  function report(q, status) {
    var p = panel();
    var done = q.results.map(function (r) { return (r.ok ? '✓ ' : '✗ ') + r.file + (r.kind === 'install' ? ' (installé)' : ''); });
    if (status === 'saving') {
      p.appendChild(el('b', {}, 'Synchro GitHub : ' + (q.i + 1) + ' / ' + q.items.length + ' — ' + q.items[q.i].file));
      done.forEach(function (d) { p.appendChild(el('div', {}, d)); });
      p.appendChild(button('Arrêter après celui-ci', function () { store.del(); p.remove(); }));
      return;
    }
    p.appendChild(el('b', {}, status === 'done' ? 'Synchro terminée (' + q.sha.slice(0, 7) + ')' : 'Synchro arrêtée : le contenu enregistré ne correspond pas au dépôt'));
    done.forEach(function (d) { p.appendChild(el('div', {}, d)); });
    p.appendChild(button('Fermer', function () { p.remove(); }));
  }

  function run() {
    S.step({
      campaign: CAMPAIGN, tabs: userTabs, save: saveTab, store: store,
      reload: function () { location.reload(); }, later: function (fn, ms) { setTimeout(fn, ms); },
      now: function () { return Date.now(); }, report: report
    });
  }

  ready(function () {
    var b = el('button', { type: 'button', title: 'Synchroniser les scripts avec ' + S.REPO, style: css + 'right:16px;bottom:16px;padding:6px 12px;border-radius:16px;border:none;background:#24292f;color:#fff;cursor:pointer;' }, '⟳ GitHub');
    b.addEventListener('click', showPlan);
    document.body.appendChild(b);
    if (store.get()) run(); // une synchro était en cours avant le rechargement
  });
})();
