// attackwatch.js - script API Roll20, LECTURE SEULE, réservé au MJ.
// Surveille en permanence (même quand le MJ n'est pas là) ce qui crée des lignes d'attaque :
//   - chaque modification du champ « create attack » (create-attack-entry) d'un objet, sort ou capacité,
//     avec l'ancienne et la nouvelle valeur ;
//   - chaque nouvelle ligne d'attaque (repeating_weapon) des personnages contrôlés par un joueur,
//     trouvée en relisant leurs attaques toutes les 10 secondes : elle est vue même si Roll20
//     n'envoie aucun évènement (cas des changements faits par un script API, que l'API ne voit pas) ;
//     avec ce à quoi elle est liée et le CONTEXTE : les commandes API et les modifications d'objets
//     de ces personnages pendant les 3 minutes d'avant ;
//   - chaque création, PAR UN SCRIPT API, d'un champ « create attack » ou d'une ligne d'attaque
//     (createObj), avec les fonctions qui l'ont appelée. Les modifications (set, setWithWorker) ne
//     peuvent pas être vues : Roll20 ne laisse pas un script modifier ses objets (essayé le 19/10) ;
//   - chaque redémarrage du sandbox API ;
//   - pour chaque évènement : l'heure (UTC) et les joueurs connectés à ce moment.
// Le journal est gardé dans state (les 60 derniers évènements) et chaque évènement est chuchoté au MJ.
//
// Usage dans le chat :
//   !attackwatch          -> état (actif ou non) et nombre d'évènements enregistrés
//   !attackwatch log      -> affiche le journal
//   !attackwatch on|off   -> active ou coupe la surveillance (active par défaut)
//   !attackwatch clear    -> vide le journal
//   !attackwatch context  -> commandes API et modifications d'objets des 3 dernières minutes
//
// Pourquoi : la feuille Pathfinder Community crée une nouvelle attaque liée à un objet à CHAQUE
// modification de son champ create-attack-entry, sans regarder la valeur. Ce script dit quand ce
// champ change, sur quel personnage, et qui était connecté.
// Ne modifie, ne supprime et ne crée aucun objet du jeu (seul son propre state est écrit).

