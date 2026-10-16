// node tests/pjstats.test.js : tests sans dépendance de scripts/pjstats.js (logique pure + flux complet avec un faux Roll20)
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var P = require('../scripts/pjstats.js');

var pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log('ÉCHEC: ' + label); } }
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' -> ' + JSON.stringify(a) + ' attendu ' + JSON.stringify(b)); }

var R1 = '-NabcdefghijKLMNOPQ1', R2 = '-NabcdefghijKLMNOPQ2', R3 = '-nabcdefghijklmnopq3';
function A(name, current, max) { return { name: name, current: current, max: max === undefined ? '' : max }; }
var ATTRS = [
  A('class-0-name', 'Chevalier'), A('class-0-level', '15'), A('level', '15'), A('race', 'Nain'),
  A('STR', '24'), A('STR-mod', '7'), A('DEX', '12'), A('DEX-mod', '1'), A('CON', '18'), A('CON-mod', '4'),
  A('INT', '10'), A('INT-mod', '0'), A('WIS', '12'), A('WIS-mod', '1'), A('CHA', '16'), A('CHA-mod', '-1'),
  A('HP', '150', '180'), A('HP-temp', '0'), A('init', '1'), A('speed-modified', '20'),
  A('AC', '32'), A('Touch', '12'), A('Flat-Footed', '31'), A('AC-armor', '14'), A('AC-shield', '6'), A('AC-ability', '1'),
  A('Fort', '14'), A('Ref', '6'), A('Will', '8'), A('bab', '15'), A('CMB', '22'), A('CMD', '33'), A('SR', '0'), A('DR', ''),
  A('armor3-type', 'Harnois +4'), A('armor3-acbonus', '9'), A('armor3-enhance', '4'),
  A('STR', '99'), // doublon: le premier gagne
  A('repeating_weapon_' + R1 + '_name', 'Marteau de guerre +3'), A('repeating_weapon_' + R1 + '_total-attack', '26'),
  A('repeating_weapon_' + R1 + '_damage-dice-num', '1'), A('repeating_weapon_' + R1 + '_damage-die', '8'),
  A('repeating_weapon_' + R1 + '_total-damage', '13'), A('repeating_weapon_' + R1 + '_crit-target', '19'),
  A('repeating_weapon_' + R1 + '_crit-multiplier', '3'), A('repeating_weapon_' + R1 + '_enhance', '3'),
  A('repeating_feat_' + R1 + '_name', 'Combat monté'), A('repeating_feat_' + R2 + '_name', 'Attaque au galop'),
  A('repeating_feat_' + R3 + '_name', ''), // ligne vide ignorée
  A('repeating_class-ability_' + R1 + '_name', 'Défi'),
  A('repeating_item_' + R1 + '_name', 'Ceinture de force +4'), A('repeating_item_' + R1 + '_qty', '1'), A('repeating_item_' + R1 + '_location', 'belt'),
  A('repeating_item_' + R2 + '_name', 'Potion de soins'), A('repeating_item_' + R2 + '_qty', '3'),
  A('repeating_spells_' + R1 + '_name', 'Bénédiction'), A('repeating_spells_' + R1 + '_spell_level', '1'),
  A('repeating_spells_' + R2 + '_name', 'Soins légers'), A('repeating_spells_' + R2 + '_spell_level', '1'),
  A('repeating_spells_' + R3 + '_name', 'Délivrance'), A('repeating_spells_' + R3 + '_spell_level', '4'),
  A('repeating_buff2_' + R1 + '_name', 'Rage'), A('repeating_buff2_' + R1 + '_enable_toggle', '1'),
  A('repeating_buff2_' + R2 + '_name', 'Hâte'), A('repeating_buff2_' + R2 + '_enable_toggle', '0'),
  A('repeating_lvl-1-spells_' + R1 + '_name', 'Section de PNJ, pas lue')
];

// --- indexAttrs
var idx = P.indexAttrs(ATTRS);
eq(idx.flat.STR.current, '24', 'doublon: premier exemplaire gardé');
eq(Object.keys(idx.rep.feat).length, 3, '3 lignes de dons dont une vide');
eq(idx.rep.weapon[R1.toLowerCase()]['total-attack'], '26', 'champ de ligne répétable');
ok(idx.rep['lvl-1-spells'] !== undefined, 'section avec tirets reconnue');
eq(idx.rep['class-ability'][R1.toLowerCase()].name, 'Défi', 'section class-ability');

// --- parseArgs
eq(P.parseArgs(' Paz Tarpou '), { name: 'Paz Tarpou', sections: P.SECTIONS }, 'sans section: toutes');
eq(P.parseArgs('Paz Tarpou armes dons'), { name: 'Paz Tarpou', sections: ['armes', 'dons'] }, 'sections en fin');
eq(P.parseArgs('Solathia Innveigdottir BASE'), { name: 'Solathia Innveigdottir', sections: ['base'] }, 'section en majuscules');
eq(P.parseArgs('').name, '', 'nom vide');

