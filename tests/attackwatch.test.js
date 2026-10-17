// node tests/attackwatch.test.js : tests sans dépendance de scripts/attackwatch.js (logique pure + flux complet avec un faux Roll20)
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var W = require('../scripts/attackwatch.js');

var pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log('ÉCHEC: ' + label); } }
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' -> ' + JSON.stringify(a) + ' attendu ' + JSON.stringify(b)); }

var PUSH = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
var seq = 0;
function pidAt(ms) {
  var t = ms, s = '';
  for (var i = 0; i < 8; i++) { s = PUSH.charAt(t % 64) + s; t = Math.floor(t / 64); }
  var n = (seq++).toString(36);
  return s + ('AAAAAAAAAAAA' + n).slice(-12);
}
function pid(iso) { return pidAt(Date.parse(iso)); }

// --- logique pure
eq(W.fmt(W.idTime(pid('2026-10-03T16:09:12Z'))), '2026-10-03 16:09:12 UTC', 'date décodée à la seconde');
eq(W.parseButton('repeating_item_-Abc123_create-attack-entry'), { section: 'item', rowId: '-Abc123' }, 'bouton d\'objet');
eq(W.parseButton('repeating_spells_-x_create-attack-entry'), { section: 'spells', rowId: '-x' }, 'bouton de sort');
eq(W.parseButton('repeating_item_-x_name'), null, 'autre champ ignoré');
eq(W.parseButton('repeating_weapon_-x_create-attack-entry'), null, 'section non suivie');
eq(W.parseWeapon('repeating_weapon_-Row1_source-item'), { rowId: '-Row1', field: 'source-item' }, 'champ d\'attaque');
eq(W.parseWeapon('HP'), null, 'attribut simple ignoré');

var NOW = Date.parse('2026-10-17T18:28:00Z');
ok(W.isNewRow([pidAt(NOW - 1000), pidAt(NOW)], NOW, 60000), 'ligne neuve');
ok(!W.isNewRow([pidAt(NOW - 3600000), pidAt(NOW)], NOW, 60000), 'ligne ancienne avec un champ ajouté');
ok(!W.isNewRow([], NOW, 60000), 'pas d\'attribut');
ok(!W.isNewRow(['??'], NOW, 60000), 'id illisible');

eq(W.linkOf({ 'source-item': '-ITEM' }, { item: { '-item': 'Longsword' } }), 'objet « Longsword »', 'lien objet, casse ignorée');
eq(W.linkOf({ 'source-spell': '-S' }, { spells: {} }), 'sort « -S »', 'source introuvable : id affiché');
eq(W.linkOf({ name: 'Poing' }, {}), 'sans lien', 'attaque manuelle');

ok(/bouton « create attack » de objet « Longsword » 0 -> 1 · connectés : Sheo, Lucie/.test(
  W.line({ kind: 'button', t: NOW, char: 'Test', section: 'item', source: 'Longsword', prev: '0', value: '1', online: ['Sheo', 'Lucie'] })), 'ligne bouton');
ok(/\(nouveau champ\) · personne de connecté/.test(
  W.line({ kind: 'button', t: NOW, char: 'Test', section: 'item', source: 'X', prev: null, value: '1', online: [] })), 'ligne bouton créé');
ok(/redémarrage du sandbox API/.test(W.line({ kind: 'restart', t: NOW, online: [] })), 'ligne redémarrage');
ok(!/<script/.test(W.line({ kind: 'row', t: NOW, char: '<script>', name: '[[1d6]]', link: 'sans lien', online: [] })), 'texte nettoyé');
var log = [];
for (var i = 0; i < W.MAX_LOG + 5; i++) W.push(log, { n: i });
ok(log.length === W.MAX_LOG && log[0].n === 5, 'journal limité aux derniers évènements');

