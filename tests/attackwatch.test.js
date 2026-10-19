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

// --- logique ajoutée : nouvelles lignes, contexte, champs d'objet
eq(W.newKeys({ a: 1, b: 1 }, { a: 1, b: 1, c: 1 }), ['c'], 'nouvelle clé');
eq(W.newKeys({ a: 1, b: 1 }, { a: 1 }), [], 'ligne supprimée : rien de nouveau');
var ring = [{ t: NOW - 200000, txt: 'trop vieux' }, { t: NOW - 60000, txt: 'Paz : !pfc --rest' }, { t: NOW - 1000, txt: 'objet' }, { t: NOW + 5000, txt: 'après' }];
eq(W.contextFor(ring, NOW, 180000, 8), ['18:27:00 Paz : !pfc --rest', '18:27:59 objet'], 'contexte : 3 minutes avant, rien après');
eq(W.contextFor(ring, NOW, 180000, 1), ['18:27:59 objet'], 'contexte limité aux plus récents');
eq(W.parseItem('repeating_item_-Abc_qty'), { rowId: '-Abc', field: 'qty' }, 'champ d\'objet');
eq(W.parseItem('repeating_weapon_-Abc_qty'), null, 'autre section ignorée');
var rowLine = W.line({ kind: 'row', t: NOW - 500, seen: NOW, char: 'Paz', name: 'Marteau', link: 'objet « Marteau »', online: ['Sheo'], context: ['18:27:00 Paz : !pfc --rest'] });
ok(/nouvelle attaque « Marteau », objet « Marteau » \(vue à 18:28:00\) · connectés : Sheo<br>&nbsp;&nbsp;avant : 18:27:00 Paz : !pfc --rest/.test(rowLine), 'ligne d\'attaque avec heure vue et contexte');
ok(/avant : rien/.test(W.line({ kind: 'row', t: NOW, seen: NOW, char: 'P', name: 'x', link: 'sans lien', online: [], context: [] })), 'contexte vide dit');
ok(/vue au redémarrage, à/.test(W.line({ kind: 'row', t: NOW, seen: NOW, atStart: true, char: 'P', name: 'x', link: 'sans lien', online: [], context: [] })), 'ligne trouvée au redémarrage');

// --- flux complet avec un faux Roll20 (horloge simulée, setInterval capturé)
function fakeRoll20(isGM) {
  var clock = { now: NOW };
  var handlers = {}, sent = [], timers = [], intervals = [], objs = [];
  function D() { return arguments.length ? new Date(arguments[0]) : new Date(clock.now); }
  D.now = function () { return clock.now; }; D.UTC = Date.UTC; D.parse = Date.parse;
  var ctx = {
    console: console, state: {}, Date: D,
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
    setTimeout: function (fn) { timers.push(fn); },
    setInterval: function (fn, ms) { intervals.push({ fn: fn, ms: ms }); }
  };
  function wrap(o) {
    return { id: o.id, get: function (k) { return o[k.replace(/^_/, '')]; },
      set: function () { throw new Error('écriture interdite'); }, remove: function () { throw new Error('suppression interdite'); } };
  }
  function attr(cid, name, current, ms) {
    var o = { type: 'attribute', id: pidAt(ms === undefined ? clock.now : ms), characterid: cid, name: name, current: current };
    objs.push(o);
    return o;
  }
  objs.push({ type: 'character', id: 'PAZ', name: 'Paz Tarpou', controlledby: 'P2' });
  objs.push({ type: 'character', id: 'MOB', name: 'Gobelin', controlledby: '' });
  objs.push({ type: 'player', id: 'P1', displayname: 'Sheo', online: true });
  objs.push({ type: 'player', id: 'P2', displayname: 'Tankadlavie', online: true });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/attackwatch.js'), 'utf8'), ctx);
  function fire(ev, a, b) { (handlers[ev] || []).forEach(function (fn) { fn(a, b); }); }
  function flush() { while (timers.length) timers.shift()(); var t = sent.join('\n'); sent.length = 0; return t; }
  return {
    ctx: ctx, clock: clock, attr: attr, wrap: wrap, fire: fire, flush: flush, intervals: intervals,
    tick: function (ms) { clock.now += ms; intervals.forEach(function (i) { i.fn(); }); return flush(); },
    say: function (content, who) {
      fire('chat:message', { type: 'api', content: content, who: who || 'Sheo (GM)', playerid: 'P1' });
      return flush();
    }
  };
}

