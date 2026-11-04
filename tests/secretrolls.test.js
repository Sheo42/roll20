// node tests/secretrolls.test.js : tests sans dépendance de scripts/secretrolls.js (logique pure + flux complet avec un faux Roll20)
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var S = require('../scripts/secretrolls.js');

var pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log('ÉCHEC: ' + label); } }
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' -> ' + JSON.stringify(a) + ' attendu ' + JSON.stringify(b)); }

// --- logique pure
eq(S.rollAction('Perception', 'perception'), '/sr 1d20+@{perception}[Perception]', 'jet secret avec libellé (forme testée dans le jeu)');
var menu = S.menuAction('Paz Tarpou');
ok(menu.indexOf('/w "Paz Tarpou" &{template:pf_generic} {{name=Jets secrets}} {{') === 0, 'menu chuchoté au personnage, modèle pf_generic');
ok(menu.indexOf('[Perception (@{perception})](~Paz Tarpou|sr-perception)') > 0, 'bouton Perception avec bonus, appelle la capacité');
ok(menu.indexOf('&#13;') < 0 && menu.indexOf('/sr') < 0, 'pas de &#13; ni de /sr dans le menu');
eq((menu.match(/\]\(~/g) || []).length, 13, '13 boutons');
eq(S.wanted('X').length, 14, '1 action de token + 13 jets');
eq(S.wanted('X').filter(function (w) { return w.istokenaction; }).map(function (w) { return w.name; }), ['Secret'], 'seul « Secret » est une action de token');
ok(S.isOurs('Secret') && S.isOurs('sr-stealth') && !S.isOurs('sr-autre') && !S.isOurs('All Skills'), 'reconnaît ses capacités seulement');
ok(S.nameProblem('Solathia Innveigdottir') === null, 'nom normal accepté');
ok(S.nameProblem('Lune (test)') !== null && S.nameProblem('a|b') !== null && S.nameProblem(' ') !== null, 'noms qui casseraient le bouton refusés');

var p = S.plan('X', []);
eq([p.create.length, p.update.length, p.same], [14, 0, 0], 'tout à créer');
var all = S.wanted('X');
p = S.plan('X', all.map(function (w) { return { name: w.name, action: w.action, istokenaction: w.istokenaction }; }));
eq([p.create.length, p.update.length, p.same], [0, 0, 14], 'tout à jour');
p = S.plan('X', [{ name: 'Secret', action: 'vieux', istokenaction: true }, { name: 'sr-bluff', action: S.rollAction('Bluff', 'bluff'), istokenaction: true }]);
eq([p.create.length, p.update.length, p.same], [12, 2, 0], 'action changée et action de token à tort : mises à jour');

eq(S.parseArgs('!secretrolls'), { all: false, remove: false, confirm: null, bad: [] }, 'sans option');
eq(S.parseArgs('!secretrolls ALL confirm 4'), { all: true, remove: false, confirm: 4, bad: [] }, 'all confirm N');
eq(S.parseArgs('!secretrolls remove all'), { all: true, remove: true, confirm: null, bad: [] }, 'remove all');
eq(S.parseArgs('!secretrolls tous confirmer 2').bad, ['tous', 'confirmer', '2'], 'options françaises refusées');

