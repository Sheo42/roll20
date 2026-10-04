/*
 * gabarit.test.js — tests de gabarit.js (script API Roll20)
 *
 * Lancer :  node gabarit.test.js            (teste ../scripts/gabarit.js)
 *           node gabarit.test.js autre.js   (teste un autre fichier)
 *
 * Aucune dépendance : Node.js suffit, Roll20 n'est pas nécessaire.
 * Deux niveaux de tests :
 *   - logique pure : les fonctions de calcul exportées par le script (cases d'un
 *     cercle / cône / ligne / émanation, contours, conversion des tailles) ;
 *   - flux complet : le script est chargé dans un FAUX Roll20 (pages, tokens,
 *     tracés, chat) et on lui envoie de vraies commandes « !gabarit ... ».
 *
 * Le faux Roll20 peut se comporter de deux façons quand le script modifie un token
 * depuis un gestionnaire d'évènement (option `nested`) : relancer l'évènement, ou
 * non. Roll20 ne relance pas toujours l'évènement : les tests de rotation du
 * Viseur sont donc exécutés dans les deux modes.
 *
 * Limite : ces tests n'ont jamais tourné dans une vraie campagne Roll20.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'scripts', 'gabarit.js'));
const CODE = fs.readFileSync(SCRIPT, 'utf8');
const g = require(SCRIPT);

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
const eq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const A = g.angleDeRotation;

// forme d'un ensemble de cases, ligne par ligne ("..#/###"), dans son rectangle englobant
const motif = (set) => {
  const pts = [...set].map((s) => s.split(',').map(Number));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const rows = [];
  for (let j = y0; j <= y1; j++) {
    let r = '';
    for (let i = x0; i <= x1; i++) r += set.has(i + ',' + j) ? '#' : '.';
    rows.push(r);
  }
  return rows.join('/');
};

// ------------------------------------------------------------ faux Roll20
function creerRoll20({ nested = true, playerIsGM = () => true } = {}) {
  const h = {};
  const objs = [];
  let n = 0;
  let depth = 0;
  const stats = { evts: 0 };            // nombre de set() sur des tokens
  const crees = { path: 0, graphic: 0 }; // objets créés
  const chat = [];
  const fire = (ev, ...a) => (h[ev] || []).forEach((f) => f(...a));
  const mk = (t, p) => {
    if (crees[t] !== undefined) crees[t]++;
    const o = { id: '-ID' + String(++n).padStart(12, '0'), type: t, props: { _type: t, ...p } };
    o.get = (k) => o.props[k];
    o.set = (kv) => {
      const prev = { ...o.props };
      Object.assign(o.props, kv);
      if (t !== 'graphic') return;
      stats.evts++;
      // nested = false : Roll20 ne relance pas l'évènement pour un set fait par le
      // script dans un gestionnaire
      if (depth > 0 && !nested) return;
      depth++;
      try { fire('change:graphic', o, prev); } finally { depth--; }
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
  const sb = {
    state: {}, log() {}, setTimeout, console,
    on: (e, f) => { (h[e] = h[e] || []).push(f); },
    playerIsGM,
    sendChat: (w, t) => chat.push(t),
    getObj: (t, i) => objs.find((o) => o.type === t && o.id === i),
    findObjs: (q) => objs.filter((o) => Object.entries(q).every(([k, v]) => o.props[k] === v)),
    createObj: (t, p) => mk(t, p),
    toBack() {}, toFront() {}
  };
  vm.createContext(sb);
  vm.runInContext(CODE, sb);
  return { fire, mk, objs, sb, stats, crees, chat };
}

const IMG_BIBLIO = 'https://s3.amazonaws.com/files.d20.io/images/5/Mag/med.png?1';

// =============================================================== LOGIQUE PURE
describe('Taille -> nombre de cases (5 ft = 1,5 m = 1 case)', () => {
  const table = {
    '20': 4, '20ft': 4, '20 ft': 4, '120': 24, '5': 1, '10': 2, '30': 6,
    '6m': 4, '6 m': 4, '36m': 24, '1.5m': 1, '3m': 2, '4.5m': 3, '4,5m': 3, '7.5m': 5, '1m': 1,
    '4c': 4, '4cases': 4, '24c': 24, '1c': 1, '1case': 1
  };
  Object.entries(table).forEach(([txt, n]) => check(g.tailleEnCases(txt) === n, `« ${txt} » -> ${n} case(s)`));
  ['0', '2', 'abc', '', 'c', '-3m', '4x'].forEach((txt) => check(g.tailleEnCases(txt) === null, `« ${txt} » -> refusé`));
  check(g.tailleEnCases('20') === g.tailleEnCases('6m') && g.tailleEnCases('6m') === g.tailleEnCases('4c'), '20 ft = 6 m = 4 cases : même zone quelle que soit l\'unité');
});

describe('Coût PF1e d\'une case (chaque seconde diagonale compte double)', () => {
  const ref = { '1,1': 1, '2,2': 3, '3,3': 4, '4,4': 6, '1,5': 5, '2,5': 6, '5,5': 7, '8,8': 12 };
  Object.entries(ref).forEach(([k, v]) => {
    const [a, b] = k.split(',').map(Number);
    check(g.cout(a, b) === v && g.cout(b, a) === v, `coût (${a},${b}) = ${v}, symétrique`);
  });
});

describe('Géométrie : cercle', () => {
  const ref = { 1: 4, 2: 12, 3: 24, 4: 44, 5: 68, 6: 96, 8: 172 };
  Object.entries(ref).forEach(([n, v]) => check(g.casesBurst(0, 0, +n).size === v, `cercle de ${n} cases (${n * 5} ft) : ${v} cases`));
  check(motif(g.casesBurst(0, 0, 4)) === '...##.../.######./.######./########/########/.######./.######./...##...', 'cercle de 4 cases : forme exacte (octogone arrondi)');
  const b = g.casesBurst(10, 10, 4);
  check([...b].every((s) => { const [i, j] = s.split(',').map(Number); return b.has((19 - i) + ',' + j) && b.has(i + ',' + (19 - j)); }), 'cercle symétrique autour de l\'intersection (haut/bas, gauche/droite)');
  const b0 = g.casesBurst(0, 0, 4);
  check(eq(new Set([...b0].map((s) => { const [i, j] = s.split(',').map(Number); return (i + 10) + ',' + (j + 10); })), b), 'le cercle se translate avec son origine');
  check([...g.casesBurst(0, 0, 3)].every((s) => g.casesBurst(0, 0, 4).has(s)), 'un cercle plus petit est inclus dans un plus grand');
});

describe('Géométrie : cônes droit et diagonal', () => {
  const droit = { 1: 2, 2: 4, 3: 8, 4: 14, 5: 20, 6: 28, 8: 48, 12: 104 };
  const diag = { 1: 1, 2: 3, 3: 6, 4: 11, 5: 17, 6: 24, 8: 43, 12: 96 };
  Object.entries(droit).forEach(([n, v]) => check(g.casesCone(0, 0, +n, 0).size === v, `cône droit de ${n} cases (${n * 5} ft) : ${v} cases`));
  Object.entries(diag).forEach(([n, v]) => check(g.casesCone(0, 0, +n, 1).size === v, `cône diagonal de ${n} cases (${n * 5} ft) : ${v} cases`));
  check(motif(g.casesCone(0, 0, 3, 0)) === '.#./###/###/.#.', 'cône droit de 3 cases : forme exacte');
  check(motif(g.casesCone(0, 0, 3, 1)) === '###/##./#..', 'cône diagonal de 3 cases : forme exacte');
  check([0, 2, 4, 6].every((d) => g.casesCone(0, 0, 6, d).size === 28), 'les 4 cônes droits ont la même surface (28)');
  check([1, 3, 5, 7].every((d) => g.casesCone(0, 0, 6, d).size === 24), 'les 4 cônes diagonaux ont la même surface (24)');
  const e = g.casesCone(0, 0, 6, 0);
  check([...e].every((s) => { const [i, j] = s.split(',').map(Number); return i >= 0 && e.has(i + ',' + (-1 - j)); }), 'cône droit : symétrique par rapport à son axe, rien derrière l\'origine');
  const d = g.casesCone(0, 0, 6, 1);
  check([...d].every((s) => { const [i, j] = s.split(',').map(Number); return i >= 0 && j >= 0 && d.has(j + ',' + i); }), 'cône diagonal : symétrique par rapport à sa diagonale, rien derrière l\'origine');
  check(g.casesCone(0, 0, 6, 0).size > g.casesCone(0, 0, 6, 1).size, 'à portée égale, un cône droit couvre plus de cases qu\'un cône diagonal');
});

describe('Géométrie : lignes', () => {
  const S = (pts) => new Set(pts.map((p) => p.join(',')));
  [3, 6, 12].forEach((n) => check(g.casesLigne([770, 769.5], 0, n, 70).size === n, `ligne droite de ${n} cases : ${n} cases`));
  const diag = { 3: 2, 6: 4, 12: 8 };
  Object.entries(diag).forEach(([n, v]) => check(g.casesLigne([770, 770], Math.PI / 4, +n, 70).size === v, `ligne en diagonale de ${n} cases (${n * 5} ft) : ${v} cases`));
  check(eq(g.casesLigne([770, 770], Math.PI / 4, 6, 70), S([[11, 11], [12, 12], [13, 13], [14, 14]])), 'ligne diagonale de 6 cases : les 4 cases de la diagonale');
  check(eq(g.casesLigne([770, 769.5], 0, 6, 70), S([[11, 10], [12, 10], [13, 10], [14, 10], [15, 10], [16, 10]])), 'ligne droite de 6 cases : la rangée entière');
});

describe('Géométrie : émanation', () => {
  const um = { 1: 8, 2: 20, 3: 36, 4: 60 };
  Object.entries(um).forEach(([n, v]) => check(g.casesEmanation(0, 0, 0, 0, +n).size === v, `émanation de ${n} cases autour d'un token 1x1 : ${v} cases`));
  const gd = { 1: 12, 2: 28, 3: 48 };
  Object.entries(gd).forEach(([n, v]) => check(g.casesEmanation(0, 1, 0, 1, +n).size === v, `émanation de ${n} cases autour d'un token 2x2 : ${v} cases`));
  check(motif(g.casesEmanation(0, 0, 0, 0, 2)) === '.###./#####/##.##/#####/.###.', 'émanation de 2 cases : forme exacte, case du lanceur exclue (trou au centre)');
  const e = g.casesEmanation(5, 6, 5, 6, 2);
  check(![...e].some((s) => { const [i, j] = s.split(',').map(Number); return i >= 5 && i <= 6 && j >= 5 && j <= 6; }), 'les 4 cases d\'un token 2x2 ne sont jamais dans son émanation');
});

describe('Contours des zones', () => {
  const aire = (l) => { let a = 0; for (let i = 0; i < l.length; i++) { const [x1, y1] = l[i], [x2, y2] = l[(i + 1) % l.length]; a += x1 * y2 - x2 * y1; } return a / 2; };
  const aireTotale = (s) => g.contour(s).reduce((t, l) => t + aire(l), 0);
  check(g.contour(new Set(['0,0'])).length === 1 && g.contour(new Set(['0,0']))[0].length === 4, 'une case : un seul contour de 4 points');
  check(g.contour(new Set(['0,0', '1,0', '0,1', '1,1']))[0].length === 4, 'un carré 2x2 : 4 points (points alignés supprimés)');
  check(g.contour(new Set(['0,0', '2,0'])).length === 2, 'deux cases séparées : deux contours');
  check(g.contour(new Set(['0,0', '0,1', '1,1']))[0].length === 6, 'forme en L : 6 points');
  const anneau = new Set(['0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2']);
  check(g.contour(anneau).length === 2, 'anneau (3x3 sans le centre) : deux contours (extérieur et trou)');
  check(aireTotale(anneau) === 8, 'anneau : l\'aire signée (extérieur - trou) vaut 8 cases');
  const formes = { 'cercle 4': g.casesBurst(0, 0, 4), 'cône droit 6': g.casesCone(0, 0, 6, 0), 'cône diagonal 6': g.casesCone(0, 0, 6, 3), 'émanation 3': g.casesEmanation(0, 0, 0, 0, 3) };
  Object.entries(formes).forEach(([nom, set]) => check(aireTotale(set) === set.size, `${nom} : l'aire du contour = nombre de cases (${set.size})`));
  check(g.contour(g.casesBurst(0, 0, 4)).length === 1 && g.contour(g.casesBurst(0, 0, 4))[0].length === 20, 'cercle de 4 cases : un contour de 20 points');
});

describe('Directions des cônes (angle et rotation du token)', () => {
  // ---- angle -> direction (cône droit / diagonal / auto)
  const deg=d=>d*Math.PI/180;
  const D=(d,m)=>g.dirCone(deg(d),m);
  check([0,10,40,-40,89].map(a=>D(a,'droit')).join()==='0,0,0,0,2','droit: 0°,10°,40°,-40° -> Est ; 89° -> Sud : '+[0,10,40,-40,89].map(a=>D(a,'droit')));
  check([90,135,180,-90,-120].map(a=>D(a,'droit')).join()==='2,4,4,6,6','droit: 90°->S 135°->O(frontière) 180°->O -90°->N -120°->N');
  check([5,45,85].every(a=>D(a,'diag')===1)&&[95,135,175].every(a=>D(a,'diag')===3)&&[-175,-135,-95].every(a=>D(a,'diag')===5)&&[-85,-45,-5].every(a=>D(a,'diag')===7),'diag: chaque quadrant -> sa diagonale (SE,SW,NW,NE)');
  check(D(0,'diag')===1&&D(90,'diag')===3&&D(180,'diag')===5,'diag: sur un axe -> pas de crash, diagonale du quadrant suivant');
  check([0,40,50,90,-130].map(a=>D(a,'auto')).join()==='0,1,1,2,5','auto: les 8 directions comme avant');
  check([0,1,2,3,4,5,6,7].every(k=>D(k*45,'droit')%2===0&&D(k*45+1,'diag')%2===1),'droit -> indice pair ; diag -> indice impair');

  // ---- rotation du token -> angle -> direction
  const A=g.angleDeRotation;
  check(Math.abs(A(0)+Math.PI/2)<1e-9&&Math.abs(A(90))<1e-9&&Math.abs(A(180)-Math.PI/2)<1e-9&&Math.abs(A(270)-Math.PI)<1e-9,'rotation 0/90/180/270 -> haut/droite/bas/gauche');
  const R=(r,m)=>g.dirCone(A(r),m);
  check([0,90,180,270].map(r=>R(r,'droit')).join()==='6,0,2,4','droit: 0°->N(6) 90°->E(0) 180°->S(2) 270°->O(4)');
  check([30,-10,359,50,140,310].map(r=>R(r,'droit')).join()==='6,6,6,0,2,4','droit: 30°,-10°,359°->N ; 50°->E ; 140°->S ; 310°->O');
  check([45,135,225,315].map(r=>R(r,'diag')).join()==='7,1,3,5','diag: 45°->NE(7) 135°->SE(1) 225°->SO(3) 315°->NO(5)');
  check([100,200,300,10].map(r=>R(r,'diag')).join()==='1,3,5,7','diag: 100°->SE 200°->SO 300°->NO 10°->NE');
});

// ================================================================ FLUX COMPLET
describe('Plusieurs gabarits, couleurs, effacer, unités (carte en mètres)', () => {
  const R = creerRoll20({ playerIsGM: (id) => id === 'GM' });
  const { fire, mk, objs, sb, chat } = R;
  const IMG='https://s3.amazonaws.com/files.d20.io/images/5/Mag/med.png?1';
  const pg=mk('page',{scale_number:1.5,scale_units:'m',snapping_increment:1});
  const tok=(nm,cx,cy,size=1)=>mk('graphic',{_subtype:'token',_pageid:pg.id,layer:'objects',name:nm,imgsrc:IMG,left:cx*70+35*size,top:cy*70+35*size,width:70*size,height:70*size,aura1_radius:'',aura1_color:'',aura1_square:false});
  const mage=tok('Mage',0,0), mage2=tok('Clerc',0,6);
  const g1=tok('Gob1',4,1), g2=tok('Gob2',14,1), gShared=tok('GobMilieu',9,2);
  g1.set({aura1_radius:'5',aura1_color:'#00ff00'}); // aura d'origine à restaurer
  const send=(c,pid='P1')=>fire('chat:message',{type:'api',content:c,who:'Alice',playerid:pid});
  const viseurs=()=>objs.filter(o=>o.type==='graphic'&&/^viseur/i.test(o.get('name')));
  const paths=()=>objs.filter(o=>o.type==='path');
  const auraC=t=>t.get('aura1_radius')==='0'?t.get('aura1_color'):'(origine:'+t.get('aura1_radius')+')';
  const whisper=()=>chat.splice(0);

  // 1) premier gabarit : cercle 6 m / 4 cases
  send(`!gabarit lancer ${mage.id} burst 4c`);
  let w=whisper();
  console.log('chat:',w);
  check(viseurs().length===1&&paths().length===1,'1 Viseur + 1 tracé');
  const v1=viseurs()[0];
  check(/Cercle 6 m \/ 4 cases/.test(v1.get('name')),'nom du Viseur = '+v1.get('name'));
  check(w.length===1&&/Effacer\]\(!gabarit clear g1\)/.test(w[0]),'bouton Effacer g1');
  const c1=sb.state.gabarit.liste.g1.couleur;

  // 2) deuxième gabarit : cône 9 m / 6 cases, même lanceur -> nouveau Viseur ailleurs
  send(`!gabarit lancer ${mage.id} cone 6c`);
  whisper();
  check(viseurs().length===2&&paths().length===2,'2 Viseurs + 2 tracés');
  const [va,vb]=viseurs();
  check(va.get('left')!==vb.get('left')||va.get('top')!==vb.get('top'),`Viseurs à des endroits différents (${va.get('left')},${va.get('top')}) / (${vb.get('left')},${vb.get('top')})`);
  check(Math.abs(va.get('left')-vb.get('left'))>=140||Math.abs(va.get('top')-vb.get('top'))>=140,'Viseurs sans chevauchement (2x2)');
  const c2=sb.state.gabarit.liste.g2.couleur;
  check(c1!==c2,`couleurs différentes ${c1} / ${c2}`);
  check(va.get('aura1_color')===c1&&vb.get('aura1_color')===c2,'aura du Viseur = couleur de son gabarit');

  // 3) troisième gabarit d'un autre joueur
  send(`!gabarit lancer ${mage2.id} ligne 12c`,'P2');
  whisper();
  check(viseurs().length===3&&paths().length===3,'3 gabarits simultanés');

  // 4) le Viseur 1 suit son gabarit sans toucher aux autres
  const ancienPath1=sb.state.gabarit.liste.g1.pathId;
  const autresPaths=['g2','g3'].map(g=>sb.state.gabarit.liste[g].pathId);
  v1.set({left:v1.get('left')+7*70}); // centre du cercle plus à droite
  check(sb.state.gabarit.liste.g1.pathId!==ancienPath1,'tracé g1 redessiné');
  check(['g2','g3'].every((g,i)=>sb.state.gabarit.liste[g].pathId===autresPaths[i]),'tracés g2/g3 inchangés');
  check(paths().length===3,'toujours 3 tracés');

  // 5) auras : GobMilieu touché par plusieurs zones ? on regarde le dernier gabarit qui le touche
  const touchePar=gid=>{const r=sb.state.gabarit.liste[gid];return new Set(r.cases)};
  const rc=(t)=>{const i=Math.round((t.get('left')-35)/70),j=Math.round((t.get('top')-35)/70);return i+','+j};
  const qui=Object.keys(sb.state.gabarit.liste).filter(g=>touchePar(g).has(rc(gShared)));
  console.log('GobMilieu touché par',qui,'| aura',auraC(gShared));
  check(qui.length===0||auraC(gShared)===sb.state.gabarit.liste[qui[qui.length-1]].couleur,'aura = couleur du dernier gabarit touchant');

  // 6) effacer UN gabarit (pas le dernier posé) : les autres restent, aura recalculée
  const avant=Object.keys(sb.state.gabarit.liste);
  send('!gabarit clear g1');
  check(!sb.state.gabarit.liste.g1&&sb.state.gabarit.liste.g2&&sb.state.gabarit.liste.g3,'g1 effacé, g2 et g3 intacts');
  check(viseurs().length===2&&paths().length===2,'1 Viseur et 1 tracé en moins');
  check(!viseurs().some(v=>v.id===v1.id),'Viseur de g1 supprimé');

  // 7) joueur 2 ne peut pas effacer le gabarit de joueur 1 ; MJ peut
  send('!gabarit clear g2','P2');
  check(!!sb.state.gabarit.liste.g2,'P2 ne peut pas effacer g2 (à P1)');
  send('!gabarit clear g2','GM');
  check(!sb.state.gabarit.liste.g2,'le MJ peut effacer g2');

  // 8) supprimer le Viseur à la main efface le gabarit
  const v3=viseurs()[0];
  v3.remove();
  check(Object.keys(sb.state.gabarit.liste).length===0&&paths().length===0,'supprimer le Viseur efface le gabarit');

  // 9) auras d'origine restaurées quand plus aucun gabarit
  check(auraC(g1)==='(origine:5)'&&g1.get('aura1_color')==='#00ff00','aura d\'origine de Gob1 restaurée');
  check(Object.keys(sb.state.gabarit.auraOrig).length===0,'plus aucune aura mémorisée');

  // 10) clear sans argument = tous les gabarits du joueur ; tout = MJ
  send(`!gabarit lancer ${mage.id} burst 2c`);send(`!gabarit lancer ${mage.id} cone 2c`);send(`!gabarit lancer ${mage2.id} burst 2c`,'P2');whisper();
  check(paths().length===3,'3 gabarits recréés');
  send('!gabarit clear');
  check(Object.keys(sb.state.gabarit.liste).length===1&&sb.state.gabarit.liste[Object.keys(sb.state.gabarit.liste)[0]].playerid==='P2','clear = tous MES gabarits (P2 conserve le sien)');
  send('!gabarit clear tout','GM');
  check(paths().length===0&&viseurs().length===0,'clear tout (MJ) vide tout');

  // 11) émanation : sans Viseur ; couleur explicite ; durée
  send(`!gabarit lancer ${mage.id} emanation 2c couleur=froid`);
  check(viseurs().length===0&&paths().length===1,'émanation sans Viseur');
  check(sb.state.gabarit.liste[Object.keys(sb.state.gabarit.liste)[0]].couleur==='#33aaff','couleur=froid respectée');
  send('!gabarit clear');

  // 12) unités et ancienne syntaxe
  send(`!gabarit lancer ${mage.id} burst 6m`);send(`!gabarit lancer ${mage.id} burst 20`);send(`!gabarit burst 4c ${mage.id}`);whisper();
  const Ns=Object.values(sb.state.gabarit.liste).map(r=>r.N);
  check(Ns.length===3&&Ns.every(x=>x===4),'6m = 20 ft = 4c = 4 cases (carte en mètres), '+Ns);
  send('!gabarit clear tout','GM');

  // 13) erreurs
  send(`!gabarit lancer ${mage.id} burst`);check(/Effet incomplet/.test(whisper()[0]),'taille manquante -> message');
  send(`!gabarit lancer burst 4c`);check(/Sélectionne ton token/.test(whisper()[0]),'sans lanceur -> message');
});

describe('Auras : zones superposées sur une même créature', () => {
  const R = creerRoll20();
  const { fire, mk, objs } = R;
  const pg = mk('page', { snapping_increment: 1 });
  const tok = (nm, cx, cy) => mk('graphic', { _subtype: 'token', _pageid: pg.id, layer: 'objects', name: nm, imgsrc: IMG_BIBLIO, left: cx * 70 + 35, top: cy * 70 + 35, width: 70, height: 70, aura1_radius: '', aura1_color: '', aura1_square: false });
  const mage = tok('Mage', 0, 0), cible = tok('Cible', 3, 3);
  const send = (c) => fire('chat:message', { type: 'api', content: c, who: 'A', playerid: 'P' });
  const aura = () => (cible.get('aura1_radius') === '0' ? cible.get('aura1_color') : 'aucune');
  const viseurs = () => objs.filter((o) => o.type === 'graphic' && /^viseur/i.test(o.get('name')));

  send(`!gabarit lancer ${mage.id} burst 4c couleur=feu`);
  check(aura() === '#ff4400', 'une zone de feu touche la Cible : aura rouge');
  send(`!gabarit lancer ${mage.id} burst 4c couleur=froid`);
  const [v1, v2] = viseurs();
  v2.set({ left: v1.get('left'), top: v1.get('top') }); // on superpose les deux zones
  check(aura() === '#33aaff', 'deux zones superposées : la couleur du dernier gabarit posé l\'emporte');
  send('!gabarit clear g2');
  check(aura() === '#ff4400', 'on efface la zone du dessus : la Cible reprend la couleur de l\'autre zone');
  send('!gabarit clear g1');
  check(aura() === 'aucune' && cible.get('aura1_radius') === '', 'plus aucune zone : l\'aura d\'origine de la Cible est restaurée');

  send(`!gabarit lancer ${mage.id} burst 2c couleur=acide`);
  const v = viseurs()[0];
  check(aura() === 'aucune', 'petit cercle (2 cases) : la Cible, à 2 cases en diagonale du centre, n\'est pas touchée');
  v.set({ left: 3 * 70, top: 3 * 70 });
  check(aura() === '#66cc00', 'on déplace le Viseur sur la Cible : elle prend l\'aura verte (acide)');
  v.set({ left: 20 * 70, top: 20 * 70 });
  check(aura() === 'aucune', 'on éloigne le Viseur : l\'aura disparaît');
});

describe('Cônes, lignes, cercles et émanations : départ au Viseur', () => {
  const R = creerRoll20();
  const { fire, mk, objs, sb } = R;
  const IMG='https://s3.amazonaws.com/files.d20.io/images/5/Mag/med.png?1';
  const pg=mk('page',{snapping_increment:1});
  const tok=(nm,cx,cy)=>mk('graphic',{_subtype:'token',_pageid:pg.id,layer:'objects',name:nm,imgsrc:IMG,left:cx*70+35,top:cy*70+35,width:70,height:70,rotation:0,aura1_radius:'',aura1_color:'',aura1_square:false});
  const mage=tok('Mage',10,10);
  const send=c=>fire('chat:message',{type:'api',content:c,who:'A',playerid:'P'});
  const viseur=()=>objs.filter(o=>o.type==='graphic'&&/^viseur/i.test(o.get('name'))).pop();
  const rec=()=>Object.values(sb.state.gabarit.liste).pop();
  const cases=()=>new Set(rec().cases);
  const lancer=(forme,t)=>{send('!gabarit clear');send(`!gabarit lancer ${mage.id} ${forme} ${t}`);return viseur()};
  const rot=(v,r)=>v.set({rotation:r});
  const S=pts=>new Set(pts.map(p=>p.join(',')));
  const rang=(i0,i1,j)=>{const o=[];for(let i=i0;i<=i1;i++)o.push([i,j]);return o};
  const col=(i,j0,j1)=>{const o=[];for(let j=j0;j<=j1;j++)o.push([i,j]);return o};
  const V=(v,x,y)=>v.set({left:x*70,top:y*70});

  // ===== cône droit : le cône part du Viseur =====
  let v=lancer('conedroit','3c');
  check(v.get('left')===840&&v.get('top')===840&&v.get('rotation')===90,'Viseur créé en intersection (12,12), flèche vers l\'Est');
  check(eq(cases(),g.casesCone(12,12,3,0))&&cases().size===8,'cône droit Est : part de l\'intersection du Viseur (12,12), 8 cases');
  check(!cases().has('10,10'),'ce cône ne touche pas la case du lanceur (il est à 2 cases du Viseur)');
  rot(v,0);   check(eq(cases(),g.casesCone(12,12,3,6)),'rotation 0° -> Nord depuis le Viseur');
  rot(v,180); check(eq(cases(),g.casesCone(12,12,3,2)),'rotation 180° -> Sud depuis le Viseur');
  rot(v,270); check(eq(cases(),g.casesCone(12,12,3,4)),'rotation 270° -> Ouest depuis le Viseur');
  rot(v,30);  check(v.get('rotation')===0&&eq(cases(),g.casesCone(12,12,3,6)),'rotation 30° -> aimantée sur 0° (Nord)');
  rot(v,50);  check(v.get('rotation')===90&&eq(cases(),g.casesCone(12,12,3,0)),'rotation 50° -> aimantée sur 90° (Est)');

  // le cône suit le Viseur
  V(v,13,8);  check(eq(cases(),g.casesCone(13,8,3,0)),'Viseur déplacé en (13,8) : le cône part de (13,8)');
  V(v,0,0);   check(eq(cases(),g.casesCone(0,0,3,0)),'Viseur loin (0,0) : le cône part de (0,0), n\'importe où sur la carte');
  v.set({left:13.3*70,top:8.6*70}); check(eq(cases(),g.casesCone(13,9,3,0)),'Viseur hors grille (13.3 ; 8.6) : calé sur l\'intersection la plus proche (13,9)');
  V(v,11,11); check(eq(cases(),g.casesCone(11,11,3,0))&&![...cases()].includes('10,10'),'Viseur sur le coin SE du lanceur (11,11) : règle du livre (cône qui part d\'un coin du lanceur)');
  V(v,11,10); check(eq(cases(),g.casesCone(11,10,3,0)),'Viseur sur le coin NE du lanceur (11,10) : cône Est qui part du coin NE');

  // simulation : le lanceur n'est pas touché par son propre cône, même s'il est dans la zone
  send('!gabarit clear');
  const cible=tok('Cible',9,10);
  v=lancer('conedroit','3c'); V(v,12,11); rot(v,270); // cône Ouest depuis (12,11) : couvre x=9..11
  check(cases().has('10,10')&&cases().has('9,10'),'(cône Ouest simulé) la case du lanceur (10,10) est dans la zone');
  check(cible.get('aura1_radius')==='0','la Cible (9,10) est touchée : aura');
  check(mage.get('aura1_radius')==='','le lanceur n\'est pas touché par son propre cône');
  send('!gabarit clear tout'); 
  check(cible.get('aura1_radius')==='','aura de la Cible restaurée à l\'effacement');
  cible.remove();

  // ===== cône diagonal =====
  v=lancer('conediag','3c');
  check(v.get('rotation')===135&&eq(cases(),g.casesCone(12,12,3,1))&&cases().size===6,'cône diagonal : rotation 135° (SE), 6 cases depuis le Viseur (12,12)');
  rot(v,45);  check(v.get('rotation')===45&&eq(cases(),g.casesCone(12,12,3,7)),'rotation 45° -> NE depuis le Viseur');
  rot(v,225); check(v.get('rotation')===225&&eq(cases(),g.casesCone(12,12,3,3)),'rotation 225° -> SO depuis le Viseur');
  rot(v,315); check(v.get('rotation')===315&&eq(cases(),g.casesCone(12,12,3,5)),'rotation 315° -> NO depuis le Viseur');
  rot(v,100); check(v.get('rotation')===135&&eq(cases(),g.casesCone(12,12,3,1)),'rotation 100° -> aimantée sur 135° (SE)');
  V(v,5,5);   check(eq(cases(),g.casesCone(5,5,3,1)),'cône diagonal déplacé : part du Viseur (5,5)');

  // ===== ligne : part du Viseur, côté du lanceur pour les axes exacts =====
  v=lancer('ligne','6c');   // Viseur (12,12), flèche Est
  check(eq(cases(),S(rang(12,17,11))),'ligne Est (axe exact) depuis (12,12) : 6 cases, rangée 11 (côté du lanceur)');
  rot(v,100); check(v.get('rotation')===100&&cases().size>0&&!eq(cases(),S(rang(12,17,11))),'ligne : 100° conservé (angle libre), légèrement inclinée');
  rot(v,135); check(eq(cases(),S([[12,12],[13,13],[14,14],[15,15]])),'ligne diagonale SE : 4 cases (30 ft en diagonale)');
  rot(v,270); check(eq(cases(),S(rang(6,11,11))),'ligne Ouest : 6 cases, rangée 11 (côté du lanceur)');
  rot(v,0);   check(eq(cases(),S(col(11,6,11))),'ligne Nord : 6 cases, colonne 11 (côté du lanceur)');
  rot(v,180); check(eq(cases(),S(col(11,12,17))),'ligne Sud : 6 cases, colonne 11 (côté du lanceur)');
  rot(v,90); V(v,13,8);  check(eq(cases(),S(rang(13,18,8))),'ligne Est depuis (13,8) (lanceur en dessous) : rangée 8, côté du lanceur');
  V(v,13,13); check(eq(cases(),S(rang(13,18,12))),'ligne Est depuis (13,13) (lanceur au-dessus) : rangée 12, côté du lanceur');
  V(v,11,11); check(eq(cases(),S(rang(11,16,10))),'ligne Est depuis le coin SE du lanceur : sa rangée (règle du livre)');

  // ===== cercle, émanation =====
  v=lancer('burst','4c');
  const av=[...cases()].sort().join();
  rot(v,77); check([...cases()].sort().join()===av&&v.get('rotation')===77,'cercle : tourner le Viseur ne change rien');
  V(v,3,3);  check([...cases()].sort().join()!==av,'cercle : déplacer le Viseur déplace le cercle');
  send('!gabarit clear'); send(`!gabarit lancer ${mage.id} emanation 2c`);
  check(viseur()===undefined&&rec().cases.length>0,'émanation : toujours sans Viseur');

  // ===== plusieurs gabarits =====
  send('!gabarit clear');
  send(`!gabarit lancer ${mage.id} conedroit 3c`);const vA=viseur();
  send(`!gabarit lancer ${mage.id} conediag 3c`);const vB=viseur();
  V(vA,5,5);rot(vA,0);V(vB,20,20);rot(vB,315);
  const [gA,gB]=Object.values(sb.state.gabarit.liste);
  check(eq(new Set(gA.cases),g.casesCone(5,5,3,6))&&eq(new Set(gB.cases),g.casesCone(20,20,3,5)),'deux cônes simultanés : chacun part de son propre Viseur, avec sa propre rotation');

  // ===== ancienne syntaxe : cible = token =====
  send('!gabarit clear tout');
  const t2=tok('Cible2',20,10);
  send(`!gabarit conedroit 3c ${mage.id} ${t2.id}`);
  check(!rec().viseurId&&(eq(cases(),g.casesCone(11,10,3,0))||eq(cases(),g.casesCone(11,11,3,0))),'cible = token : cône Est depuis un coin du lanceur (compatibilité), sans Viseur');
  send('!gabarit clear tout');
  const e0=R.stats.evts; v=lancer('conediag','3c'); rot(v,225); check(R.stats.evts-e0<=5,'pas de boucle d\'évènements ('+(R.stats.evts-e0)+')');
});

[true, false].forEach((nested) => {
  describe(`Aimantation de la rotation et redessin (Roll20 relance l'évènement : ${nested ? 'oui' : 'non'})`, () => {
    const NESTED = nested;
    const R = creerRoll20({ nested });
    const { fire, mk, objs, sb } = R;
    const IMG='https://s3.amazonaws.com/files.d20.io/images/5/Mag/med.png?1';
    const pg=mk('page',{snapping_increment:1});
    const tok=(nm,cx,cy)=>mk('graphic',{_subtype:'token',_pageid:pg.id,layer:'objects',name:nm,imgsrc:IMG,left:cx*70+35,top:cy*70+35,width:70,height:70,rotation:0,aura1_radius:'',aura1_color:'',aura1_square:false});
    const mage=tok('Mage',10,10);
    const send=c=>fire('chat:message',{type:'api',content:c,who:'A',playerid:'P'});
    const viseur=()=>objs.filter(o=>o.type==='graphic'&&/^viseur/i.test(o.get('name'))).pop();
    const rec=()=>Object.values(sb.state.gabarit.liste).pop();
    const cases=()=>new Set(rec().cases);
    const paths=()=>objs.filter(o=>o.type==='path').length;
    const lancer=(forme,t)=>{send('!gabarit clear tout');send(`!gabarit lancer ${mage.id} ${forme} ${t}`);return viseur()};
    // la rotation faite à la main par le joueur : hors gestionnaire
    const rot=(v,r)=>{v.set({rotation:r})};

    let v=lancer('conediag','3c');
    rot(v,180); check(v.get('rotation')===225&&eq(cases(),g.casesCone(12,12,3,3)),'cône DIAGONAL : 135° -> 180° (non diagonal) : flèche aimantée sur 225° ET gabarit redessiné vers le Sud-Ouest');
    rot(v,270); check(v.get('rotation')===315&&eq(cases(),g.casesCone(12,12,3,5)),'cône diagonal : 225° -> 270° : aimanté sur 315° ET gabarit vers le Nord-Ouest');
    rot(v,0);   check(v.get('rotation')===45&&eq(cases(),g.casesCone(12,12,3,7)),'cône diagonal : 315° -> 0° : aimanté sur 45° ET gabarit vers le Nord-Est');
    rot(v,90);  check(v.get('rotation')===135&&eq(cases(),g.casesCone(12,12,3,1)),'cône diagonal : 45° -> 90° : aimanté sur 135° ET gabarit vers le Sud-Est');
    check(paths()===1,'un seul tracé sur la carte (pas de doublon, pas de reste)');
    rot(v,225); check(v.get('rotation')===225&&eq(cases(),g.casesCone(12,12,3,3)),'cône diagonal : rotation déjà diagonale (225°) : gabarit redessiné');

    v=lancer('conedroit','3c');
    rot(v,135); check(v.get('rotation')===180&&eq(cases(),g.casesCone(12,12,3,2)),'cône DROIT : 90° -> 135° (diagonal) : aimanté sur 180° ET gabarit vers le Sud');
    rot(v,225); check(v.get('rotation')===270&&eq(cases(),g.casesCone(12,12,3,4)),'cône droit : 180° -> 225° : aimanté sur 270° ET gabarit vers l\'Ouest');
    check(paths()===1,'un seul tracé sur la carte');

    // auras suivent l'aimantation
    send('!gabarit clear tout');
    const gob=tok('Gobelin',9,13);   // dans un cône diagonal vers le Sud-Ouest depuis (12,12)
    v=lancer('conediag','4c');       // SE au départ
    const avant=gob.get('aura1_radius');
    rot(v,180);                      // -> SO
    check(avant===''&&gob.get('aura1_radius')==='0','aura : le Gobelin n\'est touché qu\'une fois le cône passé au Sud-Ouest');
    rot(v,90);
    check(gob.get('aura1_radius')==='','aura : retirée quand le cône repart vers le Sud-Est');

    // déplacement simple toujours OK
    v.set({left:5*70,top:5*70}); check(eq(cases(),g.casesCone(5,5,4,1)),'déplacement du Viseur : le gabarit suit');
  });

  describe(`Un seul tracé par rotation, pas de double dessin (évènement relancé : ${nested ? 'oui' : 'non'})`, () => {
    const R = creerRoll20({ nested });
    const { fire, mk, objs, crees } = R;
    const pg = mk('page', { snapping_increment: 1 });
    const mage = mk('graphic', { _subtype: 'token', _pageid: pg.id, layer: 'objects', name: 'Mage', imgsrc: IMG_BIBLIO, left: 735, top: 735, width: 70, height: 70, rotation: 0 });
    fire('chat:message', { type: 'api', content: `!gabarit lancer ${mage.id} conediag 3c`, who: 'A', playerid: 'P' });
    const v = objs.find((o) => /^viseur/i.test(o.get('name') || ''));
    crees.path = 0; v.set({ rotation: 180 });
    check(crees.path === 1, 'rotation vers une direction non valide (aimantée) : un seul tracé créé');
    crees.path = 0; v.set({ rotation: 315 });
    check(crees.path === 1, 'rotation déjà valide : un seul tracé créé');
    check(objs.filter((o) => o.type === 'path').length === 1, 'un seul tracé sur la carte, pas de reste');
  });
});

// ------------------------------------------------------------------ bilan
console.log(`\n${total - echecs.length}/${total} vérifications réussies`);
if (echecs.length) {
  console.log('\nÉCHECS :');
  echecs.forEach((e) => console.log('  - ' + e));
  process.exitCode = 1;
} else {
  console.log('TOUS LES TESTS PASSENT');
}
