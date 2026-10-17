// node tests/attackclean.test.js : tests sans dépendance de scripts/attackclean.js (logique pure + flux complet avec un faux Roll20)
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var C = require('../scripts/attackclean.js');

var pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log('ÉCHEC: ' + label); } }
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' -> ' + JSON.stringify(a) + ' attendu ' + JSON.stringify(b)); }

var PUSH = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
var seq = 0;
// comme les ids de ligne Roll20, sans « _ » (sinon le nom d'attribut serait ambigu) : on décale d'1 ms si besoin
function pid(iso) {
  var ms = Date.parse(iso), s;
  do {
    var t = ms++; s = '';
    for (var i = 0; i < 8; i++) { s = PUSH.charAt(t % 64) + s; t = Math.floor(t / 64); }
  } while (s.indexOf('_') >= 0);
  var n = (seq++).toString(36);
  return s + ('AAAAAAAAAAAA' + n).slice(-12);
}
var FEB = '2026-02-03T20:09:00Z', SEP = '2026-09-16T17:36:00Z', OCT = '2026-10-03T16:09:00Z';

// --- parseArgs / norm
eq(C.parseArgs(' Selea '), { name: 'Selea', confirm: null, del: null, sure: false }, 'nom seul');
eq(C.parseArgs('Paz Tarpou CONFIRM 3'), { name: 'Paz Tarpou', confirm: 3, del: null, sure: false }, 'confirm N');
eq(C.parseArgs('Lune delete -abc12'), { name: 'Lune', confirm: null, del: '-abc12', sure: false }, 'delete id');
eq(C.parseArgs('Lune Ma delete -abc12 confirm'), { name: 'Lune Ma', confirm: null, del: '-abc12', sure: true }, 'delete id confirm');
eq(C.parseArgs('Selea confirmer 3').confirm, null, 'option française refusée');
ok(C.norm(undefined) === C.norm('0') && C.norm('') === C.norm(' 0 '), 'absent, vide et 0 se valent');
ok(C.norm('2') !== C.norm(''), 'valeur réelle distincte');

// --- fiche de test (inspirée de Selea)
var ITEM = pid(FEB), LOAN = pid(SEP), SPELL = pid(FEB);
function A(name, current, when) { return { id: pid(when), name: name, current: current }; }
function row(id, when, f) {
  return Object.keys(f).map(function (k) { return A('repeating_weapon_' + id + '_' + k, f[k], when); });
}
function base(extra) {
  var f = { name: 'épée longue +5', 'source-item': ITEM, enhance: '5', 'damage-dice-num': '1', 'damage-die': '8', 'crit-target': '19' };
  Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
  return f;
}
var KEEP = pid(FEB), C1 = pid(SEP), C2 = pid(OCT), C3 = pid(OCT), VAR = pid(FEB), ODD = pid(OCT), BIG = pid(OCT);
var L1 = pid(SEP), L2 = pid(OCT), M1 = pid(FEB), M2 = pid(OCT), S1 = pid(FEB), S2 = pid(OCT);
var ATTRS = [].concat(
  [A('repeating_item_' + ITEM + '_name', 'épée longue +5', FEB), A('repeating_item_' + LOAN + '_name', 'épée longue+1 prêtée', SEP),
   A('repeating_spells_' + SPELL + '_name', 'Rayon ardent', FEB)],
  row(KEEP, FEB, base({ 'attack-mod': '0', notes: '' })),            // gardée (la plus ancienne)
  row(C1, SEP, base()),                                              // copie identique (champs à 0 absents)
  row(C2, OCT, base({ name: ' Épée  longue +5 ' })),                 // copie identique, casse et espaces différents
  row(C3, OCT, base()),                                              // copie identique
  row(VAR, FEB, base({ name: 'AAO épée longue +5', 'attack-mod': '2' })), // variante renommée : jamais touchée
  row(ODD, OCT, base({ 'attack-mod': '4' })),                        // même nom mais réglage changé : à vérifier
  row(BIG, OCT, base({ x1: '1', x2: '2', x3: '3', x4: '4', x5: '5' })), // plus de champs que la gardée : à vérifier
  row(L1, SEP, { name: 'épée longue+1 prêtée', 'source-item': LOAN }),
  row(L2, OCT, { name: 'épée longue+1 prêtée', 'source-item': LOAN }),
  row(M1, FEB, { name: 'Coup de poing' }), row(M2, OCT, { name: 'Coup de poing' }), // sans lien : jamais touchées
  row(S1, FEB, { name: 'Rayon ardent', 'source-spell': SPELL }), row(S2, OCT, { name: 'Rayon ardent', 'source-spell': SPELL.toLowerCase() })
);