// --- flux complet avec un faux Roll20
// Date dont « maintenant » vaut NOW (new Date(ms) reste une vraie date)
function fixedDate() {
  function D() { return arguments.length ? new Date(arguments[0]) : new Date(NOW); }
  D.now = function () { return NOW; };
  D.UTC = Date.UTC; D.parse = Date.parse;
  return D;
}
function fakeRoll20(isGM) {
  var handlers = {}, sent = [], timers = [], objs = [];
  var ctx = {
    console: console, state: {}, Date: fixedDate(),
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    findObjs: function (q) {
      return objs.filter(function (o) {
        return Object.keys(q).every(function (k) { return o[k.replace(/^_/, '')] === q[k]; });
      }).map(wrap);
    },
    getObj: function (type, id) { var o = objs.filter(function (x) { return x.type === type && x.id === id; })[0]; return o ? wrap(o) : undefined; },
    playerIsGM: function () { return isGM !== false; },
    sendChat: function (from, text) { sent.push(text); },
    createObj: function () { throw new Error('création interdite'); },
    setTimeout: function (fn) { timers.push(fn); }
  };
  function wrap(o) {
    return { id: o.id, get: function (k) { return o[k.replace(/^_/, '')]; },
      set: function () { throw new Error('écriture interdite'); }, remove: function () { throw new Error('suppression interdite'); } };
  }
  function attr(name, current, ms) {
    var o = { type: 'attribute', id: pidAt(ms === undefined ? NOW : ms), characterid: 'C1', name: name, current: current };
    objs.push(o);
    return o;
  }
  objs.push({ type: 'character', id: 'C1', name: 'Test attaque' });
  objs.push({ type: 'player', id: 'P1', displayname: 'Sheo', online: true });
  objs.push({ type: 'player', id: 'P2', displayname: 'Lucie', online: false });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/attackwatch.js'), 'utf8'), ctx);
  function fire(ev, a, b) { (handlers[ev] || []).forEach(function (fn) { fn(a, b); }); }
  return {
    ctx: ctx, attr: attr, wrap: wrap,
    fire: fire,
    flush: function () { while (timers.length) timers.shift()(); var s = sent.join('\n'); sent.length = 0; return s; },
    say: function (content) {
      fire('chat:message', { type: 'api', content: content, who: 'Sheo (GM)', playerid: 'P1' });
      while (timers.length) timers.shift()();
      var s = sent.join('\n'); sent.length = 0; return s;
    }
  };
}

var r = fakeRoll20();
var OLD = NOW - 30 * 24 * 3600000;
var ITEM = '-ItemRow0000000000001';
r.attr('repeating_item_' + ITEM + '_name', 'Longsword', OLD);
var oldRow = '-OldRow00000000000001';
r.attr('repeating_weapon_' + oldRow + '_name', 'Longsword', OLD);
r.fire('add:attribute', r.wrap(r.attr('repeating_weapon_' + oldRow + '_notes', 'x')));
ok(r.flush() === '', 'avant ready : aucun évènement écouté');

r.fire('ready');
var out = r.flush();
ok(/^\/w gm .*redémarrage du sandbox API · connectés : Sheo$/.test(out), 'redémarrage enregistré, joueurs connectés');

// le bouton passe de 0 à 1, puis la feuille crée la ligne et remet le bouton à 0
var btn = r.attr('repeating_item_' + ITEM + '_create-attack-entry', '1', OLD);
r.fire('change:attribute', r.wrap(btn), { current: '0' });
ok(/Test attaque<\/b> : bouton « create attack » de objet « Longsword » 0 -> 1/.test(r.flush()), 'changement du bouton enregistré');
var row = '-NewRow00000000000001';
var first = r.attr('repeating_weapon_' + row + '_name', 'Longsword', NOW - 500);
r.fire('add:attribute', r.wrap(first));
r.fire('add:attribute', r.wrap(r.attr('repeating_weapon_' + row + '_source-item', ITEM, NOW - 400)));
out = r.flush();
ok(/nouvelle attaque « Longsword », objet « Longsword »/.test(out), 'nouvelle ligne avec son lien');
ok(out.split('nouvelle attaque').length === 2, 'une seule annonce par ligne');