var OLD = NOW - 30 * 24 * 3600000;
var ITEM = '-ItemRow0000000000001', OLDROW = '-OldRow00000000000001';
var r = fakeRoll20();
r.attr('PAZ', 'repeating_item_' + ITEM + '_name', 'marteau de guerre +3 +saint', OLD);
r.attr('PAZ', 'repeating_weapon_' + OLDROW + '_name', 'marteau de guerre +3 +saint', OLD);
r.attr('PAZ', 'repeating_weapon_' + OLDROW + '_source-item', ITEM, OLD);
r.attr('MOB', 'repeating_weapon_-MobRow0000000000001_name', 'Griffe', OLD);
r.fire('add:attribute', r.wrap(r.attr('PAZ', 'repeating_weapon_' + OLDROW + '_notes', 'x')));
ok(r.flush() === '', 'avant ready : rien');

r.fire('ready');
var out = r.flush();
ok(/redémarrage du sandbox API \(écritures des scripts surveillées : attributs via findObjs\/getObj\/on, createObj\) · connectés : Sheo, Tankadlavie/.test(out), 'redémarrage enregistré, espion installé sur chaque attribut');
ok(r.intervals.length === 1 && r.intervals[0].ms === 10000, 'relecture toutes les 10 s');
ok(r.ctx.state.AttackWatch.known.PAZ && !r.ctx.state.AttackWatch.known.MOB, 'seuls les personnages joués sont surveillés');
ok(/1 personnages joués surveillés, \d+ attributs sous l'espion/.test(r.say('!attackwatch')), 'état : personnages surveillés et espion');

// cas du 18 octobre : une ligne apparaît sans aucun évènement (changement fait côté API)
r.say('!pfc --rest', 'Tankadlavie');
r.clock.now += 20000;
r.fire('change:attribute', r.wrap(r.attr('PAZ', 'repeating_item_' + ITEM + '_qty', '1', OLD)), { current: '2' });
var COPY = '-NewRow00000000000001';
r.attr('PAZ', 'repeating_weapon_' + COPY + '_name', 'marteau de guerre +3 +saint');
r.attr('PAZ', 'repeating_weapon_' + COPY + '_source-item', ITEM);
out = r.tick(5000);
ok(/Paz Tarpou<\/b> : nouvelle attaque « marteau de guerre \+3 \+saint », objet « marteau de guerre \+3 \+saint »/.test(out), 'ligne sans évènement trouvée par relecture');
ok(/vue à 18:28:25/.test(out), 'heure à laquelle elle a été vue');
ok(/avant : 18:28:00 Tankadlavie : !pfc --rest/.test(out), 'contexte : commande API d\'avant');
ok(/18:28:20 Paz Tarpou : objet « marteau de guerre \+3 \+saint » qty 2 → 1/.test(out), 'contexte : modification d\'objet d\'avant');
ok(out.split('nouvelle attaque').length === 2, 'une seule annonce');
ok(r.tick(10000) === '', 'relecture suivante : rien de neuf');
ok(r.ctx.state.AttackWatch.log.some(function (e) { return e.kind === 'row' && e.context.length === 2; }), 'contexte gardé dans le journal');

// bouton : changement journalisé, puis la ligne trouvée à la relecture
var btn = r.attr('PAZ', 'repeating_item_' + ITEM + '_create-attack-entry', '1', OLD);
r.fire('change:attribute', r.wrap(btn), { current: '0' });
out = r.flush();
ok(/Paz Tarpou<\/b> : bouton « create attack » de objet « marteau de guerre \+3 \+saint » 0 -> 1/.test(out), 'changement du bouton journalisé');
r.attr('PAZ', 'repeating_weapon_-NewRow00000000000002_name', 'marteau de guerre +3 +saint');
out = r.tick(10000);
ok(/nouvelle attaque/.test(out) && /bouton create attack de « marteau de guerre \+3 \+saint »/.test(out), 'nouvelle ligne avec le bouton dans le contexte');

// personnage non joué : ignoré ; changements d'objets d'un PNJ : pas dans le contexte
r.attr('MOB', 'repeating_weapon_-MobRow0000000000002_name', 'Morsure');
r.fire('change:attribute', r.wrap(r.attr('MOB', 'repeating_item_-MobItem000000000001_qty', '0', OLD)), { current: '1' });
ok(!/Gobelin/.test(r.tick(10000)) && !/Gobelin/.test(r.say('!attackwatch context')), 'PNJ ignoré');

// lignes créées pendant que le sandbox était arrêté : vues au redémarrage
var r3 = fakeRoll20();
r3.attr('PAZ', 'repeating_weapon_' + OLDROW + '_name', 'Marteau', OLD);
r3.ctx.state.AttackWatch = { on: true, log: [], known: { PAZ: {} } };
r3.ctx.state.AttackWatch.known.PAZ[OLDROW.toLowerCase()] = 1;
r3.attr('PAZ', 'repeating_weapon_-NewRow00000000000009_name', 'Marteau');
r3.fire('ready');
ok(/nouvelle attaque « Marteau », sans lien \(vue au redémarrage, à/.test(r3.flush()), 'ligne apparue pendant l\'arrêt : signalée au redémarrage');

// commandes
ok(/Contexte des 3 dernières minutes/.test(r.say('!attackwatch context')), 'commande context');
out = r.say('!attackwatch log');
ok(/redémarrage/.test(out) && /nouvelle attaque/.test(out), 'journal');
ok(/coupée/.test(r.say('!attackwatch off')), 'off');
r.attr('PAZ', 'repeating_weapon_-NewRow00000000000003_name', 'X');
ok(r.tick(10000) === '', 'coupé : rien enregistré');
ok(/activée/.test(r.say('!attackwatch ON')), 'on, casse ignorée');
ok(/Journal vidé/.test(r.say('!attackwatch clear')) && /Journal vide/.test(r.say('!attackwatch log')), 'clear');
ok(/Usage/.test(r.say('!attackwatch tout')), 'option inconnue');
eq(r.say('!attackwatchX'), '', 'autre commande ignorée');
eq(fakeRoll20(false).say('!attackwatch log'), '', 'joueur non MJ ignoré');

// --- espion : écritures faites par un AUTRE script API (aucun évènement Roll20 dans ce cas)
eq(W.callers('Error\n    at Attr.spyWrap [as setWithWorker] (apiscript.js:10:5)\n    at setResource (apiscript.js:900:3)\n    at Object.applyConditions (apiscript.js:1200:9)\n    at apiscript.js:5:1',
  /(spyWrap|logWrite)/, 4), ['setResource', 'Object.applyConditions', '(anonyme)'], 'noms des fonctions appelantes');
ok(W.watchedName('repeating_item_-A_create-attack-entry') && W.watchedName('repeating_weapon_-B_name') && !W.watchedName('HP'), 'champs surveillés');
(function () {
  var sent = [], handlers = {}, created = [];
  function Attr(o) { this.o = o; this.id = o.id; }
  Attr.prototype.get = function (k) { return this.o[k.replace(/^_/, '')]; };
  Attr.prototype.set = function (k, v) { if (typeof k === 'object') Object.assign(this.o, k); else this.o[k] = v; };
  Attr.prototype.setWithWorker = function (k, v) { this.set(k, v); };
  var objs = [
    { type: 'character', id: 'PAZ', name: 'Paz Tarpou', controlledby: 'P2' },
    new Attr({ type: 'attribute', id: pidAt(NOW), characterid: 'PAZ', name: 'repeating_item_-I1_create-attack-entry', current: '0' }),
    new Attr({ type: 'attribute', id: pidAt(NOW), characterid: 'PAZ', name: 'HP', current: '10' })
  ];
  function get(o, k) { return o instanceof Attr ? o.get(k) : o[k.replace(/^_/, '')]; }
  var ctx = {
    console: console, state: {}, Date: (function () { function D() { return arguments.length ? new Date(arguments[0]) : new Date(NOW); } D.now = function () { return NOW; }; return D; })(),
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    findObjs: function (q) {
      return objs.filter(function (o) { return Object.keys(q).every(function (k) { return get(o, k) === q[k]; }); })
        .map(function (o) { return o instanceof Attr ? o : { id: o.id, get: function (k) { return get(o, k); } }; });
    },
    getObj: function (t, id) { var o = objs.filter(function (x) { return get(x, 'type') === t && x.id === id; })[0]; return o && { id: o.id, get: function (k) { return get(o, k); } }; },
    playerIsGM: function () { return true; },
    sendChat: function (f, t) { sent.push(t); },
    createObj: function (type, props) { var o = new Attr(Object.assign({ type: type, id: pidAt(NOW) }, props, { characterid: props.characterid })); objs.push(o); created.push(props.name); return o; },
    setTimeout: function (fn) { fn(); }, setInterval: function () {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/attackwatch.js'), 'utf8'), ctx);
  (handlers.ready || []).forEach(function (fn) { fn(); });
  ok(/écritures des scripts surveillées : set, setWithWorker, createObj/.test(sent.join('\n')), 'espion installé sur set, setWithWorker et createObj');
  sent.length = 0;
  // un « autre script » écrit le bouton avec setWithWorker, puis HP
  vm.runInContext("function setResource(a){ a.setWithWorker('current','1'); } function autreScript(){ var a = findObjs({_type:'attribute', name:'repeating_item_-I1_create-attack-entry'})[0]; setResource(a); findObjs({_type:'attribute', name:'HP'})[0].set('current','9'); } autreScript();", ctx);
  var t = sent.join('\n');
  ok(/Paz Tarpou<\/b> : écriture par un script API, setWithWorker repeating_item_-I1_create-attack-entry = 1 \(appelée par : setResource ← autreScript/.test(t), 'écriture du bouton par un script : vue, avec l\'appelant');
  ok(!/HP/.test(t), 'écriture d\'un autre champ : ignorée');
  var btn = objs[1];
  ok(btn.get('current') === '1', 'l\'écriture d\'origine a bien eu lieu');
  sent.length = 0;
  vm.runInContext("function creerLigne(){ createObj('attribute', {characterid:'PAZ', name:'repeating_weapon_-W9_name', current:'Copie'}); } creerLigne();", ctx);
  ok(/écriture par un script API, createObj repeating_weapon_-W9_name = Copie \(appelée par : creerLigne/.test(sent.join('\n')) && created.length === 1, 'création d\'une ligne d\'attaque par un script : vue');
  sent.length = 0;
  (handlers['chat:message'] || []).forEach(function (fn) { fn({ type: 'api', content: '!attackwatch context', who: 'Sheo (GM)', playerid: 'P1' }); });
  ok(/écriture API setWithWorker repeating_item_-I1_create-attack-entry = 1 par setResource ← autreScript/.test(sent.join('\n')), 'écriture d\'un script visible dans le contexte');
})();

// --- espion, cas Roll20 réel : set / setWithWorker portés par chaque attribut (pas par un prototype)
(function () {
  var sent = [], handlers = {};
  function mk(o) {
    var obj = { id: o.id };
    obj.get = function (k) { return o[k.replace(/^_/, '')]; };
    obj.set = function (k, v) { if (typeof k === 'object') Object.assign(o, k); else o[k] = v; };
    obj.setWithWorker = function (k, v) { obj.set(k, v); };
    return obj;
  }
  var raw = [
    { type: 'character', id: 'SOL', name: 'Solathia Innveigdottir', controlledby: 'P3' },
    { type: 'attribute', id: pidAt(NOW), characterid: 'SOL', name: 'repeating_item_-N1_create-attack-entry', current: '0' }
  ];
  var objs = raw.map(mk);
  var ctx = {
    console: console, state: {}, Date: (function () { function D() { return arguments.length ? new Date(arguments[0]) : new Date(NOW); } D.now = function () { return NOW; }; return D; })(),
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    findObjs: function (q) { return objs.filter(function (o) { return Object.keys(q).every(function (k) { return o.get(k) === q[k]; }); }); },
    filterObjs: function (f) { return objs.filter(f); },
    getObj: function (t, id) { return objs.filter(function (o) { return o.get('type') === t && o.id === id; })[0]; },
    playerIsGM: function () { return true; },
    sendChat: function (f, t) { sent.push(t); },
    createObj: function () { return null; },
    setTimeout: function (fn) { fn(); }, setInterval: function () {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/attackwatch.js'), 'utf8'), ctx);
  (handlers.ready || []).forEach(function (fn) { fn(); });
  ok(/écritures des scripts surveillées : attributs via findObjs\/filterObjs\/getObj\/on, createObj/.test(sent.join('\n')), 'méthodes par attribut : espion via findObjs, filterObjs, getObj et on');
  sent.length = 0;
  vm.runInContext("function rafraichir(){ var a = findObjs({_type:'attribute', name:'repeating_item_-N1_create-attack-entry'})[0]; a.setWithWorker({current:'1'}); } rafraichir();", ctx);
  ok(/Solathia Innveigdottir<\/b> : écriture par un script API, setWithWorker repeating_item_-N1_create-attack-entry = 1 \(appelée par : rafraichir/.test(sent.join('\n')), 'écriture via un objet de findObjs : vue');
  ok(raw[1].current === '1', 'écriture d\'origine faite');
  sent.length = 0;
  vm.runInContext("getObj('attribute', findObjs({_type:'attribute'})[0].id).set('current','0');", ctx);
  ok(/écriture par un script API, set repeating_item_-N1_create-attack-entry = 0/.test(sent.join('\n')), 'écriture via getObj : vue, une seule fois');
  ok(sent.length === 1, 'objet déjà enveloppé : pas de double journal');
})();

console.log(pass + ' réussis, ' + fail + ' échecs');
process.exit(fail ? 1 : 0);