var AttackWatch = (function () {
  'use strict';
  var MAX_LOG = 60;
  var BUTTON_RE = /^repeating_(item|spells|ability)_(-[^_]+)_create-attack-entry$/;
  var WEAPON_RE = /^repeating_weapon_(-[^_]+)_(.+)$/;
  var PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  var SECTION_LABEL = { item: 'objet', spells: 'sort', ability: 'capacité' };
  var SOURCE_FIELDS = [['source-item', 'item'], ['source-spell', 'spells'], ['source-ability', 'ability']];

  function idTime(id) {
    if (!id || id.length < 8) return null;
    var t = 0;
    for (var i = 0; i < 8; i++) {
      var k = PUSH_CHARS.indexOf(id.charAt(i));
      if (k < 0) return null;
      t = t * 64 + k;
    }
    return t;
  }
  function fmt(ms) {
    var d = new Date(ms);
    if (ms === null || ms === undefined || isNaN(d.getTime())) return '?';
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }
  function clean(v, max) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[\[\]{}<>@&"]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 40);
  }
  // champ « create attack » : {section, rowId} ou null
  function parseButton(name) {
    var m = BUTTON_RE.exec(name || '');
    return m ? { section: m[1], rowId: m[2] } : null;
  }
  // attribut d'une ligne d'attaque : {rowId, field} ou null
  function parseWeapon(name) {
    var m = WEAPON_RE.exec(name || '');
    return m ? { rowId: m[1], field: m[2] } : null;
  }
  // une ligne est neuve si aucun de ses attributs n'a été créé plus de `age` ms avant `ref`
  function isNewRow(attrIds, ref, age) {
    if (!attrIds.length) return false;
    return attrIds.every(function (id) {
      var t = idTime(id);
      return t !== null && t >= ref - age;
    });
  }
  // origine d'une ligne d'attaque à partir de ses champs et des noms des lignes sources
  function linkOf(fields, sourceNames) {
    for (var i = 0; i < SOURCE_FIELDS.length; i++) {
      var v = fields[SOURCE_FIELDS[i][0]];
      if (!v) continue;
      var sec = SOURCE_FIELDS[i][1];
      var n = (sourceNames[sec] || {})[String(v).toLowerCase()];
      return SECTION_LABEL[sec] + ' « ' + clean(n !== undefined ? n : v, 30) + ' »';
    }
    return 'sans lien';
  }
  function line(e) {
    var who = e.online && e.online.length ? ' · connectés : ' + e.online.join(', ') : ' · personne de connecté';
    if (e.kind === 'restart') return fmt(e.t) + ' · redémarrage du sandbox API' + (e.spy ? ' (écritures des scripts surveillées : ' + (e.spy.length ? e.spy.join(', ') : 'aucune, non disponible') + ')' : '') + who;
    if (e.kind === 'button') {
      return fmt(e.t) + ' · <b>' + clean(e.char, 30) + '</b> : bouton « create attack » de ' + SECTION_LABEL[e.section] +
        ' « ' + clean(e.source, 30) + ' » ' + (e.prev === null ? '(nouveau champ)' : clean(e.prev, 5) + ' -> ' + clean(e.value, 5)) + who;
    }
    if (e.kind === 'apiwrite') {
      return fmt(e.t) + ' · <b>' + clean(e.char, 30) + '</b> : écriture par un script API, ' + e.method + ' ' + clean(e.field, 40) +
        ' = ' + clean(e.value, 12) + (e.callers && e.callers.length ? ' (appelée par : ' + e.callers.map(function (c) { return clean(c, 30); }).join(' ← ') + ')' : '') + who;
    }
    if (e.kind === 'row') {
      var seen = e.seen ? ' (vue ' + (e.atStart ? 'au redémarrage, ' : '') + 'à ' + fmt(e.seen).slice(11, 19) + ')' : '';
      var ctx = e.context === undefined ? '' : (e.context.length ? '<br>&nbsp;&nbsp;avant : ' + e.context.map(function (c) { return clean(c, 160); }).join('<br>&nbsp;&nbsp;') : '<br>&nbsp;&nbsp;avant : rien (aucune commande API ni modification d\'objet)');
      return fmt(e.t) + ' · <b>' + clean(e.char, 30) + '</b> : nouvelle attaque « ' + clean(e.name, 30) + ' », ' + e.link + seen + who + ctx;
    }
    return fmt(e.t) + ' · ?';
  }
  function push(log, e, max) {
    log.push(e);
    while (log.length > (max || MAX_LOG)) log.shift();
    return log;
  }
  // clés (minuscules) présentes dans `now` et absentes de `before`
  function newKeys(before, now) {
    return Object.keys(now).filter(function (k) { return !before[k]; }).sort();
  }
  // contexte d'un évènement : entrées {t, txt} entre t - windowMs et t, les `max` plus récentes
  function contextFor(ring, t, windowMs, max) {
    var c = ring.filter(function (x) { return x.t <= t && x.t >= t - windowMs; });
    return c.slice(-(max || 8)).map(function (x) { return fmt(x.t).slice(11, 19) + ' ' + x.txt; });
  }
  // champ d'une ligne d'objet : {rowId, field} ou null
  var ITEM_RE = /^repeating_item_(-[^_]+)_(.+)$/;
  function parseItem(name) {
    var m = ITEM_RE.exec(name || '');
    return m ? { rowId: m[1], field: m[2] } : null;
  }

  // noms des fonctions appelantes tirés d'une pile d'appels (V8), sans les cadres de ce script
  function callers(stack, skip, max) {
    return String(stack || '').split('\n').slice(1).map(function (l) {
      var m = /^\s*at\s+(?:async\s+)?([^\s(]+)(?:\s+\[as [^\]]+\])?\s*\(/.exec(l);
      return m ? m[1] : (/^\s*at\s/.test(l) ? '(anonyme)' : null);
    }).filter(function (n) { return n && !skip.test(n); }).slice(0, max || 4);
  }
  // nom d'attribut que l'on veut voir écrit par les scripts
  function watchedName(name) {
    return !!(parseButton(name) || parseWeapon(name));
  }

  return { idTime: idTime, fmt: fmt, clean: clean, callers: callers, watchedName: watchedName, parseButton: parseButton, parseWeapon: parseWeapon, parseItem: parseItem,
    isNewRow: isNewRow, linkOf: linkOf, line: line, push: push, newKeys: newKeys, contextFor: contextFor, MAX_LOG: MAX_LOG };
})();

if (typeof module !== 'undefined') module.exports = AttackWatch;

(function () {
  'use strict';
  if (typeof on !== 'function') return;
  var W = AttackWatch;
  var POLL = 5000;           // ms : un tour de relecture
  var PER_TICK = 12;         // personnages relus par tour (chacun est relu toutes les ~40 s avec 96 personnages)
  var cursor = 0;
  var REPORT_DELAY = 2000;   // ms : laisse à la feuille le temps d'écrire le nom et le lien
  var CONTEXT_MS = 180000;   // ms : contexte gardé avant une nouvelle attaque
  var ring = [];             // contexte récent (mémoire seulement) : {t, txt}
  var polls = 0;

  function st() {
    state.AttackWatch = state.AttackWatch || { on: true, log: [] };
    state.AttackWatch.known = state.AttackWatch.known || {};
    return state.AttackWatch;
  }
  function online() {
    return findObjs({ _type: 'player', _online: true }).map(function (p) { return W.clean(p.get('_displayname'), 25); });
  }
  function record(e) {
    var s = st();
    if (!s.on) return;
    e.online = online();
    W.push(s.log, e);
    sendChat('attackwatch', '/w gm ' + W.line(e), null, { noarchive: true });
  }
  function note(txt) { W.push(ring, { t: Date.now(), txt: txt }, 80); }
  function attrsOf(charId) {
    return findObjs({ _type: 'attribute', _characterid: charId });
  }
  function sourceName(charId, section, rowId) {
    var a = findObjs({ _type: 'attribute', _characterid: charId, name: 'repeating_' + section + '_' + rowId + '_name' })[0];
    return a ? a.get('current') : rowId;
  }
  function charName(charId) {
    var c = getObj('character', charId);
    return c ? c.get('name') : charId;
  }
  function played() {
    return findObjs({ _type: 'character' }).filter(function (c) { return !!c.get('controlledby'); });
  }

  // ids (en minuscules) des lignes d'attaque d'un personnage
  function weaponRows(cid) {
    var keys = {};
    attrsOf(cid).forEach(function (a) {
      var w = W.parseWeapon(a.get('name'));
      if (w) keys[w.rowId.toLowerCase()] = 1;
    });
    return keys;
  }
  function reportRow(cid, key, seen, atStart, context) {
    var prefix = 'repeating_weapon_' + key + '_', fields = {}, names = { item: {}, spells: {}, ability: {} }, born = null;
    attrsOf(cid).forEach(function (a) {
      var n = a.get('name'), low = n.toLowerCase(), m;
      if (low.indexOf(prefix) === 0) {
        fields[n.slice(prefix.length)] = a.get('current');
        var t = W.idTime(a.id);
        if (t !== null && (born === null || t < born)) born = t;
      } else if ((m = /^repeating_(item|spells|ability)_(-[^_]+)_name$/.exec(n))) {
        names[m[1]][m[2].toLowerCase()] = a.get('current');
      }
    });
    record({ kind: 'row', t: born || seen, seen: seen, atStart: atStart, char: charName(cid), name: fields.name || '',
      link: W.linkOf(fields, names), context: context });
  }
  // relit les attaques des personnages joués et annonce les nouvelles lignes
  function poll() {
    var s = st(), now = Date.now(), atStart = polls === 0;
    polls++;
    if (!s.on) return;
    var all = played();
    // au démarrage, tout le monde d'un coup ; ensuite, quelques personnages par tour
    var batch = atStart ? all : [];
    for (var i = 0; !atStart && i < Math.min(PER_TICK, all.length); i++) batch.push(all[(cursor + i) % all.length]);
    cursor = all.length ? (cursor + PER_TICK) % all.length : 0;
    batch.forEach(function (c) {
      var cid = c.id, rows = weaponRows(cid);
      var before = s.known[cid];
      s.known[cid] = rows;
      if (!before) return; // première fois qu'on voit ce personnage : référence
      var fresh = W.newKeys(before, rows);
      if (!fresh.length) return;
      var context = W.contextFor(ring, now, CONTEXT_MS, 8);
      fresh.forEach(function (k) {
        setTimeout(function () { reportRow(cid, k, now, atStart, context); }, REPORT_DELAY);
      });
    });
  }

  // Les scripts API partagent le même bac à sable : on enveloppe les méthodes d'écriture des attributs
  // (prototype commun) et createObj pour voir les écritures des AUTRES scripts. Lecture seule : l'appel
  // d'origine est toujours fait, à l'identique.
  var SKIP = /(spyWrap|spyCreate|logWrite)/;
  function logWrite(method, obj, field, value) {
    var cid = obj && obj.get ? obj.get('_characterid') : '';
    var e = { kind: 'apiwrite', t: Date.now(), method: method, char: charName(cid), field: field, value: value,
      callers: W.callers(new Error().stack, SKIP, 4) };
    record(e);
    note(W.clean(e.char, 25) + ' : écriture API ' + method + ' ' + W.clean(field, 40) + ' = ' + W.clean(value, 12) +
      (e.callers.length ? ' par ' + e.callers.join(' ← ') : ''));
  }
  // enveloppe la méthode m (set / setWithWorker) de l'objet `owner` (prototype ou attribut lui-même)
  function wrapMethod(owner, m) {
    if (!owner || typeof owner[m] !== 'function' || owner[m].__attackwatch) return false;
    var orig = owner[m];
    var spyWrap = function (a, b) {
      try {
        if (this && this.get && this.get('_type') === 'attribute' && W.watchedName(this.get('name'))) {
          var v = typeof a === 'object' && a ? (a.current !== undefined ? a.current : JSON.stringify(a)) : (a === 'current' ? b : a + '=' + b);
          logWrite(m, this, this.get('name'), v);
        }
      } catch (err) { /* ne jamais gêner l'appel d'origine */ }
      return orig.apply(this, arguments);
    };
    spyWrap.__attackwatch = true;
    owner[m] = spyWrap;
    return owner[m] === spyWrap;
  }
  function installSpy() {
    var done = [];
    var sample = null;
    try {
      // un attribut d'un personnage joué suffit (ne pas charger tous les attributs du jeu)
      var c0 = played()[0];
      sample = c0 ? findObjs({ _type: 'attribute', _characterid: c0.id })[0] : null;
    } catch (err) { sample = null; }
    ['set', 'setWithWorker'].forEach(function (m) {
      try {
        // premier objet de la chaîne de prototypes qui porte la méthode
        var p = sample;
        while (p && !Object.prototype.hasOwnProperty.call(p, m)) p = Object.getPrototypeOf(p);
        if (p && p !== sample && p !== Object.prototype && wrapMethod(p, m)) done.push(m);
      } catch (err) { /* prototype non modifiable */ }
    });
    try {
      if (typeof createObj === 'function' && !createObj.__attackwatch) {
        var origCreate = createObj;
        var spyCreate = function (type, props) {
          var o = origCreate.apply(this, arguments);
          try {
            if (type === 'attribute' && props && W.watchedName(props.name)) logWrite('createObj', o, props.name, props.current);
          } catch (err) { /* idem */ }
          return o;
        };
        spyCreate.__attackwatch = true;
        createObj = spyCreate; // eslint-disable-line no-global-assign
        if (createObj === spyCreate) done.push('createObj');
      }
    } catch (err) { /* createObj non modifiable */ }
    return done;
  }

  function onChange(obj, prev) {
    var name = obj.get('name'), cid = obj.get('_characterid');
    var b = W.parseButton(name);
    if (b) {
      record({ kind: 'button', t: Date.now(), char: charName(cid), section: b.section,
        source: sourceName(cid, b.section, b.rowId),
        prev: prev ? prev.current : null, value: obj.get('current') });
      note(charName(cid) + ' : bouton create attack de « ' + W.clean(sourceName(cid, b.section, b.rowId), 40) + ' »');
      return;
    }
    var it = W.parseItem(name);
    if (!it || !st().known[cid]) return; // objets des personnages joués seulement
    note(charName(cid) + ' : objet « ' + W.clean(sourceName(cid, 'item', it.rowId), 40) + ' » ' + W.clean(it.field, 25) + ' ' +
      W.clean(prev ? prev.current : '', 12) + ' → ' + W.clean(obj.get('current'), 12));
  }

  on('ready', function () {
    record({ kind: 'restart', t: Date.now(), spy: installSpy() });
    on('change:attribute', onChange);
    on('add:attribute', function (obj) { onChange(obj, null); });
    on('chat:message', function (msg) {
      if (msg.type === 'api' && !/^!attackwatch/.test(msg.content)) note(W.clean(msg.who, 20) + ' : ' + W.clean(msg.content, 50));
    });
    poll();
    setInterval(poll, POLL);
  });

  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!attackwatch(\s|$)/.test(msg.content)) return;
    if (!playerIsGM(msg.playerid)) return;
    var who = msg.who.replace(/ \(GM\)$/, '');
    var reply = function (t) { sendChat('attackwatch', '/w "' + who + '" ' + t, null, { noarchive: true }); };
    var arg = msg.content.replace(/^!attackwatch\s*/, '').trim().toLowerCase();
    var s = st();
    if (arg === 'on' || arg === 'off') { s.on = arg === 'on'; reply('Surveillance ' + (s.on ? 'activée.' : 'coupée.')); return; }
    if (arg === 'clear') { s.log = []; reply('Journal vidé.'); return; }
    if (arg === 'context') {
      var c = W.contextFor(ring, Date.now(), CONTEXT_MS, 15);
      reply(c.length ? 'Contexte des 3 dernières minutes :<br>' + c.map(function (x) { return W.clean(x, 160); }).join('<br>') : 'Contexte vide.');
      return;
    }
    if (arg === 'log') {
      if (!s.log.length) { reply('Journal vide.'); return; }
      for (var i = 0, n = 0; i < s.log.length; i += 10, n++) {
        (function (chunk, delay) { setTimeout(function () { reply(chunk); }, delay); })(s.log.slice(i, i + 10).map(W.line).join('<br>'), n * 400);
      }
      return;
    }
    if (arg) { reply('Usage : !attackwatch [log|context|on|off|clear]'); return; }
    reply('Surveillance ' + (s.on ? 'active' : 'coupée') + ', ' + s.log.length + ' évènements dans le journal (!attackwatch log), ' +
      Object.keys(s.known).length + ' personnages joués surveillés.');
  });
})();
