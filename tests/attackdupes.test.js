// node tests/attackdupes.test.js : tests sans dépendance de scripts/attackdupes.js (logique pure + flux complet avec un faux Roll20)
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var D = require('../scripts/attackdupes.js');

var pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log('ÉCHEC: ' + label); } }
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' -> ' + JSON.stringify(a) + ' attendu ' + JSON.stringify(b)); }

// fabrique un id Firebase dont les 8 premiers caractères encodent la date donnée
var PUSH = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
var seq = 0;
// comme les ids de ligne Roll20, sans « _ » : on décale d'1 ms si besoin
function pid(iso) {
  var ms = Date.parse(iso), s;
  do {
    var t = ms++; s = '';
    for (var i = 0; i < 8; i++) { s = PUSH.charAt(t % 64) + s; t = Math.floor(t / 64); }
  } while (s.indexOf('_') >= 0);
  var n = (seq++).toString(36);
  return s + ('AAAAAAAAAAAA' + n).slice(-12);
}

// --- idTime / fmt
eq(D.fmt(D.idTime(pid('2026-10-10T19:42:00Z'))), '2026-10-10 19:42 UTC', 'date décodée depuis un id');
eq(D.idTime('abc'), null, 'id trop court');
eq(D.idTime('!!!!!!!!xx'), null, 'caractère hors alphabet');
eq(D.fmt(null), '?', 'date inconnue');

// --- parseArgs
eq(D.parseArgs(' Selea '), { name: 'Selea', all: false }, 'nom seul');
eq(D.parseArgs('Paz Tarpou ALL'), { name: 'Paz Tarpou', all: true }, 'option all');
eq(D.parseArgs('*'), { name: '*', all: false }, 'tous les personnages');

// --- fiche de test
var OLD = '2026-09-01T18:00:00Z', NEW1 = '2026-10-10T19:42:00Z', NEW2 = '2026-10-11T08:05:00Z';
var ITEM = pid(OLD), SPELL = pid(OLD), ABIL = pid(OLD);
var W1 = pid(OLD), W2 = pid(NEW1), W3 = pid(OLD), W4 = pid(NEW2), W5 = pid(OLD), W6 = pid(OLD), W7 = pid(NEW1), W8 = pid(OLD), W9 = pid(NEW2);
function A(name, current, when) { return { id: pid(when || OLD), name: name, current: current }; }
function W(row, field, v, when) { return A('repeating_weapon_' + row + '_' + field, v, when); }
function day(iso) { return D.fmt(D.idTime(pid(iso))).slice(0, 16); }
var ATTRS = [
  A('repeating_item_' + ITEM + '_name', 'Épée longue +2'),
  A('repeating_spells_' + SPELL + '_name', 'Rayon ardent'),
  A('repeating_ability_' + ABIL + '_name', 'Souffle'),
  // épée liée à l'objet, puis une copie récente liée au même objet (même nom)
  W(W1, 'name', 'Épée longue +2'), W(W1, 'source-item', ITEM), W(W1, 'enhance', '2'),
  W(W2, 'name', 'Épée longue +2', NEW1), W(W2, 'source-item', ITEM, NEW1),
  // sort : copie au nom écrit autrement (casse, espaces) et id en minuscules ; variante renommée
  W(W3, 'name', 'Rayon ardent'), W(W3, 'source-spell', SPELL),
  W(W4, 'name', ' rayon  ARDENT ', NEW2), W(W4, 'source-spell', SPELL.toLowerCase(), NEW2),
  W(W8, 'name', 'Rayon ardent (variante)'), W(W8, 'source-spell', SPELL),
  // capacité sans doublon
  W(W6, 'name', 'Souffle'), W(W6, 'source-ability', ABIL),
  // deux attaques manuelles du même nom, et une du même nom liée à un objet disparu (autre source)
  W(W5, 'name', 'Coup de poing'),
  W(W9, 'name', 'coup de poing', NEW2),
  W(W7, 'name', 'coup de poing ', NEW1), W(W7, 'source-item', pid(OLD), NEW1), W(W7, 'source-item-name', 'Gantelet', NEW1)
];

var idx = D.indexRows(ATTRS);
eq(Object.keys(idx.weapons).length, 9, '9 lignes d\'attaque');
eq(idx.weapons[W1.toLowerCase()].count, 3, 'champs comptés par ligne');
eq(D.fmt(idx.weapons[W2.toLowerCase()].born).slice(0, 16), day(NEW1), 'date d\'apparition de la ligne');
ok(idx.rows.item[ITEM.toLowerCase()] === 'Épée longue +2', 'noms des objets indexés');