var plan = C.buildPlan(ATTRS);
var removed = plan.remove.map(function (r) { return r.key; }).sort();
eq(removed, [C1, C2, C3, L2, S2].map(function (k) { return k.toLowerCase(); }).sort(), 'copies identiques à supprimer');
ok(plan.remove.every(function (r) { return r.key !== KEEP.toLowerCase() && r.key !== L1.toLowerCase(); }), 'la plus ancienne est gardée');
ok(plan.remove.every(function (r) { return [VAR, M1, M2, ODD, BIG].map(function (k) { return k.toLowerCase(); }).indexOf(r.key) < 0; }),
  'variantes, attaques sans lien et lignes modifiées jamais supprimées');
var sword = plan.groups.filter(function (g) { return /épée longue \+5/.test(g.label); })[0];
eq(sword.check.length, 2, 'deux lignes à vérifier');
ok(/attack-mod/.test(sword.check.map(function (c) { return c.why; }).join()), 'raison : réglage différent');
ok(/champs contre/.test(sword.check.map(function (c) { return c.why; }).join()), 'raison : plus de champs');
eq(plan.groups.length, 3, 'trois groupes : épée +5, épée prêtée, rayon');

var rep = C.report('Selea', plan).join('\n');
ok(/3 groupes .* <b>5<\/b> copies à supprimer/.test(rep), 'résumé');
ok(rep.indexOf('épée longue +5</b> (objet « épée longue +5 ») : gardée ' + C.fmt(C.idTime(KEEP)).slice(0, 16)) >= 0, 'groupe avec ligne gardée');
ok(/à vérifier, gardée : 2026-10-03 16:09, \d+ champs \(réglages différents : attack-mod 0 \(gardée\) \/ 4 \(copie\)\)/.test(rep), 'ligne à vérifier : valeurs comparées');
ok(rep.indexOf('[Supprimer cette copie](!attackclean Selea delete ' + ODD.toLowerCase() + ')') >= 0, 'bouton de suppression à la main');
ok(C.findCopy(plan, ODD) && C.findCopy(plan, C1) && !C.findCopy(plan, KEEP) && !C.findCopy(plan, VAR) && !C.findCopy(plan, M2),
  'seules les copies sont supprimables à la main');
ok(/sort « Rayon ardent »/.test(rep), 'source sort, casse de l\'id ignorée');
eq(C.buildPlan([]).remove.length, 0, 'fiche vide');

