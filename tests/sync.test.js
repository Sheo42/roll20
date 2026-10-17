// node tests/sync.test.js : tests sans dépendance de sync/roll20-github-sync.user.js (logique pure + file d'attente simulée)
'use strict';
var S = require('../sync/roll20-github-sync.user.js');

var pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log('ÉCHEC: ' + label); } }
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' -> ' + JSON.stringify(a) + ' attendu ' + JSON.stringify(b)); }

// --- noms : les onglets réels de la campagne retrouvent leur fichier
var pairs = [['token tool.js', 'token-tool.js'], ['TokenInfo.js', 'tokeninfo.js'], ['Dupes.js', 'dupes.js'],
  ['Gabarit.js', 'gabarit.js'], ['pjstats.js', 'pjstats.js'], ['Attackclean.js', 'attackclean.js'], ['Climat.js', 'Climat.js']];
ok(pairs.every(function (p) { return S.normName(p[0]) === S.normName(p[1]); }), 'noms des onglets du jeu = noms des fichiers');
ok(S.normName('Dédup.js') === 'dedup', 'accents ignorés');
ok(S.normName('dupes.js') !== S.normName('dedup.js'), 'noms différents restent différents');

// --- texte et différences
ok(S.normText('a\r\nb\r\n\n') === 'a\nb', 'fins de ligne et blancs de fin ignorés');
eq(S.lineDiff('a\nb\nc', 'a\nb\nc'), { added: 0, removed: 0 }, 'identique');
eq(S.lineDiff('a\nb\nc', 'a\nX\nc\nd'), { added: 2, removed: 1 }, '+2 / -1');
eq(S.lineDiff('', 'a\nb'), { added: 2, removed: 1 }, 'texte vide = une ligne vide retirée');

// --- fichiers du dépôt : seulement les .js, sans les tests
eq(S.repoFiles([{ name: 'dupes.js', type: 'file' }, { name: 'dupes.test.js', type: 'file' }, { name: 'README.md', type: 'file' },
  { name: 'lib', type: 'dir' }, { name: 'Climat.js', type: 'file' }]), ['Climat.js', 'dupes.js'], 'liste des fichiers à synchroniser');

// --- plan
var tabs = [
  { id: '2797511', name: 'Dupes.js', content: 'v1\nold' },
  { id: '2796836', name: 'token tool.js', content: 'same\r\n' },
  { id: '2796874', name: 'PFCompanion-patched.js', content: 'privé' },
  { id: '2331121', name: 'BlindRoll.js', content: 'x' },
  { id: '1', name: 'Gabarit.js', content: 'g' }, { id: '2', name: 'gabarit.js', content: 'g2' }
];
var files = [
  { file: 'dupes.js', content: 'v1\nnew\nmore' },
  { file: 'token-tool.js', content: 'same' },
  { file: 'attackwatch.js', content: 'a\nb\nc' },
  { file: 'gabarit.js', content: 'g3' }
];
var pl = S.plan(tabs, files);
var by = {}; pl.rows.forEach(function (r) { by[r.file] = r; });
ok(by['dupes.js'].status === 'changed' && by['dupes.js'].tabId === '2797511' && by['dupes.js'].added === 2 && by['dupes.js'].removed === 1, 'modifié : +2 / -1');
ok(by['token-tool.js'].status === 'same', 'identique malgré CRLF : à jour');
ok(by['attackwatch.js'].status === 'new' && by['attackwatch.js'].tabId === null, 'absent du jeu : à installer');
ok(by['gabarit.js'].status === 'ambiguous', 'deux onglets du même nom : ignoré');
eq(pl.extra, ['PFCompanion-patched.js', 'BlindRoll.js'], 'onglets sans fichier : listés, non touchés');

// --- file d'attente
var q = S.makeQueue(19712927, 'abc1234def', pl.rows);
eq(q.items.map(function (i) { return i.kind + ':' + i.tabId + ':' + i.file; }), ['update:2797511:dupes.js', 'install:new:attackwatch.js'],
  'seuls les modifiés et les absents entrent dans la file');
