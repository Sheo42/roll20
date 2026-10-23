/*
 * altitude.test.js — tests de altitude.js (script API Roll20)
 *
 * Lancer :  node tests/altitude.test.js            (teste scripts/altitude.js)
 *           node tests/altitude.test.js autre.js   (teste un autre fichier)
 *
 * Aucune dépendance : Node.js suffit, Roll20 n'est pas nécessaire.
 * Deux niveaux de tests :
 *   - logique pure : conversions d'unités, distances PF1 en 2D et 3D, coût d'un
 *     vol (FAQ Paizo : pas de diagonale sur la verticale), dés de chute ;
 *   - flux complet : le script est chargé dans un FAUX Roll20 (page, tokens,
 *     fiches, textes, chat) et on lui envoie de vraies commandes « !alt ... ».
 *
 * Limite : ces tests n'ont jamais tourné dans une vraie campagne Roll20.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'scripts', 'altitude.js'));
const CODE = fs.readFileSync(SCRIPT, 'utf8');
const A = require(SCRIPT);

// ---------------------------------------------------------------- mini lanceur
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
describe('Lecture des distances (5 ft = 1,5 m = 1 case)', () => {
  const L = (t, u) => { const d = A.lireDistance(t, u); return d && d.valeur; };
  const table = [['30', 'ft', 6], ['30ft', 'm', 6], ['9m', 'ft', 6], ['9', 'm', 6], ['10,5', 'm', 7], ['6sq', 'm', 6],
    ['6 cases', 'ft', 6], ['0', 'ft', 0], ['+10', 'ft', 2], ['-3m', 'ft', -2], ['- 20', 'ft', -4], ['1m', 'ft', 1], ['4.5m', 'ft', 3]];
  table.forEach(([t, u, v]) => check(L(t, u) === v, `« ${t} » (page en ${u}) -> ${v} case(s)`));
  check(A.lireDistance('+10').relatif && !A.lireDistance('10').relatif, '« +10 » est relatif, « 10 » est absolu');
  ['', 'abc', '10x', '--3', 'm'].forEach((t) => check(A.lireDistance(t) === null, `« ${t} » -> refusé`));
});

describe('Distance PF1 en 2D (une diagonale sur deux compte double)', () => {
  const ref = { '1,1': 1, '2,2': 3, '3,3': 4, '4,4': 6, '5,0': 5, '1,5': 5, '2,5': 6, '0,0': 0 };
  Object.entries(ref).forEach(([k, v]) => {
    const [a, b] = k.split(',').map(Number);
    check(A.dist2(a, b) === v && A.dist2(b, a) === v && A.dist2(-a, b) === v, `(${a},${b}) -> ${v} cases`);
  });
});

describe('Distance 3D (règle maison : la hauteur est un axe de plus)', () => {
  check(A.dist3(0, 0, 4) === 4, 'droit au-dessus, 4 cases de haut : 4 cases');
  check(A.dist3(4, 0, 0) === 4, 'même altitude : distance 2D');
  check(A.dist3(1, 0, 1) === 1, 'une case en diagonale verticale : au contact');
  check(A.dist3(1, 1, 1) === 1, 'coin de cube : au contact');
  check(A.dist3(4, 0, 6) === 8, '20 ft à l\'horizontale, 30 ft de haut : 40 ft');
  check(A.dist3(2, 2, 2) === 4, '(2,2,2) : 3 cases à plat puis 4 avec la hauteur');
});

describe('Écart entre deux intervalles de cases', () => {
  check(A.ecart(0, 0, 1, 1) === 1, 'cases voisines : écart 1');
  check(A.ecart(0, 1, 1, 2) === 0, 'cases qui se chevauchent : 0');
  check(A.ecart(5, 6, 0, 1) === 4, 'dans l\'autre sens : 4');
});

describe('Coût d\'un vol (FAQ Paizo « Fly », juillet 2011)', () => {
  check(A.coutVol(3, 3) === 6, 'exemple de Sheo : 3 cases à 45° vers le haut = 6 cases');
  check(A.coutVol(6, 6) === 12, '30 ft en avant, 30 ft vers le haut : 60 ft');
  check(A.coutVol(8, 4) === 12, '40 ft en avant, 20 ft vers le haut : 60 ft');
  check(A.coutVol(0, 4) === 8, 'tout droit vers le haut, 20 ft : 40 ft');
  check(A.coutVol(2, 4) === 8, 'plus raide que 45° : la montée domine (2 × 4)');
  check(A.coutVol(6, -6) === 6, '30 ft en avant, 30 ft vers le bas : 30 ft');
  check(A.coutVol(2, -6) === 6, 'piqué : 30 ft vers le bas = 30 ft');
  check(A.coutVol(6, 0) === 6, 'à plat : distance horizontale');
  check(A.coutVol(-6, 0) === 6, 'distance horizontale négative : prise en valeur absolue');
});

describe('Distance horizontale maximale', () => {
  check(A.horizontalMax(4, 12) === 8, 'vol 60 ft, monter de 20 ft : jusqu\'à 40 ft à l\'horizontale');
  check(A.coutVol(A.horizontalMax(4, 12), 4) === 12, '... et ce vol coûte exactement 60 ft');
  check(A.horizontalMax(6, 12) === 6, 'monter de 30 ft avec 60 ft : 30 ft à l\'horizontale');
  check(A.horizontalMax(7, 12) === -1, 'monter de 35 ft avec 60 ft : impossible');
  check(A.horizontalMax(-6, 12) === 12, 'descendre de 30 ft : toute la vitesse à l\'horizontale');
  check(A.horizontalMax(-13, 12) === -1, 'descendre de 65 ft avec 60 ft : impossible en une action');
  check(A.horizontalMax(0, 12) === 12, 'à plat : toute la vitesse');
});

describe('Analyse d\'un vol : tests de Vol et mouvement restant', () => {
  const dd = (r) => r.tests.map((t) => t.dd).join(',');
  let r = A.analyseVol(6, 6, 12);
  check(r.cout === 12 && r.reste === 0 && dd(r) === '', '45° pile avec 60 ft : coût 60 ft, aucun test');
  r = A.analyseVol(2, 4, 12);
  check(dd(r) === '20', 'plus raide que 45° : DD 20');
  r = A.analyseVol(0, -8, 12);
  check(dd(r) === '', 'descente verticale de 40 ft : aucun test (descendre sous n\'importe quel angle)');
  r = A.analyseVol(0, -4, 12);
  check(dd(r) === '10', 'descente verticale de 20 ft seulement avec 60 ft : DD 10 (moins de la moitié)');
  r = A.analyseVol(2, 0, 12);
  check(dd(r) === '10', '10 ft avec 60 ft de vitesse : DD 10 (moins de la moitié)');
  r = A.analyseVol(6, 0, 12);
  check(dd(r) === '', 'exactement la moitié : pas de test');
  r = A.analyseVol(0, 0, 12);
  check(dd(r) === '15', 'sur place : DD 15');
  r = A.analyseVol(10, 4, 12);
  check(r.reste === -2 && r.resteDouble === 10, 'trop loin pour une action de mouvement, possible en double mouvement');
  r = A.analyseVol(2, 0, 0);
  check(r.reste === undefined && dd(r) === '', 'vitesse inconnue : pas de mouvement restant ni de DD 10');
});

describe('Dés de chute (1d6 par 10 ft, 20d6 max)', () => {
  check(A.desChute(1) === 0, '5 ft : aucun dé');
  check(A.desChute(2) === 1, '10 ft : 1d6');
  check(A.desChute(5) === 2, '25 ft : 2d6');
  check(A.desChute(12) === 6, '60 ft : 6d6');
  check(A.desChute(80) === 20, '400 ft : 20d6 (plafond)');
});

describe('Affichage dans l\'unité de la page', () => {
  check(A.enUnite(6, 'm') === '9 m', '6 cases -> 9 m');
  check(A.enUnite(7, 'm') === '10,5 m', '7 cases -> 10,5 m');
  check(A.enUnite(6, 'ft') === '30 ft', '6 cases -> 30 ft');
});

// ------------------------------------------------------------ faux Roll20
function creerRoll20({ unite = 'm', gm = ['GM'] } = {}) {
  const h = {};
  const objs = [];
  let n = 0;
  const chat = [];
  const fire = (ev, ...a) => (h[ev] || []).forEach((f) => f(...a));
  const attrs = {}; // perso -> { nom: valeur }
  const mk = (t, p) => {
    const o = { id: '-ID' + String(++n).padStart(12, '0'), type: t, props: { _type: t, ...p } };
    if (t === 'text' && p.pageid) o.props._pageid = p.pageid;
    o.get = (k) => o.props[k];
    o.set = (kv) => {
      const prev = { ...o.props };
      Object.assign(o.props, kv);
      if (t === 'graphic') fire('change:graphic', o, prev);
    };
    o.remove = () => {
      const i = objs.indexOf(o);
      if (i < 0) return;
      objs.splice(i, 1);
      if (t === 'graphic') fire('destroy:graphic', o);
    };
    objs.push(o);
    return o;
  };
  const page = mk('page', { scale_units: unite, snapping_increment: 1 });
  const sb = {
    state: {}, log() {}, console,
    on: (e, f) => { (h[e] = h[e] || []).push(f); },
    playerIsGM: (pid) => gm.includes(pid),
    sendChat: (w, t) => chat.push(t),
    getObj: (t, i) => objs.find((o) => o.type === t && o.id === i),
    findObjs: (q) => objs.filter((o) => Object.entries(q).every(([k, v]) => o.props[k] === v)),
    createObj: (t, p) => mk(t, p),
    getAttrByName: (cid, nom) => (attrs[cid] && attrs[cid][nom] !== undefined ? attrs[cid][nom] : ''),
    Campaign: () => ({ get: (k) => (k === 'playerpageid' ? page.id : undefined) })
  };
  vm.createContext(sb);
  vm.runInContext(CODE, sb);
  fire('ready');
  const perso = (nom, a, controlledby = '') => { const c = mk('character', { name: nom, controlledby }); attrs[c.id] = a; return c; };
  const token = (nom, x, y, o = {}) => mk('graphic', Object.assign({ name: nom, _pageid: page.id, left: x * 70 + 35, top: y * 70 + 35,
    width: 70, height: 70, layer: 'objects', controlledby: '' }, o));
  const cmd = (content, who = 'GM', selected = []) => fire('chat:message', {
    type: 'api', content, who, playerid: who, selected: selected.map((t) => ({ _id: t.id, _type: 'graphic' }))
  });
  const dernier = () => chat[chat.length - 1] || '';
  const textes = () => objs.filter((o) => o.type === 'text');
  return { fire, mk, objs, sb, chat, page, perso, token, cmd, dernier, textes };
}

// =============================================================== FLUX COMPLET
describe('Altitude : !alt set, étiquette sous le token', () => {
  const R = creerRoll20();
  const t = R.token('Lune', 5, 5);
  R.cmd('!alt set 9', 'GM', [t]);
  check(R.sb.state.Altitude.alt[t.id] === 6, '« 9 » sur une page en mètres -> 6 cases');
  check(R.textes().length === 1 && R.textes()[0].get('text') === '↑ 9 m', 'étiquette « ↑ 9 m » créée');
  const lab = R.textes()[0];
  check(lab.get('left') === t.get('left') && lab.get('top') > t.get('top') + 35, 'étiquette sous le token');
  R.cmd('!alt set +3', 'GM', [t]);
  check(R.sb.state.Altitude.alt[t.id] === 8 && lab.get('text') === '↑ 12 m', '« +3 » : 12 m, même étiquette mise à jour');
  check(R.textes().length === 1, 'toujours une seule étiquette');
  t.set({ left: 700, top: 140 });
  check(lab.get('left') === 700 && lab.get('top') > 140 + 35, 'l\'étiquette suit le token quand il bouge');
  t.set({ layer: 'gmlayer' });
  check(lab.get('layer') === 'gmlayer', 'l\'étiquette suit le token sur le calque MJ');
  R.cmd('!alt set -30m', 'GM', [t]);
  check(!R.sb.state.Altitude.alt[t.id] && R.textes().length === 0, 'altitude négative -> au sol, étiquette supprimée');
  R.cmd(`!alt set ${t.id} 20ft`, 'GM');
  check(R.sb.state.Altitude.alt[t.id] === 4, 'token donné par son id, « 20ft » -> 4 cases');
  t.remove();
  check(R.textes().length === 0 && !R.sb.state.Altitude.alt[t.id], 'token supprimé : étiquette et altitude effacées');
});

describe('Altitude : plusieurs tokens, page en pieds', () => {
  const R = creerRoll20({ unite: 'ft' });
  const a = R.token('A', 1, 1), b = R.token('B', 2, 2);
  R.cmd('!alt set 30', 'GM', [a, b]);
  check(R.sb.state.Altitude.alt[a.id] === 6 && R.sb.state.Altitude.alt[b.id] === 6, 'les deux tokens sélectionnés à 30 ft');
  check(R.textes().every((x) => x.get('text') === '↑ 30 ft'), 'étiquettes en pieds');
  R.cmd('!alt set abc', 'GM', [a]);
  check(/Usage/.test(R.dernier()), 'valeur illisible : rappel de l\'usage');
});

describe('Droits des joueurs', () => {
  const R = creerRoll20();
  const c = R.perso('Lune', {}, 'p1');
  const sien = R.token('Lune', 1, 1, { represents: c.id });
  const autre = R.token('Dragon', 4, 4);
  const direct = R.token('Familier', 2, 2, { controlledby: 'p2' });
  R.cmd('!alt set 6', 'p1', [sien, autre]);
  check(R.sb.state.Altitude.alt[sien.id] === 4, 'un joueur règle l\'altitude de son personnage');
  check(!R.sb.state.Altitude.alt[autre.id], '... mais pas celle d\'un token qu\'il ne contrôle pas');
  R.cmd('!alt set 6', 'p2', [direct]);
  check(R.sb.state.Altitude.alt[direct.id] === 4, 'contrôle donné directement sur le token');
  R.cmd('!alt set 6', 'p1', [autre]);
  check(/contrôles/.test(R.dernier()), 'aucun token permis : message clair');
  R.cmd('!alt clear all', 'p1');
  check(/MJ/.test(R.dernier()) && R.sb.state.Altitude.alt[sien.id] === 4, '!alt clear all réservé au MJ');
  R.cmd('!alt clear all', 'GM');
  check(Object.keys(R.sb.state.Altitude.alt).length === 0 && R.textes().length === 0, 'le MJ remet tout à 0');
});

describe('Coût d\'un vol : !alt fly', () => {
  const R = creerRoll20();
  const c = R.perso('Solathia', { 'speed-fly': '18', use_metrics: '1', 'speed-fly-maneuverability': 'bonne' }, 'p1');
  const t = R.token('Solathia', 3, 3, { represents: c.id });
  R.cmd('!alt fly 4,5 4,5', 'p1', [t]);
  let m = R.dernier();
  check(/coût <b>9 m<\/b>/.test(m), 'exemple de Sheo : 3 cases en avant, 3 vers le haut -> 9 m (6 cases)');
  check(/Vitesse de vol 18 m/.test(m) && /reste 9 m/.test(m), 'vitesse lue sur la fiche en mètres (18 m) : reste 9 m');
  check(/\(bonne\)/.test(m), 'manœuvrabilité affichée');
  check(/distance horizontale max : jusqu'à 13,5 m/.test(m), 'monter de 4,5 m avec 18 m : jusqu\'à 13,5 m à l\'horizontale');
  check(/!alt set -ID\d+ 3sq/.test(m), 'bouton Appliquer : altitude 3 cases');
  check(!/Test de Vol/.test(m), '45° : aucun test de Vol');
  R.cmd('!alt fly 0 6', 'p1', [t]);
  m = R.dernier();
  check(/DD 20/.test(m) && /coût <b>12 m<\/b>/.test(m), 'tout droit vers le haut de 6 m (4 cases) : 8 cases = 12 m, DD 20');
});

describe('Coût d\'un vol : vitesse donnée, pieds, descente', () => {
  const R = creerRoll20({ unite: 'ft' });
  const t = R.token('Paz', 1, 1);
  R.cmd('!alt fly 40 20 speed=60', 'GM', [t]);
  let m = R.dernier();
  check(/coût <b>60 ft<\/b>/.test(m) && /reste 0 ft/.test(m), '40 ft en avant, 20 ft vers le haut, vol 60 ft : coût 60 ft, reste 0');
  R.cmd('!alt fly 30 -30 speed=60', 'GM', [t]);
  m = R.dernier();
  check(/descendre de 30 ft : coût <b>30 ft<\/b>/.test(m), 'descente à 45° : coût 30 ft');
  check(/jusqu'à 60 ft/.test(m), 'en descendant, toute la vitesse reste disponible à l\'horizontale');
  check(!/Appliquer/.test(m) || /0sq/.test(m), 'au sol, descendre ne propose pas d\'altitude négative');
  R.cmd('!alt fly 10 0 speed=60', 'GM', [t]);
  check(/DD 10/.test(R.dernier()), '10 ft avec 60 ft : DD 10');
  R.cmd('!alt fly 30 0', 'GM', [t]);
  check(/vitesse de vol inconnue/.test(R.dernier()), 'pas de fiche ni de speed= : vitesse inconnue signalée');
  R.cmd('!alt fly 80 40 speed=60', 'GM', [t]);
  check(/possible en double mouvement \(reste 0 ft\)/.test(R.dernier()) && /max : impossible \(double mouvement : 80 ft\)/.test(R.dernier()),
    'monter de 40 ft avec 60 ft : impossible en une action, 80 ft à l\'horizontale en double mouvement');
  R.cmd('!alt fly 200 0 speed=60', 'GM', [t]);
  check(/trop loin pour un tour/.test(R.dernier()), '200 ft avec 60 ft : trop loin pour un tour');
  R.cmd('!alt fly 30 20 speed=60', 'GM');
  check(/coût <b>50 ft<\/b>/.test(R.dernier()) && !/Appliquer/.test(R.dernier()), 'sans token : calcul seul, pas de bouton Appliquer');
  R.cmd('!alt fly xyz', 'GM');
  check(/Usage/.test(R.dernier()), 'saisie illisible : rappel de l\'usage');
});

describe('Distance 3D : !alt dist', () => {
  const R = creerRoll20({ unite: 'ft' });
  const a = R.token('Lune', 0, 0), b = R.token('Dragon', 4, 0);
  R.cmd(`!alt set ${b.id} 30`, 'GM');
  R.cmd(`!alt dist ${a.id} ${b.id}`, 'GM');
  let m = R.dernier();
  check(/Horizontal 20 ft, hauteur 30 ft : distance <b>40 ft<\/b>/.test(m), '4 cases en avant, 6 en hauteur : 40 ft');
  check(/Hors d'allonge/.test(m), 'hors d\'allonge');
  check(/au contact en volant : 50 ft/.test(m), 'pour venir au contact : 3 cases en avant, 5 vers le haut (plus raide que 45°) = 2 × 25 = 50 ft');
  R.cmd(`!alt set ${a.id} 25`, 'GM');
  R.cmd(`!alt dist ${a.id} ${b.id}`, 'GM');
  check(/hauteur 5 ft/.test(R.dernier()), 'altitudes 25 et 30 ft : 1 case d\'écart en hauteur');
  const grand = R.token('Géant', 1, 0, { width: 140, height: 140, left: 140, top: 70 });
  R.cmd(`!alt set ${a.id} 0`, 'GM');
  R.cmd(`!alt dist ${a.id} ${grand.id}`, 'GM');
  check(/distance <b>5 ft<\/b>/.test(R.dernier()) && /Au contact/.test(R.dernier()), 'créature Grande voisine : au contact');
  R.cmd(`!alt set ${a.id} 10`, 'GM');
  R.cmd(`!alt dist ${a.id} ${grand.id}`, 'GM');
  check(/hauteur 5 ft/.test(R.dernier()) && /Au contact/.test(R.dernier()), 'à 10 ft d\'altitude, au-dessus d\'une créature Grande (haute de 10 ft) : 1 case d\'écart en hauteur, au contact en diagonale');
  // sort Vol suivi seulement au BuffTracker : vitesse de vol à 0 sur la fiche
  const c = R.perso('Lune', { 'speed-fly': '0' }, 'p1');
  const sansVol = R.token('Lune', 0, 3, { represents: c.id });
  R.cmd(`!alt set ${sansVol.id} 15`, 'p1');
  R.cmd(`!alt dist ${sansVol.id} ${b.id}`, 'p1');
  check(/Horizontal 25 ft, hauteur 15 ft : distance <b>30 ft/.test(R.dernier()) && !/undefined|NaN/.test(R.dernier()),
    'sans vitesse de vol sur la fiche (sort Vol) : la distance s\'affiche quand même');
  R.cmd('!alt fly 30 10', 'p1', [sansVol]);
  check(/coût <b>40 ft<\/b>/.test(R.dernier()) && /vitesse de vol inconnue/.test(R.dernier()) && !/undefined|NaN/.test(R.dernier()),
    'sans vitesse de vol : le coût s\'affiche, sans mouvement restant');
  R.cmd(`!alt dist ${a.id}`, 'GM');
  check(/Usage/.test(R.dernier()), 'un seul token : rappel de l\'usage');
});

describe('Chute : !alt fall', () => {
  const R = creerRoll20({ unite: 'ft' });
  const t = R.token('Selea', 1, 1);
  R.cmd('!alt set 60', 'GM', [t]);
  R.cmd('!alt fall', 'GM', [t]);
  const m = R.dernier();
  check(/tombe de 60 ft : \[\[6d6\]\]/.test(m), '60 ft : jet de 6d6');
  check(/DD 10/.test(m), 'rappel : test de Vol DD 10 pour annuler');
  check(!R.sb.state.Altitude.alt[t.id] && R.textes().length === 0, 'altitude remise à 0, étiquette retirée');
  R.cmd('!alt fall', 'GM', [t]);
  check(/déjà au sol/.test(R.dernier()), 'déjà au sol : rien à lancer');
  R.cmd('!alt set 5', 'GM', [t]);
  R.cmd('!alt fall', 'GM', [t]);
  check(/aucun dégât/.test(R.dernier()), '5 ft : aucun dégât');
  R.cmd('!alt set 2000', 'GM', [t]);
  R.cmd('!alt fall', 'GM', [t]);
  check(/\[\[20d6\]\]/.test(R.dernier()), '2000 ft : 20d6');
});

describe('Liste et menu', () => {
  const R = creerRoll20();
  const a = R.token('Lune', 1, 1), cache = R.token('Assassin', 2, 2, { layer: 'gmlayer' });
  R.cmd('!alt set 6', 'GM', [a, cache]);
  R.cmd('!alt show', 'p1');
  check(/Lune : 6 m/.test(R.dernier()) && !/Assassin/.test(R.dernier()), 'un joueur ne voit pas les tokens du calque MJ');
  R.cmd('!alt show', 'GM');
  check(/Assassin/.test(R.dernier()), 'le MJ les voit');
  R.cmd('!alt', 'p1');
  const m = R.dernier();
  check(/\[Coût d'un vol\]\(!alt fly &#63;\{/.test(m), 'menu : bouton Coût d\'un vol avec requête encodée');
  check(!/\?\{|@\{|\(outil/.test(m.replace(/^[^\]]*\]/, '')), 'menu : ni ?{ ni @{ ni parenthèse en clair dans les commandes');
  check(/&#64;\{target&#124;Cible&#124;token_id\}/.test(m), 'menu : cible encodée pour la distance 3D');
  const macro = fs.readFileSync(path.join(__dirname, '..', 'macro', 'Vol.macro.txt'), 'utf8').trim();
  R.cmd(macro, 'p1');
  check(R.dernier() === m, 'la macro Vol affiche le menu');
});

describe('Redémarrage du script : ménage des tokens disparus', () => {
  const R = creerRoll20();
  const t = R.token('Lune', 1, 1);
  R.cmd('!alt set 6', 'GM', [t]);
  R.sb.state.Altitude.alt['-FANTOME000000'] = 3;
  R.fire('ready');
  check(!R.sb.state.Altitude.alt['-FANTOME000000'] && R.sb.state.Altitude.alt[t.id] === 4, 'altitude d\'un token disparu oubliée, les autres gardées');
  check(R.textes().length === 1, 'pas d\'étiquette en double au redémarrage');
});

// ------------------------------------------------------------------- bilan
console.log(`\n${total - echecs.length}/${total} OK`);
if (echecs.length) { console.log('\nÉCHECS :\n' + echecs.join('\n')); process.exit(1); }