// --- report
var all = P.report(ATTRS, P.SECTIONS).join('\n');
ok(/Classes: Chevalier 15 \(niveau 15\) · Nain/.test(all), 'ligne classes');
ok(/STR 24 \(\+7\)/.test(all) && /CHA 16 \(-1\)/.test(all), 'caracs avec signe');
ok(/PV: 150\/180 ·/.test(all) && !/temp/.test(all), 'PV sans temporaires à 0');
ok(/CA 32 \/ contact 12 \/ dépourvu 31 \[armure 14, bouclier 6, carac 1/.test(all), 'CA détaillée');
ok(/JS: Réf \+6, Vig \+14, Vol \+8 · BBA \+15 · BMO \+22 · DMD 33 · RM 0 · RD -/.test(all), 'JS et manoeuvres');
ok(/Protections: armure Harnois \+4 \(\+9, alt \+4\)/.test(all), 'armure');
ok(/Marteau de guerre \+3: \+26, 1d8\+13, 19\/x3, alt \+3/.test(all), 'arme');
ok(/Dons \(2\): Combat monté, Attaque au galop/.test(all), 'dons, ligne vide ignorée');
ok(/Capacités de classe \(1\): Défi/.test(all), 'capacités de classe');
ok(/Ceinture de force \+4 \[belt\], Potion de soins x3/.test(all), 'objets');
ok(/Sorts niv 1 \(2\): Bénédiction, Soins légers/.test(all) && /Sorts niv 4 \(1\): Délivrance/.test(all), 'sorts par niveau');
ok(/Buffs \(2\): Rage \(actif\), Hâte/.test(all) && !/Hâte \(actif\)/.test(all), 'buffs');
ok(!/Section de PNJ/.test(all), 'sections PNJ ignorées');

var empty = P.report([], P.SECTIONS).join('\n');
ok(/Armes: aucune/.test(empty) && /Sorts: aucun/.test(empty) && /Classes: \? \(niveau \?\)/.test(empty), 'fiche vide sans erreur');
ok(!/</.test(P.report([A('repeating_feat_' + R1 + '_name', '<script>x</script>')], ['dons']).join('')), 'chevrons retirés');

// --- chunk
var ch = P.chunk(['a'.repeat(1000), 'b'.repeat(1000), 'c'.repeat(10)], 1800);
eq(ch.length, 2, 'découpage en 2 messages');
ok(ch.every(function (m) { return m.length <= 1800; }), 'messages sous la limite');
var big = P.chunk(['x'.repeat(4000)], 1800);
eq(big.length, 3, 'ligne trop longue coupée');

// --- Flux complet avec un faux Roll20
function fakeRoll20(isGM) {
  var handlers = [], sent = [];
  var objs = [
    { _type: 'character', id: 'C1', name: 'Paz Tarpou' },
    { _type: 'character', id: 'C2', name: 'Lune' }
  ];
  ATTRS.forEach(function (a, i) { objs.push({ _type: 'attribute', id: 'A' + i, _characterid: 'C1', name: a.name, current: a.current, max: a.max }); });
  objs.push({ _type: 'attribute', id: 'L1', _characterid: 'C2', name: 'STR', current: '14', max: '' });
  var wrap = function (o) { return { id: o.id, get: function (k) { return o[k] !== undefined ? o[k] : o['_' + k]; },
    set: function () { throw new Error('set interdit (lecture seule)'); }, remove: function () { throw new Error('remove interdit'); } }; };
  var ctx = {
    on: function (ev, fn) { handlers.push({ ev: ev, fn: fn }); },
    findObjs: function (q) {
      return objs.filter(function (o) { return Object.keys(q).every(function (k) { return o[k] === q[k]; }); }).map(wrap);
    },
    sendChat: function (from, text) { sent.push(text); },
    playerIsGM: function () { return isGM; },
    getAttrByName: function () { throw new Error('getAttrByName ne doit pas être appelé'); },
    createObj: function () { throw new Error('createObj interdit'); },
    module: undefined, console: console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'pjstats.js'), 'utf8'), ctx);
  return {
    send: function (content) {
      sent.length = 0;
      handlers.filter(function (h) { return h.ev === 'chat:message'; }).forEach(function (h) {
        h.fn({ type: 'api', content: content, who: 'Sheo (GM)', playerid: 'P1' });
      });
      return sent.slice();
    }
  };
}

var r20 = fakeRoll20(true);
var out = r20.send('!pjstats Paz Tarpou');
ok(out.length >= 1 && out.every(function (t) { return t.indexOf('/w "Sheo" ') === 0; }), 'chuchoté au MJ (suffixe GM retiré)');
ok(/Paz Tarpou<\/b> \(\d+ attributs\)/.test(out[0]), 'en-tête avec nombre d\'attributs');
ok(/Marteau de guerre/.test(out.join('')) && /Délivrance/.test(out.join('')), 'toutes les sections par défaut');
out = r20.send('!pjstats paz tarpou armes');
ok(/Marteau/.test(out.join('')) && !/Caracs/.test(out.join('')), 'section unique, nom insensible à la casse');
out = r20.send('!pjstats Lune base');
ok(/STR 14/.test(out.join('')) && !/STR 24/.test(out.join('')), 'attributs du bon personnage seulement');
out = r20.send('!pjstats Inconnu');
ok(/introuvable/.test(out.join('')), 'personnage inconnu');
out = r20.send('!pjstats');
ok(/Usage/.test(out.join('')), 'usage sans nom');
out = r20.send('!pjstatsX Paz');
eq(out.length, 0, 'autre commande ignorée');
out = r20.send('!pjinfo Paz Tarpou');
eq(out.length, 0, 'commande pjinfo ignorée');
out = fakeRoll20(false).send('!pjstats Paz Tarpou');
ok(/Réservé au MJ/.test(out.join('')) && !/Caracs/.test(out.join('')), 'refus pour un joueur');

console.log(pass + ' réussis, ' + fail + ' échecs');
process.exit(fail ? 1 : 0);
