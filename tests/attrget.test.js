// node tests/attrget.test.js : tests sans dépendance de scripts/attrget.js (logique pure + flux complet avec un faux Roll20)
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var G = require('../scripts/attrget.js');

var pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log('ÉCHEC: ' + label); } }
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' -> ' + JSON.stringify(a) + ' attendu ' + JSON.stringify(b)); }

// --- parseArgs : le plus long début qui est un personnage
var NAMES = ['Paz Tarpou', 'Paz', 'Lune'];
eq(G.parseArgs(['Paz', 'Tarpou', 'armor3'], NAMES), { name: 'Paz Tarpou', patterns: ['armor3'] }, 'nom avec espace');
eq(G.parseArgs(['paz', 'armor3', 'shield3'], NAMES), { name: 'Paz', patterns: ['armor3', 'shield3'] }, 'nom court, casse ignorée');
eq(G.parseArgs(['Lune'], NAMES), null, 'sans attribut');
eq(G.parseArgs(['Inconnu', 'x'], NAMES), null, 'personnage inconnu');

// --- report
var ATTRS = [
  { name: 'migrated_worn_equipment', current: '1', max: '' },
  { name: 'migrated_buffs', current: 1 },
  { name: 'armor3', current: 'Harnois +3 <b>', max: '' },
  { name: 'HP', current: 120, max: 145 }
];
var r = G.report('Paz Tarpou', ATTRS, ['MIGRATED_WORN_EQUIPMENT', 'shield3', 'migrated*', 'hp', 'armor3']);
eq(r[0], '<b>Paz Tarpou</b> : 4 attributs', 'en-tête');
eq(r[1], 'migrated_worn_equipment = "1"', 'valeur exacte, casse ignorée');
eq(r[2], 'shield3 : absent', 'attribut absent');
eq(r.slice(3, 5), ['migrated_buffs = "1"', 'migrated_worn_equipment = "1"'], 'préfixe*, triés');
eq(r[5], 'HP = "120" (max 145)', 'max affiché');
eq(r[6], 'armor3 = "Harnois +3 b"', 'valeur nettoyée');
var many = [];
for (var i = 0; i < G.MAX_SHOWN + 5; i++) many.push({ name: 'x' + (100 + i), current: i });
var rm = G.report('C', many, ['x*']);
eq(rm.length, 1 + G.MAX_SHOWN + 1, 'liste limitée');
ok(/et 5 autres/.test(rm[rm.length - 1]), 'reste annoncé');

// --- flux complet avec un faux Roll20 (lecture seule)
function fakeRoll20(isGM) {
  var handlers = {}, sent = [], timers = [];
  var objs = [{ type: 'character', id: 'C1', name: 'Paz Tarpou' }, { type: 'character', id: 'C2', name: 'Lune' }];
  ATTRS.forEach(function (a, i) { objs.push({ type: 'attribute', id: 'A' + i, characterid: 'C1', name: a.name, current: a.current, max: a.max }); });
  objs.push({ type: 'attribute', id: 'L1', characterid: 'C2', name: 'migrated_worn_equipment', current: '0' });
  function wrap(o) {
    return { id: o.id, get: function (k) { return o[k.replace(/^_/, '')]; }, set: function () { throw new Error('écriture interdite'); }, remove: function () { throw new Error('suppression interdite'); } };
  }
  var ctx = {
    module: undefined, console: console,
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    findObjs: function (q) {
      return objs.filter(function (o) {
        return Object.keys(q).every(function (k) { return o[k.replace(/^_/, '')] === q[k]; });
      }).map(wrap);
    },
    playerIsGM: function () { return isGM; },
    sendChat: function (from, text) { sent.push(text); },
    createObj: function () { throw new Error('création interdite'); },
    setTimeout: function (fn) { timers.push(fn); }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/attrget.js'), 'utf8'), ctx);
  return {
    say: function (content) {
      (handlers['chat:message'] || []).forEach(function (fn) { fn({ type: 'api', content: content, who: 'MJ (GM)', playerid: 'P1' }); });
      while (timers.length) timers.shift()();
      return sent.splice(0).join('\n');
    }
  };
}
var f = fakeRoll20(true);
var out = f.say('!attrget Paz Tarpou migrated_worn_equipment');
ok(/^\/w "MJ" /.test(out) && /migrated_worn_equipment = "1"/.test(out), 'commande chuchotée au MJ');
ok(/migrated_worn_equipment = "0"/.test(f.say('!attrget lune migrated_worn_equipment')), 'autre personnage');
ok(/Usage/.test(f.say('!attrget Lune')), 'usage sans attribut');
ok(/Aucun personnage/.test(f.say('!attrget Inconnu x')), 'personnage inconnu');
eq(f.say('!attrgetX Lune x'), '', 'autre commande ignorée');
eq(fakeRoll20(false).say('!attrget Lune migrated_worn_equipment'), '', 'joueur non MJ ignoré');

console.log(pass + ' réussis, ' + fail + ' échecs');
process.exit(fail ? 1 : 0);