// --- faux Roll20
function world() {
  var objs = [], chat = [], handlers = {}, n = 0;
  function mk(type, props) {
    var o = { id: props._id || ('id' + (n++)), _type: type, p: Object.assign({}, props) };
    o.get = function (k) { return k === '_id' || k === 'id' ? o.id : (k === '_type' ? type : o.p[k]); };
    o.set = function (k, v) { if (typeof k === 'object') Object.assign(o.p, k); else o.p[k] = v; };
    o.remove = function () { objs = objs.filter(function (x) { return x !== o; }); };
    objs.push(o); return o;
  }
  var ctx = {
    on: function (ev, f) { handlers[ev] = f; },
    getObj: function (t, id) { return objs.filter(function (o) { return o._type === t && o.id === id; })[0]; },
    findObjs: function (q) {
      return objs.filter(function (o) {
        return Object.keys(q).every(function (k) {
          if (k === 'type') return o._type === q.type;
          if (k === 'characterid') return o.p._characterid === q.characterid;
          return o.p[k] === q[k];
        });
      });
    },
    createObj: function (t, props) { return mk(t, props); },
    sendChat: function (who, text) { chat.push(text); },
    playerIsGM: function (pid) { return pid === 'gm'; },
    state: {},
    console: console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/secretrolls.js'), 'utf8'), ctx);
  return {
    mk: mk, chat: chat,
    fire: function (ev, o, changes) { o.set(changes); if (handlers[ev]) handlers[ev](o, {}); },
    abilities: function (cid) { return objs.filter(function (o) { return o._type === 'ability' && o.p._characterid === cid; }); },
    say: function (content, sel, pid) { handlers['chat:message']({ type: 'api', content: content, playerid: pid || 'gm', selected: sel }); return chat[chat.length - 1]; }
  };
}

var w = world();
var paz = w.mk('character', { _id: 'cPaz', name: 'Paz Tarpou', controlledby: 'p1' });
var lune = w.mk('character', { _id: 'cLune', name: 'Lune', controlledby: 'p2' });
w.mk('character', { _id: 'cGob', name: 'Gobelin', controlledby: '' });
var tokPaz = w.mk('graphic', { _id: 'tPaz', represents: 'cPaz' });
w.mk('graphic', { _id: 'tPaz2', represents: 'cPaz' });
w.mk('ability', { _characterid: 'cPaz', name: 'All Skills', action: '%{Paz Tarpou|skills}', istokenaction: true });

var before = w.chat.length;
w.say('!secretrolls', [{ _id: 'tPaz' }], 'p1');
ok(w.chat.length === before, 'un joueur ne peut pas lancer la commande');

var out = w.say('!secretrolls', [{ _id: 'tPaz' }, { _id: 'tPaz2' }]);
ok(/Essai à blanc/.test(out) && /\(1 personnage/.test(out) && /14 à créer/.test(out), 'essai à blanc : un seul personnage malgré 2 tokens');
ok(/\[Confirmer\]\(!secretrolls confirm 1\)/.test(out), 'bouton de confirmation');
eq(w.abilities('cPaz').length, 1, 'essai à blanc : rien créé');

out = w.say('!secretrolls confirm 2', [{ _id: 'tPaz' }]);
ok(/Le nombre a changé/.test(out) && w.abilities('cPaz').length === 1, 'mauvais nombre : refusé');

w.say('!secretrolls confirm 1', [{ _id: 'tPaz' }]);
var abs = w.abilities('cPaz');
eq(abs.length, 15, '14 capacités créées, All Skills gardée');
var sec = abs.filter(function (a) { return a.p.name === 'Secret'; })[0];
ok(sec && sec.p.istokenaction === true && sec.p.action === S.menuAction('Paz Tarpou'), 'action de token Secret');
var per = abs.filter(function (a) { return a.p.name === 'sr-perception'; })[0];
ok(per && per.p.istokenaction === false && per.p.action === '/sr 1d20+@{perception}[Perception]', 'capacité sr-perception');

out = w.say('!secretrolls', [{ _id: 'tPaz' }]);
ok(/0 à créer, 0 à mettre à jour, 14 à jour/.test(out), 'relance : tout à jour');
sec.set('action', 'modifié');
w.say('!secretrolls confirm 1', [{ _id: 'tPaz' }]);
ok(sec.p.action === S.menuAction('Paz Tarpou') && w.abilities('cPaz').length === 15, 'mise à jour sans doublon');

out = w.say('!secretrolls all');
ok(/\(2 personnage/.test(out) && /Lune/.test(out) && !/Gobelin/.test(out), 'all : PJ seulement');
w.say('!secretrolls all confirm 2');
eq(w.abilities('cLune').length, 14, 'Lune équipée');

out = w.say('!secretrolls remove', [{ _id: 'tPaz' }]);
ok(/14 capacité\(s\) à retirer/.test(out) && w.abilities('cPaz').length === 15, 'remove : essai à blanc');
w.say('!secretrolls remove confirm 1', [{ _id: 'tPaz' }]);
eq(w.abilities('cPaz').map(function (a) { return a.p.name; }), ['All Skills'], 'remove : ne retire que ses capacités');

w.mk('character', { _id: 'cBad', name: 'Lune (copie)', controlledby: 'p2' });
w.mk('graphic', { _id: 'tBad', represents: 'cBad' });
out = w.say('!secretrolls', [{ _id: 'tBad' }]);
ok(/ignoré/.test(out) && /\(0 personnage/.test(out) && !/Confirmer/.test(out), 'nom avec parenthèses ignoré');
out = w.say('!secretrolls', []);
ok(/Sélectionne des tokens/.test(out), 'rien de sélectionné');
out = w.say('!secretrolls tous');
ok(/Option inconnue/.test(out), 'option inconnue');

// --- ajout automatique
eq(S.parseArgs('!secretrolls auto off').auto, 'off', 'auto off lu');
var w2 = world();
var neu = w2.mk('character', { _id: 'cNew', name: '', controlledby: '' });
w2.fire('change:character:name', neu, { name: 'Nouveau PJ' });
eq(w2.abilities('cNew').length, 0, 'nommé mais sans joueur (PNJ) : rien');
w2.fire('change:character:controlledby', neu, { controlledby: 'p3' });
eq(w2.abilities('cNew').length, 14, 'reçoit un joueur : 14 capacités ajoutées');
ok(/Nouveau PJ<\/b> : bouton Secret ajouté/.test(w2.chat[w2.chat.length - 1]), 'MJ prévenu');
w2.fire('change:character:name', neu, { name: 'Nouveau Nom' });
var s2 = w2.abilities('cNew').filter(function (a) { return a.p.name === 'Secret'; })[0];
ok(s2.p.action === S.menuAction('Nouveau Nom') && w2.abilities('cNew').length === 14, 'renommé : menu mis à jour, sans doublon');
var nb = w2.chat.length;
w2.fire('change:character:controlledby', neu, { controlledby: 'p3,p4' });
ok(w2.chat.length === nb && w2.abilities('cNew').length === 14, 'rien à faire : silence');
w2.fire('change:character:name', neu, { name: 'Nom (copie)' });
ok(s2.p.action === S.menuAction('Nouveau Nom'), 'nom invalide : rien touché');
w2.say('!secretrolls auto off');
var off = w2.mk('character', { _id: 'cOff', name: 'Autre', controlledby: '' });
w2.fire('change:character:controlledby', off, { controlledby: 'p5' });
eq(w2.abilities('cOff').length, 0, 'auto off : rien ajouté');
w2.say('!secretrolls auto on');
w2.fire('change:character:name', off, { name: 'Autre PJ' });
eq(w2.abilities('cOff').length, 14, 'auto on : ajouté');

console.log(pass + ' OK, ' + fail + ' échec(s)');
process.exit(fail ? 1 : 0);
