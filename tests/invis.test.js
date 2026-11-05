/*
 * invis.test.js — tests de invis.js (script API Roll20), seul et avec bufftracker.js
 *
 * Lancer :  node tests/invis.test.js
 *
 * Aucune dépendance : Node.js suffit. Logique pure, puis flux complet dans un FAUX
 * Roll20 où invis.js et bufftracker.js sont chargés ensemble (comme dans une partie).
 * Non vérifié ici : le rendu réel dans Roll20 (image transparente, nom et barres vus
 * seulement par le propriétaire), qui se vérifie dans la partie de test.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'invis.js');
const BUFF = path.join(__dirname, '..', 'scripts', 'bufftracker.js');
const I = require(SCRIPT);

let total = 0;
const echecs = [];
let groupe = '';
const check = (cond, msg) => {
  total++;
  if (!cond) echecs.push(`[${groupe}] ${msg}`);
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + msg);
};
function describe(nom, fn) {
  groupe = nom;
  console.log('\n## ' + nom);
  try { fn(); } catch (e) {
    total++;
    echecs.push(`[${nom}] exception : ${e.message}`);
    console.log('FAIL exception : ' + e.stack);
  }
}

// =============================================================== LOGIQUE PURE
describe('Noms des effets', () => {
  ['Invisibilité', 'invisibilite', 'Invisibilité suprême', 'Invisibilité de groupe', 'Greater Invisibility', 'Invisibility']
    .forEach((n) => check(I.isInvisBuff(n), `« ${n} » rend invisible`));
  ["Voir l'invisibilité", "Purge d'invisibilité", 'Flou', '', null]
    .forEach((n) => check(!I.isInvisBuff(n), `« ${n} » ne rend pas invisible`));
  check(I.breaksOnAttack('Invisibilité') && !I.breaksOnAttack('Invisibilité suprême') && !I.breaksOnAttack('Greater Invisibility'),
    "l'Invisibilité se rompt en attaquant, pas la suprême");
});

describe('Images', () => {
  const lib = 'https://s3.amazonaws.com/files.d20.io/images/123/abc/max.png?1600';
  check(I.cleanImgsrc(lib) === 'https://s3.amazonaws.com/files.d20.io/images/123/abc/thumb.png?1600', 'bibliothèque : forme thumb');
  check(I.cleanImgsrc('https://s3.amazonaws.com/files.d20.io/marketplace/1/x/thumb.png') === null, 'Marketplace : refusé');
  const sides = [lib, 'https://s3.amazonaws.com/files.d20.io/images/9/vide/med.png?1'].map(encodeURIComponent).join('|');
  check(I.sideImage(sides, 2) === 'https://s3.amazonaws.com/files.d20.io/images/9/vide/thumb.png?1', '2e face décodée');
  check(I.sideImage(encodeURIComponent(lib), 2) === null && I.sideImage('', 2) === null, 'pas de 2e face -> null');
});

describe('Commandes', () => {
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(eq(I.parseCommand('!invis'), { sub: 'toggle', ids: null }), '!invis -> bascule');
  check(eq(I.parseCommand('!invis off --ids a,b'), { sub: 'off', ids: ['a', 'b'] }), 'off avec --ids');
  check(eq(I.parseCommand('!INVIS on'), { sub: 'on', ids: null }), 'majuscules');
  check(I.parseCommand('!invisible') === null && I.parseCommand('!buff') === null, 'autres commandes ignorées');
});

describe('Ce qui est noté et remis', () => {
  const props = { currentside: 0, imgsrc: 'img1', width: 105, height: 105, showplayers_name: true, showplayers_bar1: true, showplayers_bar2: false };
  const snap = I.snapshot((k) => props[k]);
  const h = I.hiddenProps('img2');
  check(h.currentside === 1 && h.imgsrc === 'img2' && h.showplayers_name === false && h.showplayers_bar3 === false && h.showplayers_aura1 === false,
    'caché : 2e face, nom, barres et auras masqués');
  check(!('width' in h) && !('light_radius' in h) && !('statusmarkers' in h), 'caché : ni la taille, ni la lumière, ni les marqueurs');
  const r = I.restoreProps(snap);
  check(r.currentside === 0 && r.imgsrc === 'img1' && r.width === 105 && r.height === 105 && r.showplayers_name && r.showplayers_bar1 && !r.showplayers_bar2,
    'remis : face, image, taille, et la visibilité de chaque barre telle quelle');
});

// ================================================================= FAUX ROLL20
const IMG1 = 'https://s3.amazonaws.com/files.d20.io/images/1/lune/thumb.png?1';
const IMG2 = 'https://s3.amazonaws.com/files.d20.io/images/2/vide/thumb.png?2';
const SIDES = [IMG1, IMG2].map(encodeURIComponent).join('|');

function partie({ avecBuff = true } = {}) {
  const h = {};
  const objs = [];
  let n = 0;
  const chat = [];
  const timers = [];
  const fire = (ev, ...a) => (h[ev] || []).forEach((f) => f(...a));
  const mk = (t, p) => {
    const o = { id: '-ID' + String(++n).padStart(12, '0'), type: t, props: { _type: t, ...p } };
    o.get = (k) => (k === 'id' || k === '_id' ? o.id : o.props[k]);
    o.set = (kv, v) => { if (typeof kv === 'string') o.props[kv] = v; else Object.assign(o.props, kv); };
    o.remove = () => { objs.splice(objs.indexOf(o), 1); if (t === 'graphic') fire('destroy:graphic', o); };
    objs.push(o);
    return o;
  };
  const campagne = mk('campaign', { turnorder: '', playerpageid: 'p1' });
  const sb = {
    state: {}, log() {}, console,
    setTimeout: (f) => timers.push(f),
    on: (e, f) => { (h[e] = h[e] || []).push(f); },
    playerIsGM: (pid) => pid === 'gm',
    sendChat: (w, t) => chat.push(t),
    getObj: (t, i) => objs.find((o) => o.type === t && o.id === i),
    findObjs: (q) => objs.filter((o) => Object.entries(q).every(([k, v]) => o.props[k] === v)),
    createObj: (t, p) => mk(t, p),
    Campaign: () => campagne
  };
  vm.createContext(sb);
  mk('player', { _displayname: 'Denis' }).id = 'pD';
  mk('player', { _displayname: 'Alice' }).id = 'pA';
  mk('page', { name: 'Runeforge' }).id = 'p1';
  const lune = mk('character', { name: 'Lune', controlledby: 'pD' });
  const selea = mk('character', { name: 'Selea', controlledby: 'pA' });
  const tok = (nom, ch, page = 'p1', extra = {}) => mk('graphic', {
    _subtype: 'token', _pageid: page, name: nom, represents: ch ? ch.id : '', bar1_link: ch ? 'hp' : '', controlledby: '',
    sides: SIDES, currentside: 0, imgsrc: IMG1, width: 105, height: 105, statusmarkers: 'red',
    showplayers_name: true, showplayers_bar1: true, showplayers_bar2: false, showplayers_bar3: true,
    showplayers_aura1: true, showplayers_aura2: false, light_radius: 6, ...extra
  });
  const t = { lune: tok('Lune', lune), lune2: tok('Lune', lune, 'p2'), selea: tok('Selea', selea, 'p1', { sides: encodeURIComponent(IMG1) }) };
  if (avecBuff) vm.runInContext(fs.readFileSync(BUFF, 'utf8'), sb);
  vm.runInContext(fs.readFileSync(SCRIPT, 'utf8'), sb);
  fire('ready');
  const dire = (pid, content, selected = []) => {
    const avant = chat.length;
    fire('chat:message', { type: 'api', content, playerid: pid, who: pid, selected: selected.map((x) => ({ _id: x.id, _type: 'graphic' })) });
    return chat.slice(avant).join('\n');
  };
  const cache = (x) => x.props.currentside === 1 && x.props.imgsrc === IMG2 && !x.props.showplayers_name && !x.props.showplayers_bar1 &&
    !x.props.showplayers_bar3 && !x.props.showplayers_aura1;
  const intact = (x) => x.props.currentside === 0 && x.props.imgsrc.startsWith(IMG1.split('?')[0]) && x.props.width === 105 &&
    x.props.showplayers_name && x.props.showplayers_bar1 && !x.props.showplayers_bar2 && x.props.showplayers_bar3 &&
    x.props.showplayers_aura1 && !x.props.showplayers_aura2;
  return { fire, mk, objs, sb, chat, t, tok, lune, selea, dire, cache, intact, timers, buffs: () => sb.state.BuffTracker.buffs };
}

describe('Bascule à la main', () => {
  const p = partie({ avecBuff: false });
  let r = p.dire('pD', '!invis', [p.t.lune]);
  check(p.cache(p.t.lune) && r.includes('Lune est invisible') && r.includes('/w "Denis"'), 'le joueur cache son token');
  check(p.t.lune.props.light_radius === 6 && p.t.lune.props.statusmarkers === 'red', 'lumière et marqueurs gardés');
  p.t.lune.props.width = 140; // Roll20 a redimensionné (changement de face)
  r = p.dire('pD', '!invis', [p.t.lune]);
  check(p.intact(p.t.lune) && r.includes('Lune est visible'), 'rebascule : tout remis, taille comprise, barre 2 toujours cachée');
  check(!p.cache(p.t.lune2), "l'autre token de Lune (autre carte) n'est pas touché à la main");
  r = p.dire('pA', '!invis on', [p.t.lune]);
  check(p.intact(p.t.lune) && r.includes('ne contrôles pas'), "un autre joueur ne peut pas cacher Lune");
  r = p.dire('gm', '!invis on', [p.t.selea]);
  check(p.intact(p.t.selea) || !p.t.selea.props.currentside, 'Selea non touchée');
  check(r.includes("pas de 2e face"), 'token sans 2e face : refusé avec explication');
  p.dire('gm', `!invis on --ids ${p.t.lune.id}`);
  check(p.cache(p.t.lune), 'le MJ cache avec --ids');
  r = p.dire('gm', '!invis list');
  check(r.includes('Lune') && r.includes(`!invis off --ids ${p.t.lune.id}`), 'liste du MJ avec bouton Visible');
  p.dire('gm', '!invis off', [p.t.lune]);
  check(p.intact(p.t.lune), 'off remet le token');
});

describe('Token caché par l\'ancienne macro', () => {
  const p = partie({ avecBuff: false });
  // ancienne macro Invisible : 2e face, nom et barres cachés, rien de noté
  Object.assign(p.t.lune.props, { currentside: 1, imgsrc: IMG2, showplayers_name: false, showplayers_bar1: false, showplayers_bar3: false });
  let r = p.dire('pD', '!invis', [p.t.lune]);
  check(p.t.lune.props.currentside === 0 && p.t.lune.props.imgsrc.startsWith(IMG1.split('?')[0]) && p.t.lune.props.showplayers_name &&
    p.t.lune.props.showplayers_bar1 && p.t.lune.props.width === 105 && r.includes('Lune est visible'), '!invis le rend visible (1re face, nom, barre 1)');
  check(!p.sb.state.Invis.tokens[p.t.lune.id], 'plus rien de noté');
  p.dire('pD', '!invis', [p.t.lune]);
  p.dire('pD', '!invis', [p.t.lune]);
  check(p.t.lune.props.currentside === 0 && p.t.lune.props.showplayers_name, 'puis le cycle normal marche');
  Object.assign(p.t.lune.props, { currentside: 1, imgsrc: IMG2 });
  r = p.dire('pD', '!invis on', [p.t.lune]);
  check(r.includes('déjà invisible'), "on sur un token déjà sur sa 2e face : déjà invisible");
  p.dire('pD', '!invis off', [p.t.lune]);
  check(p.t.lune.props.currentside === 0, 'off le remet sur sa 1re face');
});

describe('Avec bufftracker : Invisibilité', () => {
  const p = partie();
  const avant = p.chat.length;
  p.dire('pD', `!buff add --spell invisibility --cl 15 --targets ${p.t.lune.id}`, [p.t.lune]);
  check(p.buffs().length === 1 && p.buffs()[0].name === 'Invisibilité', 'effet ajouté');
  check(p.cache(p.t.lune) && p.cache(p.t.lune2), 'tous les tokens de Lune sont cachés (toutes les cartes)');
  const msgs = p.chat.slice(avant).join('\n');
  check(msgs.includes(`!invis break --ids ${p.t.lune.id}`) && msgs.includes('/w "Denis"'), 'Denis reçoit le bouton Rompre');
  // un nouveau token de Lune posé sur la carte
  const t3 = p.tok('Lune', p.lune);
  p.fire('add:graphic', t3);
  p.timers.splice(0).forEach((f) => f());
  check(p.cache(t3), 'un token de Lune posé ensuite devient invisible');
  // Rompre
  const r = p.dire('pD', `!invis break --ids ${p.t.lune.id}`);
  check(p.buffs().length === 0 && r.includes('rompue'), "Rompre termine l'effet");
  check(p.intact(p.t.lune) && p.intact(p.t.lune2) && p.intact(t3), 'tous les tokens redeviennent visibles');
  check(p.chat.some((m) => m.includes('Fin') && m.includes('Invisibilité')), 'fin annoncée dans le chat');
});

describe('Avec bufftracker : fin de durée et suprême', () => {
  const p = partie();
  p.dire('gm', `!buff add --name Invisibilité suprême --dur 2r --targets ${p.t.lune.id}`);
  check(p.cache(p.t.lune), 'Invisibilité suprême : caché');
  check(!p.chat.some((m) => m.includes('!invis break')), 'pas de bouton Rompre pour la suprême');
  let r = p.dire('pD', `!invis break --ids ${p.t.lune.id}`);
  check(p.cache(p.t.lune) && p.buffs().length === 1 && r.includes("pas d'invisibilité qui se rompt"), 'Rompre ne termine pas la suprême');
  p.dire('gm', '!buff time 2r confirm 1');
  check(p.buffs().length === 0 && p.intact(p.t.lune) && p.intact(p.t.lune2), "fin de l'effet : visible");
  // les deux à la fois : rompre l'invisibilité simple laisse la suprême
  p.dire('gm', `!buff add --name Invisibilité --dur 10min --targets ${p.t.lune.id}`);
  p.dire('gm', `!buff add --name Invisibilité suprême --dur 5r --targets ${p.t.lune.id}`);
  r = p.dire('pD', `!invis break --ids ${p.t.lune.id}`);
  check(p.cache(p.t.lune) && p.buffs().length === 1 && r.includes('reste invisible'), 'simple rompue, suprême gardée');
  // off : tout se termine
  r = p.dire('pD', '!invis off', [p.t.lune]);
  check(p.buffs().length === 0 && p.intact(p.t.lune) && r.includes('fin de son invisibilité'), 'off termine les effets et remet le token');
});

describe('Avec bufftracker : à la main puis effet, et autres effets', () => {
  const p = partie();
  p.dire('pD', '!invis on', [p.t.lune]);
  p.dire('gm', `!buff add --name Invisibilité --dur 3r --targets ${p.t.lune.id}`);
  check(p.cache(p.t.lune) && p.cache(p.t.lune2), "caché à la main puis par l'effet : tous ses tokens");
  p.dire('gm', `!buff remove ${p.buffs()[0].id} confirm 1`);
  check(p.intact(p.t.lune), "effet retiré : visible (l'effet a pris le relais)");
  p.dire('gm', `!buff add --name Voir l'invisibilité --dur 10min --targets ${p.t.lune.id}`);
  p.dire('gm', `!buff add --spell bless --cl 5 --targets ${p.t.lune.id}`);
  check(p.intact(p.t.lune), "Voir l'invisibilité et Bénédiction ne cachent rien");
  p.dire('gm', `!buff add --name Invisibilité --dur 3r --targets ${p.t.selea.id}`);
  check(p.chat.some((m) => m.includes('Selea') && m.includes('2e face')), 'token sans 2e face : le MJ est prévenu');
  const n = p.chat.length;
  p.dire('gm', '!buff time 1r confirm 3');
  check(!p.chat.slice(n).some((m) => m.includes('2e face')), 'prévenu une seule fois');
  // token supprimé pendant qu'il est invisible
  p.dire('pD', '!invis on', [p.t.lune2]);
  p.t.lune2.remove();
  check(!p.sb.state.Invis.tokens[p.t.lune2.id], 'token supprimé : oublié');
});

describe('Redémarrage du script', () => {
  const p = partie();
  p.dire('gm', `!buff add --name Invisibilité --dur 10min --targets ${p.t.lune.id}`);
  p.fire('ready');
  check(p.cache(p.t.lune) && Object.keys(p.sb.state.Invis.tokens).length === 2, 'toujours caché, rien en double');
  p.dire('gm', '!buff clear all confirm 1');
  check(p.intact(p.t.lune) && p.intact(p.t.lune2), 'clear all : visible');
});

console.log(`\n${total - echecs.length}/${total} vérifications réussies`);
if (echecs.length) { console.log('\nÉCHECS :\n' + echecs.join('\n')); process.exit(1); }