// un champ ajouté à une ancienne ligne n'est pas une nouvelle attaque
r.fire('add:attribute', r.wrap(r.attr('repeating_weapon_' + oldRow + '_crit-target', '19')));
ok(!/nouvelle attaque/.test(r.flush()), 'ancienne ligne ignorée');
// changement d'un attribut sans rapport
r.fire('change:attribute', r.wrap(r.attr('HP', '10')), { current: '12' });
ok(r.flush() === '', 'autres attributs ignorés');

// commandes
ok(/Surveillance active, 3 évènements/.test(r.say('!attackwatch')), 'état');
out = r.say('!attackwatch log');
ok(/redémarrage/.test(out) && /0 -> 1/.test(out) && /nouvelle attaque/.test(out), 'journal complet');
ok(r.ctx.state.AttackWatch.log.length === 3, 'journal gardé dans state');
ok(/coupée/.test(r.say('!attackwatch off')), 'off');
r.fire('change:attribute', r.wrap(btn), { current: '1' });
ok(r.flush() === '' && r.ctx.state.AttackWatch.log.length === 3, 'coupé : rien enregistré');
ok(/activée/.test(r.say('!attackwatch ON')), 'on, casse ignorée');
ok(/Journal vidé/.test(r.say('!attackwatch clear')) && /Journal vide/.test(r.say('!attackwatch log')), 'clear');
ok(/Usage/.test(r.say('!attackwatch tout')), 'option inconnue');
eq(r.say('!attackwatchX'), '', 'autre commande ignorée');
eq(fakeRoll20(false).say('!attackwatch log'), '', 'joueur non MJ ignoré');

// comportement vu dans le vrai jeu : le bouton passe à 1 puis à 0, la feuille crée la ligne,
// mais l'API ne reçoit pas d'évènement add:attribute pour ses attributs
var r2 = fakeRoll20();
r2.attr('repeating_item_' + ITEM + '_name', 'Longsword', OLD);
r2.attr('repeating_weapon_' + oldRow + '_name', 'Longsword', OLD);
r2.attr('repeating_weapon_' + oldRow + '_source-item', ITEM, OLD);
r2.fire('ready'); r2.flush();
var btn2 = r2.attr('repeating_item_' + ITEM + '_create-attack-entry', '1', OLD);
r2.fire('change:attribute', r2.wrap(btn2), { current: '0' });
var row2 = '-NewRow00000000000002';
r2.attr('repeating_weapon_' + row2 + '_name', 'Longsword', NOW);
r2.attr('repeating_weapon_' + row2 + '_source-item', ITEM, NOW);
btn2.current = '0';
r2.fire('change:attribute', r2.wrap(btn2), { current: '1' });
btn2.current = '1';
out = r2.flush();
ok(/0 -> 1/.test(out) && /1 -> 0/.test(out), 'sans add:attribute : les deux changements du bouton');
ok(/nouvelle attaque « Longsword », objet « Longsword »/.test(out), 'sans add:attribute : nouvelle ligne trouvée par comparaison');
ok(out.split('nouvelle attaque').length === 2, 'sans add:attribute : une seule annonce, ancienne ligne ignorée');
// deux objets à la fois (cas de Selea) : deux nouvelles lignes, une annonce chacune
var ITEM2 = '-ItemRow0000000000002';
r2.attr('repeating_item_' + ITEM2 + '_name', 'Dague', OLD);
var btn3 = r2.attr('repeating_item_' + ITEM2 + '_create-attack-entry', '1', OLD);
r2.fire('change:attribute', r2.wrap(btn2), { current: '0' });
r2.fire('change:attribute', r2.wrap(btn3), { current: '0' });
r2.attr('repeating_weapon_-NewRow00000000000003_name', 'Longsword', NOW);
r2.attr('repeating_weapon_-NewRow00000000000004_name', 'Dague', NOW);
r2.attr('repeating_weapon_-NewRow00000000000004_source-item', ITEM2, NOW);
out = r2.flush();
ok(out.split('nouvelle attaque').length === 3 && /« Dague », objet « Dague »/.test(out), 'deux objets : deux nouvelles lignes');

console.log(pass + ' réussis, ' + fail + ' échecs');
process.exit(fail ? 1 : 0);