ok(q.campaign === '19712927' && q.i === 0 && q.pending === null, 'file neuve');
ok(S.verify(q.items[0], [{ id: '2797511', name: 'Dupes.js', content: 'v1\nnew\nmore\n' }]), 'vérification : contenu enregistré = dépôt');
ok(!S.verify(q.items[0], [{ id: '2797511', name: 'Dupes.js', content: 'v1\nold' }]), 'vérification : ancien contenu détecté');
ok(S.verify(q.items[1], [{ id: '999', name: 'attackwatch.js', content: 'a\nb\nc' }]), 'vérification d\'une installation par le nom');
ok(!S.verify(q.items[1], []), 'installation absente détectée');

// --- simulation de la page : chaque enregistrement recharge la page
function fakeEnv(campaign, page, opts) {
  opts = opts || {};
  var saved = null, log = { saves: [], reports: [], reloads: 0, timers: [] };
  var env = {
    campaign: campaign,
    tabs: function () { return page.tabs; },
    save: function (item) {
      log.saves.push(item.file);
      if (opts.corrupt === item.file) return; // Roll20 n'a pas enregistré
      if (item.kind === 'install') page.tabs.push({ id: 'n' + log.saves.length, name: item.name, content: item.content });
      else page.tabs.forEach(function (t) { if (t.id === item.tabId) t.content = item.content; });
    },
    store: { get: function () { return saved ? JSON.parse(saved) : null; }, set: function (v) { saved = JSON.stringify(v); }, del: function () { saved = null; } },
    reload: function () { log.reloads++; },
    later: function (fn, ms) { log.timers.push(ms); },
    now: function () { return 1000; },
    report: function (qq, st) { log.reports.push(st); }
  };
  return { env: env, log: log };
}
var page = { tabs: JSON.parse(JSON.stringify(tabs)) };
var f = fakeEnv('19712927', page);
f.env.store.set(S.makeQueue('19712927', 'abc1234def', pl.rows));
ok(S.step(f.env) === 'saving' && f.log.saves[0] === 'dupes.js', 'pas 1 : enregistre dupes.js');
ok(f.log.timers[0] === 20000, 'rechargement de secours prévu');
ok(S.step(f.env) === 'saving' && f.log.saves[1] === 'attackwatch.js', 'après rechargement : vérifie puis installe attackwatch.js');
ok(S.step(f.env) === 'done' && f.env.store.get() === null, 'après rechargement : terminé, file vidée');
var last = f.log.reports[f.log.reports.length - 1];
ok(last === 'done', 'compte rendu final');
ok(page.tabs.some(function (t) { return t.name === 'attackwatch.js' && t.content === 'a\nb\nc'; }), 'script installé dans la page');
ok(S.step(f.env) === 'idle', 'plus rien à faire');

// enregistrement raté : la synchro s'arrête au premier écart
var page2 = { tabs: JSON.parse(JSON.stringify(tabs)) };
var g = fakeEnv('19712927', page2, { corrupt: 'dupes.js' });
g.env.store.set(S.makeQueue('19712927', 'abc1234def', pl.rows));
S.step(g.env);
ok(S.step(g.env) === 'failed' && g.log.saves.length === 1 && g.env.store.get() === null, 'contenu non enregistré : arrêt, rien d\'autre enregistré');

// file d'une autre campagne : ignorée
var h = fakeEnv('111', { tabs: [] });
h.env.store.set(S.makeQueue('19712927', 'abc1234def', pl.rows));
ok(S.step(h.env) === 'other-campaign' && h.log.saves.length === 0 && h.env.store.get() !== null, 'autre campagne : rien fait');

console.log(pass + ' réussis, ' + fail + ' échecs');
process.exit(fail ? 1 : 0);
