/*
 * bufftracker.test.js — tests de bufftracker.js (script API Roll20)
 *
 * Lancer :  node tests/bufftracker.test.js            (teste scripts/bufftracker.js)
 *           node tests/bufftracker.test.js autre.js   (teste un autre fichier)
 *
 * Aucune dépendance : Node.js suffit, Roll20 n'est pas nécessaire.
 * Deux niveaux de tests :
 *   - logique pure : durées, lecture des commandes et des cibles, décompte, tracker
 *     d'initiative, marqueurs, relance, sorts courants, rendu du handout, du menu et
 *     des boutons à cocher ;
 *   - flux complet : le script est chargé dans un FAUX Roll20 (joueurs, personnages,
 *     tokens, handouts, tracker, chat) et reçoit de vraies commandes « !buff ... ».
 *
 * Limite : ces tests n'ont jamais tourné dans une vraie campagne Roll20. Non vérifié
 * ici : le rendu réel du HTML dans le chat et dans le handout, les requêtes ?{...}
 * des boutons, l'ouverture du handout par son lien, le rafraîchissement d'un handout
 * déjà ouvert chez un joueur.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'scripts', 'bufftracker.js'));
const CODE = fs.readFileSync(SCRIPT, 'utf8');
const B = require(SCRIPT);

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
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// =============================================================== LOGIQUE PURE
describe('Durées : lecture', () => {
  const table = {
    '3': [3, 0], '3r': [3, 0], '3 rd': [3, 0], '3 rounds': [3, 0], '10m': [100, 0], '10 min': [100, 0],
    '1h': [600, 0], '2 heures': [1200, 0], '1d': [14400, 0], '1 jour': [14400, 0], '1.5h': [900, 0], '1,5h': [900, 0],
    '-1': [1, -1], '+2': [2, 1], '-1r': [1, -1], '+10m': [100, 1], 'perm': [null, 0], 'PERMANENT': [null, 0], '-': [null, 0]
  };
  Object.entries(table).forEach(([txt, [r, s]]) => {
    const d = B.parseDuration(txt);
    check(d && d.rounds === r && d.sign === s, `« ${txt} » -> ${r} rounds, signe ${s}`);
  });
  ['', 'abc', '3x', '10 parsecs', '--1', true, null, undefined].forEach((txt) => check(B.parseDuration(txt) === null, `« ${txt} » -> refusé`));
});

describe('Durées : affichage', () => {
  const table = { 1: '1 rd', 9: '9 rd', 10: '1 min', 95: '9 min 5 rd', 100: '10 min', 600: '1 h', 630: '1 h 3 min', 1800: '3 h' };
  Object.entries(table).forEach(([r, txt]) => check(B.formatDuration(+r) === txt, `${r} rounds -> « ${txt} »`));
  check(B.formatDuration(null) === 'permanent', 'null -> « permanent »');
  [1, 4, 10, 37, 100, 125, 600, 1800, 14400, null].forEach((r) => {
    const back = B.parseDuration(B.compactDuration(r));
    check(back && back.rounds === r, `forme courte relisible : ${r} -> « ${B.compactDuration(r)} »`);
  });
});

describe('Lecture des commandes', () => {
  check(deepEq(B.parseCommand('!buff'), { sub: 'menu', args: [], opts: {}, confirm: null }), '!buff seul -> menu');
  check(B.parseCommand('!buffs') === null && B.parseCommand('!gabarit cast') === null, 'autres commandes ignorées');
  const c = B.parseCommand('!buff add --name Bénédiction --dur 5m --caster Solathia --effect +1 attaque, +1 JS');
  check(c.sub === 'add' && c.opts.name === 'Bénédiction' && c.opts.dur === '5m' && c.opts.caster === 'Solathia' &&
    c.opts.effect === '+1 attaque, +1 JS', 'options avec espaces et virgules');
  const e = B.parseCommand('!buff add --name X --dur 1m --caster  --effect  --hidden');
  check(e.opts.caster === '' && e.opts.effect === '' && e.opts.hidden === true, 'requêtes vides -> chaîne vide ; option seule -> true');
  const r = B.parseCommand('!buff remove 3 4 confirm 2');
  check(r.sub === 'remove' && deepEq(r.args, ['3', '4']) && r.confirm === 2, 'confirm N lu à la fin');
  check(B.parseCommand('!buff edit 3 --dur -1').opts.dur === '-1', '--dur -1 : le moins reste dans la valeur');
  check(B.parseCommand('!buff edit 3 --effect a -- b').opts.effect === 'a -- b', '« -- » suivi d\'un espace reste dans le texte');
  check(B.parseCommand('!BUFF Time 10m').sub === 'time', 'casse ignorée');
  check(B.parseCommand('!buff add --target Selea').opts.targets === 'Selea', '--target accepté comme --targets');
  const pk = B.parseCommand('!buff pick toggle char:-Mabc123');
  check(pk.sub === 'pick' && deepEq(pk.args, ['toggle', 'char:-Mabc123']), 'pick toggle avec un id Roll20 (commence par -)');
  const ck = B.parseCommand('!buff clear --keys char:-A1,token:-B2 confirm 3');
  check(ck.opts.keys === 'char:-A1,token:-B2' && ck.confirm === 3, 'clear --keys ... confirm N');
  check(B.texte(true) === '' && B.texte(' a ') === 'a' && B.texte(undefined) === undefined, 'option vide en fin de commande = texte vide');
  check(B.parseBool('no') === false && B.parseBool('yes') === true && B.parseBool(true) === true && B.parseBool('peut-être') === null, 'yes / no');
});

describe('Lecture des cibles (--targets)', () => {
  ['group', 'me', 'selected', 'pick'].forEach((m) => check(B.parseTargets(m).mode === m && B.parseTargets(m.toUpperCase()).mode === m, `« ${m} » -> mode ${m}`));
  check(B.parseTargets(undefined).mode === 'default' && B.parseTargets(true).mode === 'default' && B.parseTargets(' ').mode === 'default', 'absent ou vide -> par défaut');
  check(deepEq(B.parseTargets('Selea, Paz Tarpou ,Lune'), { mode: 'names', names: ['Selea', 'Paz Tarpou', 'Lune'] }), 'liste de noms séparés par des virgules');
  check(deepEq(B.parseTargets('Selea; Paz').names, ['Selea', 'Paz']), 'point-virgule accepté');
});

describe('Décompte', () => {
  const bs = [{ id: 'a', remaining: 3 }, { id: 'b', remaining: 2 }, { id: 'c', remaining: 1 }, { id: 'd', remaining: null }, { id: 'e', remaining: 5 }];
  const r = B.tick(bs, (b) => b.id !== 'e', 1);
  check(deepEq(bs.map((b) => b.remaining), [2, 1, 0, null, 5]), '-1 round sur les effets choisis, permanent et non choisi intacts');
  check(deepEq(r.expired.map((b) => b.id), ['c']) && deepEq(r.warned.map((b) => b.id), ['b']), 'expiré à 0, averti en passant à 1');
  const r2 = B.tick([{ remaining: 50 }, { remaining: 100 }, { remaining: 101 }], () => true, 100);
  check(r2.expired.length === 2 && r2.warned.length === 1, 'grand saut de temps : 2 expirés, 1 passe à 1');
});

describe('Tracker : avance, recul, nouveau round', () => {
  const o = [{ id: 'A', pr: 20 }, { id: 'B', pr: 15 }, { id: '-1', pr: 3, custom: 'Torche' }, { id: 'C', pr: 5 }];
  const fwd = o.slice(1).concat([o[0]]);
  check(B.detectAdvance(o, fwd) === 'forward', 'premier passé à la fin : avance');
  check(B.detectAdvance(fwd, o) === 'backward', 'dernier remis en tête : recul');
  check(B.detectAdvance(o, [o[1], o[0], o[2], o[3]]) === 'other', 'tri ou échange : autre');
  check(B.detectAdvance(o, o.slice(1)) === 'other', 'entrée retirée : autre');
  const fwdPr = fwd.map((e) => (e.custom ? { ...e, pr: 2 } : e));
  check(B.detectAdvance(o, fwdPr) === 'forward', 'une entrée personnalisée qui change de valeur ne gêne pas');
  check(B.detectAdvance([o[0]], [o[0]]) === 'other', 'une seule entrée : pas d\'avance');
  const tour = (l) => l.slice(1).concat([l[0]]);
  let cur = o, nouveaux = 0;
  for (let i = 0; i < 8; i++) { const nx = tour(cur); if (B.isNewRound(cur, nx)) nouveaux++; cur = nx; }
  check(nouveaux === 2, '8 tours sur 4 entrées : 2 nouveaux rounds');
  const ex = [{ id: 'A', pr: 10 }, { id: 'B', pr: 10 }, { id: 'C', pr: 5 }];
  check(!B.isNewRound(ex, tour(ex)), 'égalité d\'initiative : pas de nouveau round');
  const avecRound = [{ id: 'A', pr: 20 }, { id: '-1', pr: 2, custom: 'Round' }, { id: 'B', pr: 15 }];
  check(B.isNewRound(avecRound, tour(avecRound)) === true, 'entrée « Round » en tête : nouveau round');
  check(B.isNewRound(tour(avecRound), tour(tour(avecRound))) === false, 'avec une entrée « Round », l\'initiative ne compte plus');
  const torche = [{ id: 'A', pr: 20 }, { id: 'B', pr: 15 }, { id: 'C', pr: 5 }, { id: '-1', pr: 8, custom: 'Torche' }];
  check(B.isNewRound(null, torche) === true, 'torche (8) après C (5) ignorée : C puis A (20) = nouveau round');
  check(B.isNewRound(null, [{ id: '-1', pr: 30, custom: 'Torche' }, { id: 'A', pr: 20 }]) === false, 'entrée personnalisée en tête : pas un nouveau round');
  const oui = ['Round', 'round 3', 'Tour', 'Tour 2', 'Tours', '-- Début du round --', 'Début de tour', 'ROUND COUNTER', 'Nouveau tour !'];
  const non = ['Torche', 'Tourelle', 'Retour', 'Grounded', 'Poison', ''];
  oui.forEach((t) => check(B.isRoundEntry({ id: '-1', custom: t }), `« ${t} » : entrée de round`));
  non.forEach((t) => check(!B.isRoundEntry({ id: '-1', custom: t }), `« ${t} » : pas une entrée de round`));
  check(!B.isRoundEntry({ id: '-Mtok', custom: 'Round' }), 'un token nommé « Round » n\'est pas une entrée personnalisée');
});

describe('Marqueurs', () => {
  check(B.markerFor('Bénédiction') === B.markerFor('benediction') && B.PALETTE.includes(B.markerFor('Bénédiction')), 'couleur stable, accents et casse ignorés');
  check(B.markerTag({ name: 'X', marker: 'blue', remaining: 4 }) === 'blue@4', 'nombre affiché de 1 à 9');
  check(B.markerTag({ name: 'X', marker: 'blue', remaining: 10 }) === 'blue', 'pas de nombre au-delà de 9');
  check(B.markerTag({ name: 'X', marker: 'blue', remaining: null }) === 'blue', 'permanent : sans nombre');
  check(B.markerTag({ name: 'X', marker: 'none', remaining: 3 }) === null, '--marker none : rien');
  check(B.markerTag({ name: 'X', hidden: true, remaining: 3 }) === null, 'effet caché : rien sur la carte');
  check(B.mergeMarkers('red,blue@3,dead', ['blue'], ['blue@2', 'green']) === 'red,dead,blue@2,green', 'remplace les siens, garde les autres');
  check(B.pickColor('Bénédiction', new Set()) === B.markerFor('Bénédiction'), 'couleur du nom si libre');
  const pris = new Set([B.markerFor('Bénédiction')]);
  check(B.pickColor('Bénédiction', pris) !== B.markerFor('Bénédiction') && B.PALETTE.includes(B.pickColor('Bénédiction', pris)), 'sinon une autre couleur libre');
  check(B.pickColor('X', new Set(B.PALETTE)) === B.markerFor('X'), 'palette pleine : couleur du nom');
  check(B.markerTag({ name: 'X', color: 'purple', remaining: 2 }) === 'purple@2' && B.markerTag({ name: 'X', marker: 'blue', color: 'purple', remaining: 2 }) === 'blue@2', '--marker prioritaire sur la couleur choisie');
  check(B.mergeMarkers('red', [], []) === 'red' && B.mergeMarkers('', ['blue'], []) === '', 'rien à poser : inchangé ou vidé');
});

describe('Recherche par nom', () => {
  const c = [{ name: 'Solathia' }, { name: 'Selea' }, { name: 'Gobelin 1' }, { name: 'Gobelin 2' }, { name: 'Élan' }];
  check(B.resolveByName('solathia', c).length === 1, 'égalité, casse ignorée');
  check(B.resolveByName('sol', c)[0].name === 'Solathia', 'début du nom');
  check(B.resolveByName('elan', c)[0].name === 'Élan', 'accents ignorés');
  check(B.resolveByName('gobelin', c).length === 2, 'ambigu : plusieurs résultats');
  check(B.resolveByName('gobelin 2', c).length === 1, 'nom complet : un seul');
  check(B.resolveByName('', c).length === 0 && B.resolveByName('zzz', c).length === 0, 'vide ou inconnu : aucun');
});

describe('Relance : remplace l\'ancien lancement sur ses cibles', () => {
  const S = { kind: 'char', id: 'S' }, P = { kind: 'char', id: 'P' }, L = { kind: 'char', id: 'L' };
  const mk = () => [
    { id: '1', name: 'Bénédiction', targets: [S, P, L] },
    { id: '2', name: 'Bénédiction', hidden: true, targets: [P] },
    { id: '3', name: 'Rapidité', targets: [P] }
  ];
  let r = B.replaceTargets(mk(), 'bénédiction', false, [P]);
  check(deepEq(r.buffs.find((b) => b.id === '1').targets, [S, L]) && deepEq(r.relaunched, [P]), 'Paz quitte l\'ancien lancement, les autres le gardent');
  check(r.buffs.find((b) => b.id === '2').targets.length === 1 && r.buffs.find((b) => b.id === '3').targets.length === 1, 'effet caché et autre sort intacts');
  r = B.replaceTargets(mk(), 'Bénédiction', false, [S, P, L]);
  check(!r.buffs.some((b) => b.id === '1') && r.relaunched.length === 3, 'toutes les cibles relancées : l\'ancien lancement disparaît');
  r = B.replaceTargets(mk(), 'Bouclier', false, [S]);
  check(r.buffs.length === 3 && !r.relaunched.length, 'autre nom : rien ne change');
});

describe('Sorts courants', () => {
  const dur = (k, cl) => B.spellDuration(B.findFavorite(k), cl);
  check(dur('bless', 5) === 50, 'Bénédiction NLS 5 : 5 min = 50 rounds');
  check(dur('haste', 7) === 7, 'Rapidité NLS 7 : 7 rounds');
  check(dur('magearmor', 3) === 1800, 'Armure de mage NLS 3 : 3 h = 1800 rounds');
  check(dur('heroism', 5) === 500, 'Héroïsme NLS 5 : 50 min = 500 rounds');
  check(dur('divinefavor', 9) === 10, 'Faveur divine : 1 min fixe');
  check(B.findFavorite('Bénédiction').key === 'bless' && B.findFavorite('benediction').key === 'bless', 'trouvé par son nom français, accents ignorés');
  check(B.findFavorite("endurance de l'ours").key === 'bearsendurance', 'apostrophe ignorée');
  check(B.findFavorite('xyz') === null, 'inconnu : null');
  check(new Set(B.FAVORITES.map((f) => f.key)).size === B.FAVORITES.length, 'clés uniques');
  check(B.FAVORITES.every((f) => /^[a-z]+$/.test(f.key)), 'clés en anglais, sans espace ni accent');
});

describe('Vues, handout, menu et boutons à cocher', () => {
  const S = { kind: 'char', id: 'S' }, P = { kind: 'char', id: 'P' }, L = { kind: 'char', id: 'L' };
  const buffs = [
    { id: '1', name: 'Bénédiction', targets: [S, P, L], remaining: 4, effect: '+1 attaque' },
    { id: '2', name: 'Armure de mage', targets: [S], remaining: 600 },
    { id: '3', name: 'Rage', targets: [P], remaining: null },
    { id: '4', name: 'Malédiction', targets: [P], remaining: 2, hidden: true },
    { id: '5', name: 'Flou', targets: [S], remaining: 1 }
  ];
  const nom = (e) => ({ S: 'Selea', P: 'Paz <b>', L: 'Lune' }[e.id]);
  const v = B.buildView(buffs, nom, () => 'Solathia', false);
  check(deepEq(v.map((g) => g.target), ['Lune', 'Paz <b>', 'Selea']), 'fenêtre : un groupe par personnage, triés par nom');
  check(v.every((g) => g.rows.some((r) => r.name === 'Bénédiction')), 'un lancement sur 3 cibles apparaît chez chacune');
  check(deepEq(v[2].rows.map((r) => r.id), ['5', '1', '2']), 'effets triés par durée restante');
  check(!v[1].rows.some((r) => r.hidden), 'effet caché exclu de la vue joueurs');
  check(B.buildView(buffs, nom, () => '', true)[1].rows.length === 3, 'vue MJ : effet caché inclus');
  const h = B.renderHandout(v);
  check(h.includes('Paz &lt;b&gt;') && !h.includes('Paz <b>'), 'handout : HTML échappé');
  check(h.includes('4 rd') && h.includes('1 h') && h.includes('permanent') && h.includes('Solathia'), 'handout : durées et lanceur');
  check(h.includes('#c62828') && h.includes('#2e7d32') && !h.includes('#e65100'), 'handout : rouge au dernier round, vert à 4 rounds');
  check(B.renderHandout([]).includes('Aucun effet actif'), 'handout vide');

  const rows = B.buildCastView(buffs, nom, () => 'Solathia', (b) => b.id !== '2', false);
  check(deepEq(rows.map((r) => r.id), ['5', '1', '2', '3']), 'menu : un lancement par ligne, triés par durée, caché exclu');
  check(deepEq(rows[1].targets, ['Selea', 'Paz <b>', 'Lune']), 'menu : liste des cibles du lancement');
  const m = B.renderMenu(rows, { footer: '<a href="!buff fav">x</a>' });
  check(!/\n/.test(m), 'menu sur une seule ligne (sendChat)');
  check(m.includes('→ Selea, Paz &lt;b&gt;, Lune'), 'menu : cibles affichées et échappées');
  check(m.includes('href="!buff edit 1 --dur -1"') && m.includes('href="!buff edit 1 --targets pick"') && m.includes('href="!buff remove 1"'), 'menu : boutons -1, Cibles, X');
  check(!m.includes('!buff edit 2 '), 'menu : pas de bouton sur un lancement non modifiable');
  check(m.includes('?{Durée : 3r 10m 2h ou perm|4r}'), 'menu : durée actuelle proposée par défaut');
  const piege = B.renderMenu(B.buildCastView([{ id: '9', name: 'X', targets: [S], remaining: 3, effect: 'a|b}c, d[[1d6]]@{x}' }],
    nom, () => '', () => true, false));
  const req = piege.match(/--effect \?\{Effet\|([^}]*)\}/);
  check(req && !/[|{}[\],@]/.test(req[1]), 'défaut de la requête Effet sans caractère qui la casserait');
  check(!piege.includes('[[') && !piege.includes('@{'), 'texte affiché sans jet en ligne ni référence d\'attribut');

  const pk = B.renderPicker('Bénédiction · 5 min', [{ key: 'char:S', name: 'Selea', on: true }, { key: 'char:P', name: 'Paz', on: false }]);
  check(!/\n/.test(pk) && pk.includes('href="!buff pick toggle char:S"') && pk.includes('✔ Selea') && !pk.includes('✔ Paz'), 'boutons à cocher : état de chaque PJ');
  check(pk.includes('Valider (1)') && pk.includes('href="!buff pick ok"') && pk.includes('href="!buff pick all"') && pk.includes('href="!buff pick cancel"'), 'boutons Valider (nombre), Tout le groupe, Annuler');
  check(B.renderPicker('X', []).includes('Aucun PJ'), 'aucun PJ sur la carte');
});

// ================================================================= FAUX ROLL20
function creerRoll20() {
  const h = {};
  const objs = [];
  let n = 0;
  const chat = [];
  const fire = (ev, ...a) => (h[ev] || []).forEach((f) => f(...a));
  const mk = (t, p, id) => {
    const o = { id: id || ('-ID' + String(++n).padStart(12, '0')), type: t, props: { _type: t, ...p } };
    o.props._id = o.id;
    o.get = (k) => (k === 'id' || k === '_id' ? o.id : o.props[k]);
    o.set = (kv, v) => { if (typeof kv === 'string') o.props[kv] = v; else Object.assign(o.props, kv); };
    o.remove = () => {
      const i = objs.indexOf(o);
      if (i < 0) return;
      objs.splice(i, 1);
      if (t === 'graphic') fire('destroy:graphic', o);
    };
    objs.push(o);
    return o;
  };
  const campagne = mk('campaign', { turnorder: '', playerpageid: 'p1', playerspecificpages: false }, 'root');
  const sb = {
    state: {}, log() {}, setTimeout, console,
    on: (e, f) => { (h[e] = h[e] || []).push(f); },
    playerIsGM: (pid) => pid === 'gm',
    sendChat: (w, t) => chat.push(t),
    getObj: (t, i) => objs.find((o) => o.type === t && o.id === i),
    findObjs: (q) => objs.filter((o) => Object.entries(q).every(([k, v]) => o.props[k] === v)),
    createObj: (t, p) => mk(t, p),
    Campaign: () => campagne
  };
  vm.createContext(sb);
  const env = { fire, mk, objs, sb, chat, campagne };
  env.charger = () => vm.runInContext(CODE, sb);
  env.dire = (pid, content, selected = []) => {
    const avant = chat.length;
    fire('chat:message', { type: 'api', content, playerid: pid, who: pid, selected: selected.map((t) => ({ _id: t.id, _type: 'graphic' })) });
    return chat.slice(avant);
  };
  env.ordre = (liste) => {
    const prev = campagne.props.turnorder;
    campagne.props.turnorder = JSON.stringify(liste);
    const avant = chat.length;
    fire('change:campaign:turnorder', campagne, { turnorder: prev });
    return chat.slice(avant);
  };
  env.buffs = () => sb.state.BuffTracker.buffs;
  env.handout = () => objs.find((o) => o.type === 'handout' && o.props.name === 'Effets actifs');
  return env;
}

// une partie : 4 joueurs et leurs PJ liés (Solathia, Selea, Paz Tarpou, Lune) et
// 2 gobelins non liés, sur la carte p1 ; Lune a aussi un token sur une autre carte
function partie({ avantChargement } = {}) {
  const r = creerRoll20();
  ['A', 'B', 'C', 'D'].forEach((x, i) => r.mk('player', { _displayname: ['Alice', 'Bob', 'Chloé', 'Denis'][i] }, 'p' + x));
  const perso = (nom, ctl) => r.mk('character', { name: nom, controlledby: ctl });
  const c = { selea: perso('Selea', 'pA'), paz: perso('Paz Tarpou', 'pB'), sol: perso('Solathia', 'pC'), lune: perso('Lune', 'pD'), gob: perso('Gobelin', '') };
  const tok = (nom, ch, lie, page = 'p1') => r.mk('graphic', {
    _subtype: 'token', _pageid: page, name: nom, represents: ch ? ch.id : '', bar1_link: lie ? 'hp' : '', controlledby: '', statusmarkers: ''
  });
  const t = {
    selea: tok('Selea', c.selea, true), paz: tok('Paz', c.paz, true), sol: tok('Solathia', c.sol, true),
    lune: tok('Lune', c.lune, true), gob1: tok('Gobelin 1', c.gob, false), gob2: tok('Gobelin 2', c.gob, false)
  };
  t.selea.props.statusmarkers = 'red';
  if (avantChargement) avantChargement(r);
  r.charger();
  r.fire('ready');
  return { ...r, c, t, tok };
}
const entree = (t, pr) => ({ id: t.id, pr, custom: '', _pageid: 'p1' });
const marq = (t) => t.props.statusmarkers;
const noms = (b) => b.targets.map((x) => x.name).join(',');
const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const cliquer = (p, pid, html, label) => {
  const re = new RegExp(`href="([^"]*)">${label}</a>`);
  const m = html.match(re);
  if (!m) throw new Error(`bouton « ${label} » introuvable`);
  return p.dire(pid, m[1]);
};

// ============================================================== FLUX COMPLET
describe('Démarrage', () => {
  const p = partie();
  const h = p.handout();
  check(!!h && h.props.inplayerjournals === 'all', 'handout « Effets actifs » créé, visible par tous');
  check(h.props.notes.includes('Aucun effet actif'), 'handout vide au départ');
  p.fire('ready');
  check(p.objs.filter((o) => o.type === 'handout').length === 1, 'pas de second handout après un redémarrage');
});

describe('Ajout pour une liste de PJ', () => {
  const p = partie();
  // Chloé (Solathia) bénit le groupe : elle ne peut sélectionner que son propre token
  const out = p.dire('pC', '!buff add --name Bénédiction --dur 5m --caster Solathia --targets group --effect +1 attaque');
  check(p.buffs().length === 1, 'un seul lancement');
  const b = p.buffs()[0];
  check(noms(b) === 'Lune,Paz Tarpou,Selea,Solathia', 'Tout le groupe : les 4 PJ de la carte, pas les gobelins');
  check(b.targets.every((x) => x.kind === 'char'), 'tokens liés : les cibles sont les personnages');
  check(b.caster && b.caster.id === p.c.sol.id && b.remaining === 50 && b.owner === 'pC', 'lanceur, durée, créateur');
  check(out.length === 1 && out[0].startsWith('/w "Chloé" ') && out[0].includes('→ Lune, Paz Tarpou, Selea, Solathia'), 'confirmation avec la liste des cibles');
  check(out[0].includes(`href="http://journal.roll20.net/handout/${p.handout().id}"`), 'confirmation avec le lien vers la fenêtre');
  const coul = B.markerFor('Bénédiction');
  check(marq(p.t.selea) === `red,${coul}` && marq(p.t.paz) === coul && marq(p.t.lune) === coul && marq(p.t.gob1) === '', 'marqueur sur chaque cible, rien sur les gobelins');
  const notes = p.handout().props.notes;
  check(['Lune', 'Paz Tarpou', 'Selea', 'Solathia'].every((n) => notes.includes(`>${n}</h4>`)) && (notes.match(/Bénédiction/g) || []).length === 4, 'fenêtre : la Bénédiction chez chacun des 4 PJ');

  p.dire('pB', '!buff add --name Rapidité --dur 7r --caster Paz --targets Selea, lune');
  check(noms(p.buffs()[1]) === 'Selea,Lune', 'cibles par leur nom, casse ignorée');
  p.dire('pA', '!buff add --name Flou --dur 3m --caster Selea --targets me');
  check(noms(p.buffs()[2]) === 'Selea', 'Moi seul = le lanceur');
  p.dire('pD', '!buff add --name Vision --dur 1h --caster  --targets me');
  check(noms(p.buffs()[3]) === 'Lune', 'Moi seul sans lanceur = le personnage du joueur sur la carte');
  p.dire('gm', '!buff add --name Ralenti --dur 2r --targets selected', [p.t.gob1, p.t.gob2]);
  const ral = p.buffs()[4];
  check(ral.targets.length === 2 && ral.targets.every((x) => x.kind === 'token'), 'Tokens sélectionnés : gobelins non liés, un par token');
  p.dire('gm', `!buff add --name Dodo --dur perm --marker sleepy --targets ${p.t.gob1.id}`);
  check(p.buffs()[5].remaining === null && marq(p.t.gob1).split(',').includes('sleepy'), 'cible par id, perm et --marker');
  const autre = p.tok('Lune', p.c.lune, true, 'p2');
  p.dire('pD', '!buff edit 2 --dur 4r');
  const tagsLune = marq(autre).split(',');
  check(tagsLune.length === 3 && tagsLune.includes(`${p.buffs()[1].color}@4`), 'effets d\'un personnage affichés sur ses tokens des autres cartes');
  check(new Set(tagsLune.map((x) => x.split('@')[0])).size === 3, 'Bénédiction et Vision (même couleur par défaut) : couleurs différentes sur Lune');
});

describe('Ajout : erreurs', () => {
  const p = partie();
  check(p.dire('pA', '!buff add --name X --dur 1m --targets selected')[0].includes('propres tokens'), 'selected sans sélection : refusé, avec l\'explication');
  check(p.dire('pA', '!buff add --name X --dur 1m --targets Zorglub')[0].includes('introuvable'), 'nom inconnu : refusé');
  check(p.dire('pA', '!buff add --name X --dur 1m --targets gobelin')[0].includes('ambiguë'), 'nom ambigu : refusé');
  check(p.dire('pA', '!buff add --name X --dur 3 parsecs --targets group')[0].includes('illisible'), 'durée illisible : refusé');
  check(p.dire('pA', '!buff add --dur 1m --targets group')[0].includes('nom'), 'sans nom : refusé');
  check(p.dire('pA', '!buff add --name X --dur 1m --hidden --targets group')[0].includes('MJ'), 'effet caché par un joueur : refusé');
  check(p.dire('pA', '!buff add --name X --dur 0 --targets group')[0].includes('illisible'), 'durée nulle : refusé');
  check(p.dire('pA', '!buff add --spell xyz --cl 3 --targets group')[0].includes('inconnu'), 'sort courant inconnu : refusé');
  check(p.dire('pA', '!buff add --spell haste --targets group')[0].includes('niveau de lanceur'), 'sort courant sans --cl : refusé');
  check(p.dire('gm', '!buff add --name X --dur 1m --caster --targets me')[0].includes('Lanceur introuvable'), 'MJ, Moi seul sans lanceur : refusé');
  check(p.buffs().length === 0, 'rien n\'a été créé');
});

describe('Carte du MJ : la dernière qu\'il a ouverte', () => {
  const p = partie();
  p.mk('page', { name: 'Préparation' }, 'p2');
  const ogre = p.tok('Ogre', null, false, 'p2');
  // sans objet joueur pour le MJ : carte des joueurs
  check(p.dire('gm', '!buff add --name X --dur 1m --targets Ogre')[0].includes('introuvable'), 'MJ sans carte connue : cherche sur la carte des joueurs');
  const mj = p.mk('player', { _displayname: 'MJ', _lastpage: 'p2' }, 'gm');
  p.dire('gm', '!buff add --name Lenteur --dur 2r --targets Ogre');
  check(p.buffs().length === 1 && p.buffs()[0].targets[0].id === ogre.id, 'MJ : cible trouvée sur la carte qu\'il regarde');
  check(p.dire('gm', '!buff add --name Y --dur 1m --targets group')[0].includes('Aucun PJ'), 'MJ : Tout le groupe = les PJ de sa carte');
  mj.props._lastpage = 'disparue';
  p.dire('gm', '!buff add --name Z --dur 1m --targets Selea');
  check(p.buffs().some((b) => b.name === 'Z'), 'carte du MJ supprimée : carte des joueurs');
  p.dire('pA', '!buff add --name W --dur 1m --targets Selea');
  check(p.buffs().some((b) => b.name === 'W'), 'joueur : toujours sa propre carte');
});

describe('Sorts courants et bouton Ajouter', () => {
  const p = partie();
  p.dire('pC', '!buff add --spell bless --cl 4 --caster Solathia --targets group');
  const b = p.buffs()[0];
  check(b.name === 'Bénédiction' && b.remaining === 40 && b.effect.includes('+1 moral') && b.targets.length === 4, 'sort courant : nom, durée, effet calculés, groupe');
  const fav = p.dire('pC', '!buff fav')[0];
  check(fav.includes('?{Lanceur|Solathia}') && fav.includes('--targets ?{Cibles|Tout le groupe,group|Moi seul,me|Tokens sélectionnés,selected|Choisir...,pick}'), 'boutons des sorts : lanceur par défaut = le perso du joueur, choix des cibles');
  const menu = p.dire('pC', '!buff')[0];
  check(menu.includes('--caster ?{Lanceur|Solathia}') && menu.includes('--targets ?{Cibles|'), 'bouton Ajouter : lanceur par défaut et choix des cibles');
  check(p.dire('gm', '!buff')[0].includes('?{Lanceur|}'), 'MJ : pas de lanceur par défaut');
  // les libellés des listes déroulantes ne contiennent ni virgule ni barre
  const q = menu.match(/\?\{Cibles\|([^}]*)\}/)[1].split('|');
  check(q.every((o) => o.split(',').length === 2), 'liste Cibles : « libellé,valeur » sans virgule dans les libellés');
});

describe('Choisir... : boutons à cocher', () => {
  const p = partie();
  const m1 = p.dire('pC', '!buff add --name Bouclier de la foi --dur 5m --caster Solathia --targets pick')[0];
  check(p.buffs().length === 0, 'rien n\'est créé avant de valider');
  check(m1.includes('Bouclier de la foi · 5 min · par Solathia'), 'titre : nom, durée, lanceur');
  check(['Lune', 'Paz Tarpou', 'Selea', 'Solathia'].every((n) => m1.includes(`>${n}</a>`)) && !m1.includes('Gobelin'), 'un bouton par PJ de la carte, rien de coché');
  check(m1.includes('Valider (0)'), 'Valider (0)');
  const m2 = cliquer(p, 'pC', m1, 'Paz Tarpou')[0];
  check(m2.includes('✔ Paz Tarpou') && m2.includes('Valider (1)'), 'clic : Paz coché, nouveau message');
  const m3 = cliquer(p, 'pC', m2, 'Lune')[0];
  const m4 = cliquer(p, 'pC', m3, '✔ Paz Tarpou')[0];
  check(m4.includes('✔ Lune') && !m4.includes('✔ Paz') && m4.includes('Valider (1)'), 'second clic : décoché');
  const fin = cliquer(p, 'pC', m4, 'Valider \\(1\\)');
  check(p.buffs().length === 1 && noms(p.buffs()[0]) === 'Lune', 'Valider : lancement créé avec les cochés');
  check(fin[0].includes('→ Lune'), 'confirmation');
  check(p.dire('pC', '!buff pick ok')[0].includes('Aucun choix'), 'le choix est terminé après validation');
  // Tout le groupe, Aucun, Annuler ; Valider sans cible refusé
  const a1 = p.dire('pA', '!buff add --name Héroïsme --dur 10m --targets pick')[0];
  const a2 = cliquer(p, 'pA', a1, 'Tout le groupe')[0];
  check(a2.includes('Valider (4)'), 'Tout le groupe : 4 cochés');
  const a3 = cliquer(p, 'pA', a2, 'Aucun')[0];
  check(a3.includes('Valider (0)'), 'Aucun : 0');
  check(cliquer(p, 'pA', a3, 'Valider \\(0\\)')[0].includes('Aucune cible'), 'Valider sans cible : refusé');
  cliquer(p, 'pA', a3, 'Annuler');
  check(p.buffs().length === 1 && !p.sb.state.BuffTracker.drafts.pA, 'Annuler : rien créé, choix oublié');
  // sans --targets ni sélection : les boutons à cocher ; avec sélection : la sélection, sans question
  check(p.dire('pA', '!buff add --name Y --dur 1m')[0].includes('pick toggle'), 'sans --targets ni sélection : boutons à cocher');
  p.dire('pA', '!buff pick cancel');
  p.dire('pA', '!buff add --name Z --dur 1m', [p.t.selea]);
  check(noms(p.buffs()[1]) === 'Selea', 'sans --targets, avec sélection : la sélection');
  // la sélection est pré-cochée dans Choisir..., même un monstre
  const g1 = p.dire('gm', '!buff add --name Peur --dur 2r --targets pick', [p.t.gob1])[0];
  check(g1.includes('✔ Gobelin 1') && g1.includes('>Selea</a>'), 'Choisir... avec sélection : sélection pré-cochée et ajoutée à la liste');
  check(p.dire('pB', '!buff pick toggle char:nimporte')[0].includes('Aucun choix'), 'chaque joueur a son propre choix en cours');
  check(p.dire('gm', '!buff pick toggle char:nimporte')[0].includes('inconnue'), 'clé inconnue : refusé');
});

describe('Relance', () => {
  const p = partie();
  p.dire('pC', '!buff add --name Bénédiction --dur 2r --caster Solathia --targets group');
  p.dire('pC', '!buff add --name bénédiction --dur 5m --caster Solathia --targets Selea, Paz');
  check(p.buffs().length === 2, 'deux lancements');
  check(noms(p.buffs()[0]) === 'Lune,Solathia' && p.buffs()[0].remaining === 2, 'l\'ancien garde les cibles non relancées');
  check(noms(p.buffs()[1]) === 'Selea,Paz Tarpou' && p.buffs()[1].remaining === 50, 'le nouveau a ses cibles et sa durée');
  check(p.buffs()[1].name === 'Bénédiction', 'graphie du sort déjà en jeu conservée (bénédiction -> Bénédiction)');
  check(p.handout().props.notes.match(/Bénédiction/g).length === 4, 'fenêtre : toujours une Bénédiction par PJ, pas de doublon');
  const out = p.dire('pC', '!buff add --name Bénédiction --dur 5m --caster Solathia --targets group');
  check(p.buffs().length === 1 && p.buffs()[0].targets.length === 4, 'relance sur tout le groupe : un seul lancement reste');
  check(out[0].includes('relancé pour'), 'confirmation : relancé');
  check(p.buffs()[0].color === B.markerFor('Bénédiction'), 'un relancement garde la couleur du sort');
});

describe('Droits', () => {
  const p = partie();
  p.dire('pC', '!buff add --name Bénédiction --dur 5m --caster Solathia --targets Selea, Paz');   // 1
  p.dire('pB', '!buff add --name Rage --dur perm --caster Paz --targets me');                      // 2
  check(p.dire('pD', '!buff edit 1 --dur 2r')[0].includes('ne peux pas'), 'Denis (Lune, ni lanceur ni cible) ne modifie pas la Bénédiction');
  p.dire('pA', '!buff edit 1 --dur 7r');
  check(p.buffs()[0].remaining === 7, 'Alice (Selea est une cible) modifie le lancement');
  p.dire('pC', '!buff edit 1 --dur 6r');
  check(p.buffs()[0].remaining === 6, 'Chloé (lanceur) modifie le lancement');
  p.dire('pA', '!buff edit 2 --dur 1r');
  check(p.buffs()[1].remaining === null, 'Alice ne touche pas à la Rage de Paz');
  p.dire('gm', '!buff add --name Malédiction --dur 3r --hidden --targets Paz');                     // 3
  check(p.dire('pB', '!buff edit 3 --dur 1')[0].includes('introuvable'), 'effet caché : invisible pour le joueur, même sur son personnage');
  const menuB = p.dire('pB', '!buff', [p.t.paz])[0];
  check(menuB.includes('Rage') && menuB.includes('Bénédiction') && !menuB.includes('Malédiction'), 'menu (sélection) : effets du perso, sans l\'effet caché');
  const menuMJ = p.dire('gm', '!buff')[0];
  check(menuMJ.startsWith('/w gm ') && menuMJ.includes('Malédiction') && menuMJ.includes('(caché)'), 'menu du MJ avec l\'effet caché');
  check(!p.handout().props.notes.includes('Malédiction') && p.handout().props.gmnotes.includes('Malédiction'), 'handout : effet caché seulement dans la partie MJ');
  check(marq(p.t.paz).split(',').length === 2, 'Paz porte 2 marqueurs (Bénédiction, Rage), pas celui de la Malédiction');
  const menuD = p.dire('pD', '!buff')[0];
  check(menuD.includes('Aucun effet en cours') && menuD.includes('Ajouter'), 'menu de Denis : rien à gérer, mais le bouton Ajouter');
  p.dire('gm', '!buff edit 3 --hidden no');
  check(p.handout().props.notes.includes('Malédiction'), 'MJ : effet rendu visible');
  check(p.dire('pA', '!buff edit 1 --hidden yes')[0].includes('MJ'), 'joueur : ne peut pas cacher');
});

describe('Menu et lien vers la fenêtre', () => {
  const p = partie();
  p.dire('pC', '!buff add --name Bénédiction --dur 5m --caster Solathia --targets group --effect +1 attaque');
  const m = p.dire('pC', '!buff')[0];
  const url = `http://journal.roll20.net/handout/${p.handout().id}`;
  check(m.startsWith('/w "Chloé" ') && m.includes('Effets que tu gères'), 'menu chuchoté au joueur');
  check(m.includes('→ Lune, Paz Tarpou, Selea, Solathia') && m.includes('par Solathia') && m.includes('+1 attaque'), 'lancement : cibles, lanceur, effet');
  check(m.includes(`href="${url}">Ouvrir la fenêtre</a>`), 'bouton « Ouvrir la fenêtre » = lien direct vers le handout');
  check(hrefs(m).every((h) => !/\n/.test(h)), 'liens sans retour à la ligne');
  const sh = p.dire('pA', '!buff show')[0];
  check(sh.startsWith('/w "Alice" ') && sh.includes(`href="${url}"`), '!buff show : lien');
});

describe('Modification', () => {
  const p = partie();
  p.dire('pA', '!buff add --name Flou --dur 5r --caster Selea --targets me --effect camouflage');
  p.dire('pA', '!buff edit 1 --dur -1');
  check(p.buffs()[0].remaining === 4, '-1');
  p.dire('pA', '!buff edit #1 --dur +3');
  check(p.buffs()[0].remaining === 7, '+3, numéro avec #');
  p.dire('pA', '!buff edit 1 --dur 2m --name Flou amélioré --effect 50 %');
  const b = p.buffs()[0];
  check(b.remaining === 20 && b.name === 'Flou amélioré' && b.effect === '50 %', 'durée absolue, nom et effet');
  p.dire('pA', '!buff edit 1 --effect');
  check(b.effect === '', 'requête Effet laissée vide : effet effacé');
  p.dire('pA', '!buff edit 1 --dur perm');
  check(b.remaining === null, 'devenu permanent');
  check(p.dire('pA', '!buff edit 1 --dur -1')[0].includes('permanent'), 'permanent : -1 refusé');
  p.dire('pA', '!buff edit 1 --targets Selea, Lune');
  check(noms(b) === 'Selea,Lune', '--targets : cibles remplacées');
  p.dire('pA', '!buff edit 1 --dur 2r');
  const out = p.dire('pA', '!buff edit 1 --dur -5');
  check(p.buffs().length === 0, 'tombé à 0 : retiré');
  check(out.some((m) => !m.startsWith('/w') && m.includes('Fin') && m.includes('<b>Flou amélioré</b> (Selea, Lune)')), 'fin annoncée à tous, avec les cibles');
  check(out.some((m) => !m.startsWith('/w') && m.includes('Voir les effets')), 'annonce avec le lien vers la fenêtre');
  check(marq(p.t.selea) === 'red' && marq(p.t.lune) === '', 'marqueurs retirés, les autres gardés');
  check(p.dire('pA', '!buff edit 99 --dur 1')[0].includes('introuvable'), 'numéro inconnu');
  p.dire('pA', '!buff add --name X --dur 3r --targets me');
  check(p.dire('pA', '!buff edit 2')[0].includes('Rien à modifier'), 'aucune option');
  p.dire('pA', '!buff edit 2 --caster Solathia');
  check(p.buffs()[0].caster.id === p.c.sol.id, 'lanceur ajouté après coup');
  p.dire('pA', '!buff edit 2 --marker none');
  check(marq(p.t.selea) === 'red', '--marker none : marqueur retiré');
});

describe('Bouton Cibles : modifier la liste', () => {
  const p = partie();
  p.dire('pC', '!buff add --name Bénédiction --dur 5m --caster Solathia --targets group');
  const menu = p.dire('pC', '!buff')[0];
  const c1 = cliquer(p, 'pC', menu, 'Cibles')[0];
  check(c1.includes('Cibles de Bénédiction (#1)') && c1.includes('Valider (4)') && c1.includes('✔ Paz Tarpou'), 'cibles actuelles pré-cochées');
  const c2 = cliquer(p, 'pC', c1, '✔ Paz Tarpou')[0];
  cliquer(p, 'pC', c2, 'Valider \\(3\\)');
  check(p.buffs().length === 1 && noms(p.buffs()[0]) === 'Lune,Selea,Solathia' && p.buffs()[0].remaining === 50, 'Paz retiré du lancement, durée intacte');
  check(marq(p.t.paz) === '' && !p.handout().props.notes.includes('>Paz Tarpou</h4>'), 'marqueur et fenêtre de Paz nettoyés');
  check(p.dire('pD', '!buff edit 1 --targets pick')[0].includes('pick toggle'), 'le joueur d\'une cible peut ouvrir le choix');
  check(p.dire('pB', '!buff edit 1 --targets pick')[0].includes('ne peux pas'), 'Paz, retiré, ne gère plus ce lancement');
});

describe('Suppression avec essai à blanc', () => {
  const p = partie();
  p.dire('pA', '!buff add --name A --dur 5r --targets me');
  p.dire('pA', '!buff add --name B --dur 5r --targets me');
  p.dire('pB', '!buff add --name C --dur 5r --targets me');
  const essai = p.dire('pA', '!buff remove 1 2')[0];
  check(p.buffs().length === 3 && essai.includes('Retirerait 2') && essai.includes('href="!buff remove 1 2 confirm 2"'), 'essai à blanc avec bouton Confirmer');
  check(p.dire('pA', '!buff remove 1 2 confirm 3')[0].includes('ne correspond pas') && p.buffs().length === 3, 'mauvais nombre : rien retiré');
  check(p.dire('pA', '!buff remove 3')[0].includes('ne peux pas'), 'effet d\'un autre joueur : refusé');
  p.dire('pA', '!buff remove 1 2 confirm 2');
  check(p.buffs().length === 1 && p.buffs()[0].name === 'C', 'confirmé : retirés');
  check(marq(p.t.selea) === 'red', 'marqueurs retirés');
  check(p.dire('pB', '!buff remove')[0].includes('numéro'), 'remove sans numéro');
});

describe('clear : retirer un personnage de ses effets', () => {
  const p = partie();
  p.dire('pC', '!buff add --name Bénédiction --dur 5m --caster Solathia --targets group');   // 1
  p.dire('pB', '!buff add --name Rage --dur perm --targets me');                              // 2 (Paz)
  p.dire('pA', '!buff add --name Flou --dur 3m --targets me');                                // 3 (Selea)
  const essai = p.dire('pB', '!buff clear', [p.t.paz])[0];
  check(essai.includes('Retirerait 2') && essai.includes(`href="!buff clear --keys char:${p.c.paz.id} confirm 2"`), 'essai à blanc : 2 effets sur Paz, clés dans le bouton');
  const conf = essai.match(/href="([^"]*)">Confirmer/)[1];
  p.dire('pB', conf); // le bouton fonctionne même si la sélection a changé
  check(p.buffs().length === 2 && noms(p.buffs()[0]) === 'Lune,Selea,Solathia', 'Paz quitte la Bénédiction, les autres la gardent ; Rage retirée');
  check(p.buffs()[1].name === 'Flou', 'les effets des autres ne bougent pas');
  check(p.dire('pB', '!buff clear all')[0].includes('MJ'), 'clear all par un joueur : refusé');
  const all = p.dire('gm', '!buff clear all')[0];
  check(all.includes('href="!buff clear all confirm 2"') && p.buffs().length === 2, 'clear all : essai à blanc');
  p.dire('gm', '!buff clear all confirm 2');
  check(p.buffs().length === 0 && p.handout().props.notes.includes('Aucun effet actif'), 'clear all confirmé');
});

describe('Passage du temps (MJ)', () => {
  const p = partie();
  p.dire('pA', '!buff add --name Bénédiction --dur 5m --targets me');
  p.dire('pA', '!buff add --name Armure de mage --dur 3h --targets me');
  p.dire('pA', '!buff add --name Rage --dur perm --targets me');
  check(p.dire('pA', '!buff time 10m')[0].includes('MJ'), 'joueur : refusé');
  const essai = p.dire('gm', '!buff time 10m')[0];
  check(essai.includes('2 effets raccourcis') && essai.includes('Bénédiction') && essai.includes('href="!buff time 10m confirm 2"'), 'essai à blanc : effets concernés et fins');
  check(p.buffs()[0].remaining === 50, 'essai à blanc : rien ne change');
  const out = p.dire('gm', '!buff time 10m confirm 2');
  check(p.buffs().length === 2 && p.buffs()[0].name === 'Armure de mage' && p.buffs()[0].remaining === 1700, 'confirmé : Bénédiction finie, Armure raccourcie, Rage intacte');
  check(out.some((m) => m.includes('Fin') && m.includes('Bénédiction')), 'fin annoncée');
  check(!out.some((m) => m.includes('Dernier round')), 'pas d\'avertissement de dernier round lors d\'un saut de temps');
  check(p.dire('gm', '!buff time abc')[0].includes('Durée'), 'durée illisible');
});

describe('Tracker d\'initiative : tour du lanceur, sinon début du round', () => {
  const p = partie();
  const { selea, paz, sol, gob1 } = p.t;
  p.dire('pC', '!buff add --name Bénédiction --dur 3r --caster Solathia --targets group');   // 1 : lanceur dans le tracker
  p.dire('pB', '!buff add --name Potion --dur 2r --caster  --targets me');                    // 2 : sans lanceur
  p.dire('pA', '!buff add --name Armure de mage --dur 3h --caster Lune --targets me');        // 3 : Lune hors tracker
  p.dire('gm', '!buff add --name Peur --dur 2r --caster Gobelin 1 --hidden --targets Paz');   // 4 : caché, lanceur gobelin
  const rem = () => p.buffs().map((b) => b.name + ':' + b.remaining).join(' ');
  p.ordre([entree(sol, 20), entree(selea, 15), entree(gob1, 10), entree(paz, 5)]);
  check(rem() === 'Bénédiction:3 Potion:2 Armure de mage:1800 Peur:2', 'tracker rempli et trié : rien ne bouge');
  const tour = () => { const cur = JSON.parse(p.campagne.props.turnorder); return p.ordre(cur.slice(1).concat([cur[0]])); };
  tour(); // Selea
  check(rem() === 'Bénédiction:3 Potion:2 Armure de mage:1800 Peur:2', 'tour de Selea (cible) : rien, l\'effet suit son lanceur');
  const o2 = tour(); // Gobelin 1, lanceur de la Peur
  check(p.buffs()[3].remaining === 1, 'tour du Gobelin 1 : Peur -1');
  check(o2.length === 1 && o2[0].startsWith('/w gm ') && o2[0].includes('Dernier round') && o2[0].includes('<b>Peur</b> (Paz Tarpou)') && !o2[0].includes('Voir les effets'), 'dernier round d\'un effet caché : au MJ seulement');
  tour(); // Paz
  check(rem() === 'Bénédiction:3 Potion:2 Armure de mage:1800 Peur:1', 'tour de Paz : la Potion (sans lanceur) attend le round');
  tour(); // Solathia, nouveau round
  check(rem() === 'Bénédiction:2 Potion:1 Armure de mage:1799 Peur:1', 'nouveau round (Solathia) : Bénédiction -1 (lanceur), Potion et Armure -1 (début du round)');
  // recul puis ré-avance au même tour : pas de double décompte
  const cur = JSON.parse(p.campagne.props.turnorder);
  p.ordre([cur[cur.length - 1]].concat(cur.slice(0, -1)));
  p.ordre(cur);
  check(rem() === 'Bénédiction:2 Potion:1 Armure de mage:1799 Peur:1', 'recul puis ré-avance : pas de double décompte');
  tour(); const o6 = tour(); // Selea, Gobelin 1 : Peur finie
  check(!rem().includes('Peur') && o6.some((m) => m.startsWith('/w gm ') && m.includes('Fin') && m.includes('Peur')), 'Peur finie, annoncée au MJ seulement');
  tour(); // Paz
  const o8 = tour(); // Solathia, round 3
  check(rem() === 'Bénédiction:1 Armure de mage:1798', 'round 3 : Potion finie, Bénédiction au dernier round');
  check(o8.some((m) => !m.startsWith('/w') && m.includes('Dernier round') && m.includes('<b>Bénédiction</b> (Lune, Paz Tarpou, Selea, Solathia)') && m.includes('Voir les effets')), 'dernier round annoncé à tous, avec cibles et lien');
  check(o8.some((m) => !m.startsWith('/w') && m.includes('Fin') && m.includes('<b>Potion</b> (Paz Tarpou)')), 'fin de la Potion annoncée');
  check(marq(selea) === `red,${B.markerFor('Bénédiction')}@1`, 'marqueur à 1');
  tour(); tour(); tour();
  const o12 = tour(); // Solathia, round 4
  check(rem() === 'Armure de mage:1797' && o12.some((m) => m.includes('Fin') && m.includes('Bénédiction')), 'round 4 : Bénédiction finie juste avant le tour de Solathia (3 rounds complets)');
  check(marq(selea) === 'red' && !p.handout().props.notes.includes('Bénédiction'), 'marqueurs et fenêtre nettoyés');
  p.ordre([]);
  check(p.sb.state.BuffTracker.dernierTour === null && rem() === 'Armure de mage:1797', 'tracker vidé : fin du combat, rien ne bouge');
});

describe('Tracker : entrée de round, lanceur suivi par son nom', () => {
  const p = partie();
  p.dire('pA', '!buff add --name Mystère --dur 3r --caster Ombre --targets me'); // Ombre n'existe pas encore
  check(p.buffs()[0].caster.id === null && p.buffs()[0].caster.name === 'Ombre', 'lanceur introuvable : gardé par son nom');
  p.dire('pB', '!buff add --name Ambigu --dur 3r --caster gobelin --targets me');
  check(p.buffs()[1].caster.id === null, 'lanceur ambigu (2 gobelins) : pas de choix au hasard');
  const ombre = p.tok('Ombre', null, false);
  // tracker non trié (Selea avant Ombre malgré l'initiative) avec une entrée « -- Début du round -- »
  const o = [{ id: '-1', pr: 0, custom: '-- Début du round --' }, entree(p.t.selea, 5), entree(ombre, 12)];
  p.ordre(o);
  const rem = () => p.buffs().map((b) => b.name + ':' + b.remaining).join(' ');
  const tour = () => { const cur = JSON.parse(p.campagne.props.turnorder); return p.ordre(cur.slice(1).concat([cur[0]])); };
  tour(); // Selea
  tour(); // Ombre : l'initiative remonte, mais l'entrée de round a priorité
  check(rem() === 'Mystère:2 Ambigu:3', 'lanceur retrouvé par son nom dans le tracker ; pas de nouveau round sans l\'entrée de round');
  tour(); // entrée de round en tête
  check(rem() === 'Mystère:2 Ambigu:2', 'entrée « Début du round » en tête : effets hors tracker -1');
});

describe('Token supprimé, aide, commande inconnue, redémarrage', () => {
  const p = partie();
  p.dire('gm', '!buff add --name Ralenti --dur 3r --targets selected', [p.t.gob1, p.t.gob2]);
  p.dire('gm', '!buff add --name Toile --dur 3r --targets Gobelin 2');
  p.t.gob2.remove();
  check(p.buffs().length === 1 && noms(p.buffs()[0]) === 'Gobelin 1', 'token non lié supprimé : il quitte ses effets, ceux sans cible restante disparaissent');
  check(p.dire('pB', '!buff help')[0].includes('--targets'), 'aide');
  check(p.dire('pB', '!buff zut')[0].includes('inconnue'), 'commande inconnue');
  const ids = p.buffs().map((b) => b.id);
  p.fire('ready');
  p.dire('gm', '!buff add --name Neuf --dur 1r --targets Paz');
  check(!ids.includes(p.buffs()[1].id), 'numéros jamais réutilisés');
});

describe('État de la version 1 (une cible par effet)', () => {
  const p = partie({
    avantChargement: (r) => {
      const sel = r.objs.find((o) => o.type === 'character' && o.props.name === 'Selea');
      r.sb.state.BuffTracker = {
        version: 1, nextId: 3, markers: {},
        buffs: [
          { id: '1', name: 'Bénédiction', target: { kind: 'char', id: sel.id }, targetName: 'Selea', caster: null, remaining: 4, effect: '', marker: '', hidden: false, owner: 'pA' },
          { id: '2', name: 'Vide', remaining: 4 }
        ]
      };
    }
  });
  const s = p.sb.state.BuffTracker;
  check(s.version === 2 && s.buffs.length === 1 && noms(s.buffs[0]) === 'Selea' && s.buffs[0].target === undefined, 'converti : cible unique -> liste, effet sans cible retiré');
  check(p.handout().props.notes.includes('Bénédiction'), 'affiché dans la fenêtre');
});

// ------------------------------------------------------------------- résumé
console.log(`\n${total - echecs.length}/${total} vérifications réussies`);
if (echecs.length) {
  console.log('\nÉchecs :\n' + echecs.map((e) => ' - ' + e).join('\n'));
  process.exit(1);
}
