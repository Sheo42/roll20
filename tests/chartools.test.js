// node tests/chartools.test.js : tests sans dépendance de scripts/dupes.js, dedup.js et abilityfix.js (flux complet avec un faux Roll20)
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log('ÉCHEC: ' + label); } }

// id Firebase dont les 8 premiers caractères encodent la date donnée
var PUSH = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
var seq = 0;
function pid(iso) {
  var t = Date.parse(iso), s = '';
  for (var i = 0; i < 8; i++) { s = PUSH.charAt(t % 64) + s; t = Math.floor(t / 64); }
  var n = (seq++).toString(36);
  return s + ('AAAAAAAAAAAA' + n).slice(-12);
}
var OLD = '2026-09-01T18:00:00Z', IN = '2026-10-03T10:00:00Z', OUT = '2026-10-05T10:00:00Z';

// faux Roll20 : charge un script, envoie des messages, garde la trace des écritures
function fakeRoll20(file, attrs, isGM) {
  var handlers = {}, sent = [], timers = [], removed = [], sets = [];
  var objs = [{ type: 'character', id: 'C1', name: 'Selea' }].concat(attrs.map(function (a) {
    return { type: 'attribute', id: a.id, characterid: 'C1', name: a.name, current: a.current, max: a.max || '' };
  }));
  function wrap(o) {
    return {
      id: o.id,
      get: function (k) { return o[k.replace(/^_/, '')]; },
      set: function (k, v) { sets.push([o.name, k, v]); o[k] = v; },
      remove: function () { removed.push(o.name); objs.splice(objs.indexOf(o), 1); }
    };
  }
  var ctx = {
    console: console,
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    findObjs: function (q) {
      return objs.filter(function (o) {
        return Object.keys(q).every(function (k) { return o[k.replace(/^_/, '')] === q[k]; });
      }).map(wrap);
    },
    playerIsGM: function () { return isGM !== false; },
    sendChat: function (from, text) { sent.push(text); },
    createObj: function () { throw new Error('création interdite'); },
    setTimeout: function (fn) { timers.push(fn); }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/' + file), 'utf8'), ctx);
  return {
    removed: removed, sets: sets,
    say: function (content) {
      (handlers['chat:message'] || []).forEach(function (fn) { fn({ type: 'api', content: content, who: 'MJ (GM)', playerid: 'P1' }); });
      while (timers.length) timers.shift()();
      return sent.splice(0).join('\n');
    }
  };
}
function A(name, current, when, max) { return { id: pid(when || OLD), name: name, current: current, max: max }; }

// --- dupes.js : option "all"
var DUP = [A('STR', '18'), A('STR', '18', IN), A('HP', '40'), A('HP', '35', IN)];
var dupes = fakeRoll20('dupes.js', DUP);
var out = dupes.say('!dupes Selea');
ok(/2 noms en double/.test(out) && /HP : ANCIEN 40/.test(out), 'dupes: résumé et valeurs différentes');
ok(!/Doublons identiques/.test(out), 'dupes: sans all, pas de liste des identiques');
ok(/Doublons identiques<\/b><br>STR/.test(dupes.say('!dupes Selea all')), 'dupes: option all');
ok(/Doublons identiques/.test(dupes.say('!dupes Selea ALL')), 'dupes: option all sans casse');
ok(/Aucun personnage nommé selea tout/.test(dupes.say('!dupes Selea tout')), 'dupes: ancienne option française refusée');
ok(/\[all\]/.test(dupes.say('!dupes')), 'dupes: usage en anglais');
ok(fakeRoll20('dupes.js', DUP, false).say('!dupes Selea') === '', 'dupes: joueur non MJ ignoré');

// --- dedup.js : option "confirm N"
function dedupAttrs() {
  return [A('STR', '18'), A('STR', '18', IN), A('DEX', '12'), A('DEX', '12', IN),
    A('WIS', '10'), A('WIS', '14', IN),                 // valeur différente : gardé
    A('INT', '8'), A('INT', '8', OUT),                  // hors fenêtre : gardé
    A('repeating_x_-abc_name', 'a'), A('repeating_x_-abc_name', 'a', IN)]; // section répétée : gardée
}
var dd = fakeRoll20('dedup.js', dedupAttrs());
out = dd.say('!dedup Selea');
ok(/supprimables : <b>2<\/b>/.test(out) && /!dedup Selea confirm 2/.test(out), 'dedup: essai à blanc propose confirm 2');
ok(dd.removed.length === 0, 'dedup: essai à blanc ne supprime rien');
ok(/ABANDON/.test(dd.say('!dedup Selea confirm 3')) && dd.removed.length === 0, 'dedup: mauvais nombre, abandon');
ok(/Aucun personnage nommé selea confirmer 2/.test(dd.say('!dedup Selea confirmer 2')) && dd.removed.length === 0, 'dedup: ancienne option française refusée');
out = dd.say('!dedup Selea confirm 2');
ok(/Terminé : 2 exemplaires supprimés/.test(out), 'dedup: confirm 2 supprime');
ok(JSON.stringify(dd.removed.sort()) === '["DEX","STR"]', 'dedup: seules les copies identiques dans la fenêtre partent');
ok(/\[confirm N\]/.test(dd.say('!dedup')), 'dedup: usage en anglais');

// --- abilityfix.js : option "confirm N"
var R1 = pid(OLD), R2 = pid(OLD), R3 = pid(OLD);
function abil(row, field, v) { return A('repeating_ability_' + row + '_' + field, v); }
var AB = [abil(R1, 'name', 'Interception de coups'), abil(R1, 'showinmenu', '1'),
  abil(R2, 'name', 'Rage'), abil(R2, 'showinmenu', '1'), abil(R2, 'ability_type', 'Ex'),
  abil(R3, 'name', 'Caché'), abil(R3, 'showinmenu', '0')];
var af = fakeRoll20('abilityfix.js', AB);
out = af.say('!abilityfix Selea');
ok(/: <b>1<\/b>/.test(out) && /Interception de coups \(type absent\)/.test(out) && /!abilityfix Selea confirm 1/.test(out), 'abilityfix: essai à blanc propose confirm 1');
ok(af.sets.length === 0, 'abilityfix: essai à blanc ne modifie rien');
ok(/ABANDON/.test(af.say('!abilityfix Selea confirm 2')) && af.sets.length === 0, 'abilityfix: mauvais nombre, abandon');
ok(/Aucun personnage/.test(af.say('!abilityfix Selea confirmer 1')) && af.sets.length === 0, 'abilityfix: ancienne option française refusée');
ok(/Terminé : 1 attributs modifiés/.test(af.say('!abilityfix Selea confirm 1')), 'abilityfix: confirm 1 applique');
ok(af.sets.length === 1 && af.sets[0][0] === 'repeating_ability_' + R1 + '_showinmenu' && af.sets[0][2] === '0', 'abilityfix: seul showinmenu de la ligne sans type passe à 0');
ok(/\[confirm N\]/.test(af.say('!abilityfix')), 'abilityfix: usage en anglais');

console.log(pass + ' réussis, ' + fail + ' échecs');
process.exit(fail ? 1 : 0);