// --- flux complet avec un faux Roll20
function fakeRoll20(attrs, isGM, others) {
  var handlers = {}, sent = [], timers = [], gone = [];
  var objs = [{ type: 'character', id: 'C1', name: 'Selea' }].concat(attrs.map(function (a) {
    return { type: 'attribute', id: a.id, characterid: 'C1', name: a.name, current: a.current };
  }));
  (others || []).forEach(function (o, i) {
    objs.push({ type: 'character', id: 'X' + i, name: o.name });
    o.attrs.forEach(function (a) { objs.push({ type: 'attribute', id: a.id, characterid: 'X' + i, name: a.name, current: a.current }); });
  });
  function wrap(o) {
    return { id: o.id, get: function (k) { return o[k.replace(/^_/, '')]; },
      set: function () { throw new Error('écriture interdite'); },
      remove: function () { gone.push(o.name); objs.splice(objs.indexOf(o), 1); } };
  }
  var ctx = {
    console: console,
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    findObjs: function (q) {
      return objs.filter(function (o) { return Object.keys(q).every(function (k) { return o[k.replace(/^_/, '')] === q[k]; }); }).map(wrap);
    },
    playerIsGM: function () { return isGM !== false; },
    sendChat: function (from, text) { sent.push(text); },
    createObj: function () { throw new Error('création interdite'); },
    setTimeout: function (fn) { timers.push(fn); }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/attackclean.js'), 'utf8'), ctx);
  return {
    gone: gone, objs: objs,
    say: function (content) {
      (handlers['chat:message'] || []).forEach(function (fn) { fn({ type: 'api', content: content, who: 'Sheo (GM)', playerid: 'P1' }); });
      while (timers.length) timers.shift()();
      var s = sent.join('\n'); sent.length = 0; return s;
    }
  };
}
var r = fakeRoll20(ATTRS);
var out = r.say('!attackclean selea');
ok(/ESSAI À BLANC/.test(out) && /!attackclean Selea confirm 5/.test(out) && r.gone.length === 0, 'essai à blanc');
ok(/ABANDON/.test(r.say('!attackclean Selea confirm 4')) && r.gone.length === 0, 'mauvais nombre : abandon');
ok(/Aucun personnage nommé Selea confirmer 5/.test(r.say('!attackclean Selea confirmer 5')) && r.gone.length === 0, 'option française refusée');
out = r.say('!attackclean Selea confirm 5');
ok(/Terminé : 5 lignes supprimées/.test(out), 'suppression confirmée');
var doomedPrefixes = [C1, C2, C3, L2, S2].map(function (k) { return 'repeating_weapon_' + k + '_'; });
ok(r.gone.length > 0 && r.gone.every(function (n) { return doomedPrefixes.some(function (p) { return n.indexOf(p) === 0; }); }),
  'seuls les attributs des copies sont supprimés');
ok(r.objs.every(function (o) { return !doomedPrefixes.some(function (p) { return (o.name || '').indexOf(p) === 0; }); }), 'copies entièrement supprimées');
ok(r.objs.some(function (o) { return o.name === 'repeating_weapon_' + KEEP + '_name'; }) && r.objs.some(function (o) { return o.name === 'repeating_weapon_' + ODD + '_name'; }),
  'ligne gardée et ligne à vérifier toujours là');
ok(/<b>0<\/b> copies à supprimer/.test(r.say('!attackclean Selea')), 'second passage : plus rien d\'automatique');
// suppression à la main d'une copie « à vérifier »
out = r.say('!attackclean Selea delete ' + ODD.toLowerCase());
ok(/À supprimer : épée longue \+5/.test(out) && /\[Confirmer la suppression\]\(!attackclean Selea delete /.test(out), 'aperçu avant suppression à la main');
ok(r.objs.some(function (o) { return o.name === 'repeating_weapon_' + ODD + '_name'; }), 'aperçu : rien supprimé');
ok(/introuvable parmi les copies/.test(r.say('!attackclean Selea delete ' + KEEP + ' confirm')), 'ligne gardée refusée');
ok(/introuvable parmi les copies/.test(r.say('!attackclean Selea delete ' + VAR + ' confirm')), 'variante refusée');
ok(r.objs.some(function (o) { return o.name === 'repeating_weapon_' + KEEP + '_name'; }) && r.objs.some(function (o) { return o.name === 'repeating_weapon_' + VAR + '_name'; }), 'gardée et variante intactes');
out = r.say('!attackclean Selea delete ' + ODD.toLowerCase() + ' confirm');
ok(/Supprimée : épée longue \+5/.test(out) && !r.objs.some(function (o) { return (o.name || '').indexOf('repeating_weapon_' + ODD + '_') === 0; }), 'copie supprimée à la main');
ok(r.objs.some(function (o) { return o.name === 'repeating_weapon_' + BIG + '_name'; }), 'autre copie à vérifier intacte');
ok(/Usage/.test(r.say('!attackclean')), 'usage');
eq(fakeRoll20(ATTRS, false).say('!attackclean Selea confirm 5'), '', 'joueur non MJ ignoré');

// --- tous les personnages
var LITEM = pid(FEB), LK = pid(FEB), LC = pid(OCT), LV = pid(OCT);
var LUNE = [].concat([A('repeating_item_' + LITEM + '_name', 'Ansrivarr', FEB)],
  row(LK, FEB, { name: 'Ansrivarr', 'source-item': LITEM, 'damage-ability': 'DEX-mod' }),
  row(LC, OCT, { name: 'Ansrivarr', 'source-item': LITEM, 'damage-ability': 'DEX-mod' }),   // copie identique
  row(LV, OCT, { name: 'Ansrivarr', 'source-item': LITEM, 'damage-ability': 'STR-mod' }));  // à vérifier
var others = [{ name: 'Lune', attrs: LUNE }, { name: 'Monstre propre', attrs: row(pid(FEB), FEB, { name: 'Griffe' }) }];
var ra = fakeRoll20(ATTRS, true, others);
out = ra.say('!attackclean all');
ok(/2 sur 3 ont des attaques en double, <b>6<\/b> copies identiques à supprimer, 3 à vérifier/.test(out), 'all : résumé global');
ok(/Selea : 5 à supprimer, 2 à vérifier/.test(out) && /Lune : 1 à supprimer, 1 à vérifier/.test(out) && !/Monstre propre/.test(out), 'all : détail par personnage');
ok(/!attackclean all confirm 6/.test(out) && ra.gone.length === 0, 'all : essai à blanc');
ok(/ABANDON/.test(ra.say('!attackclean ALL confirm 5')) && ra.gone.length === 0, 'all : mauvais total, abandon');
out = ra.say('!attackclean all confirm 6');
ok(/Terminé : 6 lignes supprimées/.test(out), 'all : suppression confirmée');
var allDoomed = [C1, C2, C3, L2, S2, LC].map(function (k) { return 'repeating_weapon_' + k + '_'; });
ok(ra.gone.length > 0 && ra.gone.every(function (n) { return allDoomed.some(function (p) { return n.indexOf(p) === 0; }); }), 'all : seules les copies identiques supprimées');
ok(ra.objs.some(function (o) { return o.name === 'repeating_weapon_' + LV + '_name'; }) && ra.objs.some(function (o) { return o.name === 'repeating_weapon_' + LK + '_name'; }),
  'all : ligne gardée et copie à vérifier de Lune intactes');
ok(/<b>0<\/b> copies identiques/.test(ra.say('!attackclean all')), 'all : second passage, plus rien');
ok(/Usage.*!attackclean all/.test(ra.say('!attackclean')), 'usage mentionne all');

console.log(pass + ' réussis, ' + fail + ' échecs');
process.exit(fail ? 1 : 0);
