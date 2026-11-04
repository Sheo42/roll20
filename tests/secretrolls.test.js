// node tests/secretrolls.test.js : tests sans dépendance de scripts/secretrolls.js (logique pure + flux complet avec un faux Roll20)
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var S = require('../scripts/secretrolls.js');

var pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log('ÉCHEC: ' + label); } }
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' -> ' + JSON.stringify(a) + ' attendu ' + JSON.stringify(b)); }

// --- logique pure
var act = S.secretAction();
ok(act.indexOf('/w "@{character_name}" &{template:pf_generic} {{name=Jets secrets}} {{') === 0 && /\}\}$/.test(act), 'menu chuchoté au personnage, modèle pf_generic');
ok(act.indexOf('[Perception (@{perception})](`/sr 1d20+@{perception}[Perception])') > 0, 'bouton Perception : bonus affiché, jet secret par accent grave (forme testée dans le jeu)');
eq((act.match(/\]\(`\/sr 1d20\+@\{/g) || []).length, 13, '13 boutons');
ok(act.indexOf('#13;') < 0 && act.indexOf('!secretroll') < 0, 'ni astuce &#13; ni appel au script');
ok(S.SKILLS.every(function (s) { return !/[()\[\]|]/.test(s[0]); }), 'pas de caractère qui casse un bouton dans les libellés');
ok(act.indexOf('~') < 0, 'aucun appel de capacité');
ok(S.isOurs('Secret') && S.isOurs('sr-stealth') && !S.isOurs('sr-autre') && !S.isOurs('All Skills'), 'reconnaît ses capacités seulement');

var p = S.plan([]);
ok(p.create && p.create.name === 'Secret' && p.create.istokenaction && !p.update && !p.remove.length, 'rien : à créer');
p = S.plan([{ id: 'a', name: 'Secret', action: act, istokenaction: true }]);
ok(p.same && !S.hasWork(p) && S.describe(p) === 'à jour', 'déjà là : à jour');
p = S.plan([{ id: 'a', name: 'Secret', action: 'vieux menu', istokenaction: true }, { id: 'b', name: 'sr-bluff' },
  { id: 'c', name: 'sr-perception' }, { id: 'd', name: 'All Skills' }]);
ok(p.update === 'a' && !p.create, 'ancienne version : mise à jour');
eq(p.remove, ['b', 'c'], 'anciennes capacités sr- à retirer, All Skills gardée');
eq(S.describe(p), 'à mettre à jour, 2 ancienne(s) capacité(s) à retirer', 'description');
p = S.plan([{ id: 'a', name: 'Secret', action: act, istokenaction: false }, { id: 'e', name: 'Secret', action: act, istokenaction: true }]);
ok(p.update === 'a', 'pas en action de token : mise à jour');
eq(p.remove, ['e'], 'doublon retiré');

eq(S.parseArgs('!secretrolls'), { all: false, remove: false, confirm: null, auto: null, bad: [] }, 'sans option');
eq(S.parseArgs('!secretrolls ALL confirm 4'), { all: true, remove: false, confirm: 4, auto: null, bad: [] }, 'all confirm N');
eq(S.parseArgs('!secretrolls remove all').remove, true, 'remove all');
eq(S.parseArgs('!secretrolls auto off').auto, 'off', 'auto off');
eq(S.parseArgs('!secretrolls tous confirmer 2').bad, ['tous', 'confirmer', '2'], 'options françaises refusées');

// --- faux Roll20
function world() {
  var objs = [], chat = [], sent = [], handlers = {}, n = 0;
  function mk(type, props) {
    var o = { id: props._id || ('id' + (n++)), _type: type, p: Object.assign({}, props) };
    o.get = function (k) { return k === '_id' || k === 'id' ? o.id : (k === '_type' ? type : o.p[k]); };
    o.set = function (k, v) { if (typeof k === 'object') Object.assign(o.p, k); else o.p[k] = v; };
    o.remove = function () { objs = objs.filter(function (x) { return x !== o; }); };
    objs.push(o); return o;
  }
  var ctx = {
    on: function (ev, f) { (handlers[ev] = handlers[ev] || []).push(f); },
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
    sendChat: function (who, text) { chat.push(text); sent.push({ who: who, text: text }); },
    getAttrByName: function (cid, name) {
      var a = objs.filter(function (o) { return o._type === 'attribute' && o.p._characterid === cid && o.p.name === name; })[0];
      return a ? a.p.current : '';
    },
    playerIsGM: function (pid) { return pid === 'gm'; },
    state: {},
    console: console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/secretrolls.js'), 'utf8'), ctx);
  function emit(ev, a, b) { (handlers[ev] || []).forEach(function (f) { f(a, b); }); }
  return {
    mk: mk, chat: chat, sent: sent, emit: emit,
    // comme Roll20 : change:character puis change:character:<champ>
    fire: function (o, changes) {
      o.set(changes); emit('change:' + o._type, o, {});
      Object.keys(changes).forEach(function (k) { emit('change:' + o._type + ':' + k, o, {}); });
    },
    abilities: function (cid) { return objs.filter(function (o) { return o._type === 'ability' && o.p._characterid === cid; }); },
    say: function (content, sel, pid) { emit('chat:message', { type: 'api', content: content, playerid: pid || 'gm', selected: sel }); return chat[chat.length - 1]; }
  };
}
function names(list) { return list.map(function (a) { return a.p.name; }).sort(); }

var w = world();
w.mk('character', { _id: 'cPaz', name: 'Paz Tarpou', controlledby: 'p1' });
w.mk('graphic', { _id: 'tPaz', represents: 'cPaz' });
w.emit('add:graphic', w.mk('graphic', { _id: 'tOld', represents: 'cPaz' }));
eq(w.abilities('cPaz').length, 0, 'avant « ready » : rien (tokens chargés au démarrage)');
w.emit('ready');

w.mk('character', { _id: 'cLune', name: 'Lune', controlledby: 'p2' });
w.mk('character', { _id: 'cGob', name: 'Gobelin', controlledby: '' });
w.mk('graphic', { _id: 'tPaz2', represents: 'cPaz' });
w.mk('ability', { _characterid: 'cPaz', name: 'All Skills', action: '%{Paz Tarpou|skills}', istokenaction: true });
// ancienne version : 13 capacités cachées
S.SKILLS.forEach(function (s) { w.mk('ability', { _characterid: 'cPaz', name: 'sr-' + s[1], action: 'x', istokenaction: false }); });
w.mk('ability', { _characterid: 'cPaz', name: 'Secret', action: 'vieux menu', istokenaction: true });

var before = w.chat.length;
w.say('!secretrolls', [{ _id: 'tPaz' }], 'p1');
ok(w.chat.length === before, 'un joueur ne peut pas lancer la commande');

var out = w.say('!secretrolls', [{ _id: 'tPaz' }, { _id: 'tPaz2' }]);
ok(/Essai à blanc/.test(out) && /\(1 personnage/.test(out) && /à mettre à jour, 13 ancienne/.test(out), 'essai à blanc : un seul personnage malgré 2 tokens');
ok(/\[Confirmer\]\(!secretrolls confirm 1\)/.test(out), 'bouton de confirmation');
eq(w.abilities('cPaz').length, 15, 'essai à blanc : rien touché');

out = w.say('!secretrolls confirm 2', [{ _id: 'tPaz' }]);
ok(/Le nombre a changé/.test(out) && w.abilities('cPaz').length === 15, 'mauvais nombre : refusé');

w.say('!secretrolls confirm 1', [{ _id: 'tPaz' }]);
eq(names(w.abilities('cPaz')), ['All Skills', 'Secret'], 'mise à jour : plus que Secret (et All Skills)');
var sec = w.abilities('cPaz').filter(function (a) { return a.p.name === 'Secret'; })[0];
ok(sec.p.istokenaction === true && sec.p.action === act, 'Secret : action de token, menu de boutons');

out = w.say('!secretrolls', [{ _id: 'tPaz' }]);
ok(/Paz Tarpou<\/b> : à jour/.test(out), 'relance : à jour');

out = w.say('!secretrolls all');
ok(/\(2 personnage/.test(out) && /Lune/.test(out) && !/Gobelin/.test(out), 'all : PJ seulement');

out = w.say('!secretrolls remove', [{ _id: 'tPaz' }]);
ok(/1 capacité\(s\) à retirer/.test(out), 'remove : essai à blanc');
w.say('!secretrolls remove confirm 1', [{ _id: 'tPaz' }]);
eq(names(w.abilities('cPaz')), ['All Skills'], 'remove : ne retire que sa capacité');

out = w.say('!secretrolls', []);
ok(/Sélectionne des tokens/.test(out), 'rien de sélectionné');
out = w.say('!secretrolls tous');
ok(/Option inconnue/.test(out), 'option inconnue');

// --- ajout automatique
var w2 = world();
w2.emit('ready');
var neu = w2.mk('character', { _id: 'cNew', name: '', controlledby: '' });
w2.emit('add:character', neu);
w2.fire(neu, { name: 'Nouveau PJ' });
eq(w2.abilities('cNew').length, 0, 'sans joueur (PNJ) : rien');
w2.fire(neu, { controlledby: 'p3' });
eq(names(w2.abilities('cNew')), ['Secret'], 'reçoit un joueur : bouton ajouté');
ok(/Nouveau PJ<\/b> : bouton Secret ajouté/.test(w2.chat[w2.chat.length - 1]), 'MJ prévenu');
var nb = w2.chat.length;
w2.fire(neu, { name: 'Nouveau Nom', bio: 'x' });
ok(w2.chat.length === nb && w2.abilities('cNew').length === 1, 'autre changement : rien à faire, silence');

// fiche toute neuve qui reçoit tout d'un coup, seulement change:character (sans :controlledby)
var fresh = w2.mk('character', { _id: 'cFresh', name: '', controlledby: '' });
fresh.set({ name: 'Frais', controlledby: 'p4' });
w2.emit('change:character', fresh, {});
eq(names(w2.abilities('cFresh')), ['Secret'], 'fiche neuve : ajouté sur change:character');

// joueur ajouté sans évènement sur le personnage : rattrapé quand un token est posé
var quiet = w2.mk('character', { _id: 'cQuiet', name: 'Discret', controlledby: 'p5' });
w2.emit('add:graphic', w2.mk('graphic', { _id: 'tQ', represents: 'cQuiet' }));
eq(names(w2.abilities('cQuiet')), ['Secret'], 'token posé : ajouté');
var q2 = w2.mk('character', { _id: 'cQ2', name: 'Autre', controlledby: 'p6' });
var tq2 = w2.mk('graphic', { _id: 'tQ2', represents: '' });
w2.emit('add:graphic', tq2);
tq2.set('represents', 'cQ2'); w2.emit('change:graphic:represents', tq2, {});
eq(names(w2.abilities('cQ2')), ['Secret'], 'token relié à un personnage : ajouté');
w2.emit('add:graphic', w2.mk('graphic', { _id: 'tNone', represents: '' }));
ok(true, 'token sans personnage : pas d\'erreur');

w2.say('!secretrolls auto off');
var off = w2.mk('character', { _id: 'cOff', name: 'Off', controlledby: '' });
w2.fire(off, { controlledby: 'p7' });
eq(w2.abilities('cOff').length, 0, 'auto off : rien ajouté');
w2.say('!secretrolls auto on');
w2.fire(off, { name: 'Off PJ' });
eq(w2.abilities('cOff').length, 1, 'auto on : ajouté');

console.log(pass + ' OK, ' + fail + ' échec(s)');
process.exit(fail ? 1 : 0);