var d = D.findDuplicates(idx);
eq(d.groups.length, 3, '3 groupes: épée, rayon, coup de poing manuel');
var sword = d.groups.filter(function (g) { return g.label === 'Épée longue +2'; })[0];
ok(sword && sword.rows.length === 2 && sword.rows[0].key === W1.toLowerCase(), 'épée: la plus ancienne en premier');
var ray = d.groups.filter(function (g) { return /rayon/i.test(g.label); })[0];
ok(ray && ray.rows.length === 2 && /sort « Rayon ardent »/.test(ray.source), 'rayon: même nom malgré casse et espaces, même sort malgré la casse de l\'id');
ok(ray && ray.rows.every(function (w) { return w.key !== W8.toLowerCase(); }), 'variante renommée exclue');
var punch = d.groups.filter(function (g) { return /coup de poing/i.test(g.label); })[0];
ok(punch && punch.rows.length === 2 && punch.source === 'manuelle', 'attaques manuelles du même nom groupées');
ok(punch && punch.rows.every(function (w) { return w.key !== W7.toLowerCase(); }), 'même nom mais autre source : pas une copie');
ok(/objet « Gantelet » \(introuvable\)/.test(idx.weapons[W7.toLowerCase()].origin.label), 'source introuvable signalée');

var rep = D.report('Selea', ATTRS, false).join('\n');
ok(/9 lignes d'attaque, 3 groupes en double \(3 copies\)/.test(rep), 'résumé ' + rep.split('\n')[0]);
ok(rep.indexOf('copies apparues entre ' + day(NEW1)) >= 0 && rep.indexOf(' et ' + day(NEW2)) >= 0, 'fenêtre des copies');
ok(rep.indexOf('<b>Épée longue +2</b> (objet « Épée longue +2 », 2 lignes)') >= 0, 'titre de groupe avec sa source');
ok(rep.indexOf('ANCIEN ' + day(OLD) + ', 3 champs') >= 0, 'ligne ancienne détaillée');
ok(rep.indexOf('copie ' + day(NEW1) + ', 2 champs') >= 0, 'ligne copie détaillée');
ok(!/variante/.test(rep), 'variante absente du rapport');
ok(!/Toutes les lignes/.test(rep), 'sans all: pas de liste complète');
var repAll = D.report('Selea', ATTRS, true).join('\n');
ok(/Toutes les lignes/.test(repAll) && repAll.indexOf('Souffle : ' + day(OLD) + ', capacité « Souffle »') >= 0 && /variante/.test(repAll), 'option all');

ok(/Aucune attaque en double/.test(D.report('Vide', [], false).join('')), 'fiche vide');
ok(!/</.test(D.report('X', [W(W1, 'name', '<b>x</b>'), W(W2, 'name', '<b>x</b>')], false).join('').replace(/<\/?b>|<br>/g, '')), 'chevrons retirés des noms');
ok(!/\[\[/.test(D.report('X', [W(W1, 'name', '[[1d20]]'), W(W2, 'name', '[[1d20]]')], false).join('')), 'jets de dés neutralisés');

var sum = D.summary([{ name: 'Selea', attrs: ATTRS }, { name: 'Lune', attrs: [] }]).join('\n');
ok(/1 personnages sur 2/.test(sum) && sum.indexOf('Selea : 3 groupes, dernière copie ' + day(NEW2)) >= 0, 'résumé global');
ok(/Aucun personnage/.test(D.summary([{ name: 'Lune', attrs: [] }]).join('')), 'résumé global vide');

// --- flux complet avec un faux Roll20
function fakeRoll20(isGM) {
  var handlers = {}, sent = [], timers = [];
  var objs = [{ type: 'character', id: 'C1', name: 'Selea' }, { type: 'character', id: 'C2', name: 'Lune' }];
  ATTRS.forEach(function (a) { objs.push({ type: 'attribute', id: a.id, characterid: 'C1', name: a.name, current: a.current }); });
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/attackdupes.js'), 'utf8'), ctx);
  return {
    say: function (content) {
      (handlers['chat:message'] || []).forEach(function (fn) { fn({ type: 'api', content: content, who: 'MJ (GM)', playerid: 'P1' }); });
      while (timers.length) timers.shift()();
      return sent.splice(0).join('\n');
    }
  };
}
var r = fakeRoll20(true);
var out = r.say('!attackdupes selea');
ok(/^\/w "MJ" /.test(out) && /3 groupes en double/.test(out), 'commande chuchotée au MJ');
ok(/Aucun personnage nommé Inconnu/.test(r.say('!attackdupes Inconnu')), 'personnage inconnu');
ok(/Usage/.test(r.say('!attackdupes')), 'usage sans argument');
ok(/Selea : 3 groupes/.test(r.say('!attackdupes *')) , 'résumé de tous les personnages');
ok(/Toutes les lignes/.test(r.say('!attackdupes Selea all')), 'option all dans le chat');
eq(r.say('!attackdupesX selea'), '', 'autre commande ignorée');
eq(fakeRoll20(false).say('!attackdupes Selea'), '', 'joueur non MJ ignoré');

console.log(pass + ' réussis, ' + fail + ' échecs');
process.exit(fail ? 1 : 0);
