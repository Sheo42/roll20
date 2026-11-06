/*
 * lumiere.test.js — tests de lumiere.js (script API Roll20) avec bufftracker.js
 *
 * Lancer :  node tests/lumiere.test.js
 *
 * Aucune dépendance : Node.js suffit. Logique pure, puis flux complet dans un FAUX
 * Roll20 où bufftracker.js, invis.js et lumiere.js sont chargés ensemble.
 * Non vérifié ici : le rendu réel de la lumière dans Roll20 (partie de test).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'lumiere.js');
const BUFF = path.join(__dirname, '..', 'scripts', 'bufftracker.js');
const INVIS = path.join(__dirname, '..', 'scripts', 'invis.js');
const L = require(SCRIPT);

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
  [['Lumière', 'Lumière'], ['lumiere', 'Lumière'], ['Light', 'Lumière'], ['Lumière du jour', 'Lumière du jour'], ['Daylight', 'Lumière du jour'],
    ['Lumières dansantes', 'Lumières dansantes'], ['Torche (Paz)', 'Torche'], ['Sunrod', 'Bâton éclairant'], ['Lanterne sourde', 'Lanterne sourde']]
    .forEach(([n, s]) => check((L.sourceOf(n) || {}).name === s, `« ${n} » = ${s}`));
  ['Lance de lumière', 'Prison de lumière', 'Bénédiction', '', 'Lumière noire'].forEach((n) => check(!L.sourceOf(n), `« ${n} » n'éclaire pas`));
  check(L.best([L.sourceOf('Torche'), L.sourceOf('Lumière du jour'), null]).name === 'Lumière du jour', 'plusieurs sources : la plus grande');
});

describe('Portées', () => {
  const t = L.lightProps(L.sourceOf('Torche'), 'm');
  check(t.emits_bright_light === true && t.bright_light_distance === 6 && t.low_light_distance === 12 && t.light_angle === 360, 'Torche : 6 m + 6 m');
  check(t.lightColor === '#ffb366' && t.dim_light_opacity === 0.3, 'flamme orangée, opacité 30 %');
  const j = L.lightProps(L.sourceOf('Lumière du jour'), 'm');
  check(j.bright_light_distance === 18 && j.low_light_distance === 36 && j.lightColor === 'transparent', 'Lumière du jour : 18 + 18, blanche');
  const b = L.lightProps(L.sourceOf('Bougie'), 'm');
  check(b.emits_bright_light === false && b.low_light_distance === 1.5, 'Bougie : faible seulement');
  check(L.lightProps(L.sourceOf('Lanterne sourde'), 'm').light_angle === 90, 'Lanterne sourde : cône de 90°');
  const f = L.lightProps(L.sourceOf('Torche'), 'ft');
  check(f.bright_light_distance === 20 && f.low_light_distance === 40, 'carte en pieds : 20 ft + 20 ft');
});

describe('Commandes', () => {
  check(L.parseCommand('!lumiere list').sub === 'list', 'list');
  check(L.parseCommand('!lumiere').sub === 'help', 'sans rien : aide');
  check(L.parseCommand('!lumieres') === null && L.parseCommand('!buff') === null, 'autres commandes ignorées');
});

// ================================================================= FAUX ROLL20
const NOIR = { emits_bright_light: false, emits_low_light: false, bright_light_distance: 0, low_light_distance: 0, light_angle: 360, lightColor: 'transparent', dim_light_opacity: 0.5 };

function partie() {
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
  mk('page', { name: 'Runeforge', scale_units: 'm' }).id = 'p1';
  mk('page', { name: 'Ancienne carte', scale_units: 'ft' }).id = 'p2';
  const lune = mk('character', { name: 'Lune', controlledby: 'pD' });
  const tok = (nom, ch, page = 'p1', extra = {}) => mk('graphic', {
    _subtype: 'token', _pageid: page, name: nom, represents: ch ? ch.id : '', controlledby: '', currentside: 0, ...NOIR, ...extra
  });
  const t = { lune: tok('Lune', lune), lune2: tok('Lune', lune, 'p2'), paz: tok('Paz', null, 'p1', { emits_low_light: true, low_light_distance: 3 }) };
  [BUFF, INVIS, SCRIPT].forEach((f) => vm.runInContext(fs.readFileSync(f, 'utf8'), sb));
  fire('ready');
  const dire = (pid, content, selected = []) => {
    const avant = chat.length;
    fire('chat:message', { type: 'api', content, playerid: pid, who: pid, selected: selected.map((x) => ({ _id: x.id, _type: 'graphic' })) });
    return chat.slice(avant).join('\n');
  };
  const eteint = (x) => !x.props.emits_bright_light && !x.props.emits_low_light && x.props.dim_light_opacity === 0.5;
  return { fire, objs, sb, chat, t, tok, lune, dire, timers, eteint, buffs: () => sb.state.BuffTracker.buffs };
}

describe('Sort Lumière du jour', () => {
  const p = partie();
  p.dire('pD', `!buff add --spell daylight --cl 15 --targets ${p.t.lune.id}`, [p.t.lune]);
  check(p.buffs().length === 1 && p.buffs()[0].name === 'Lumière du jour' && p.buffs()[0].remaining === 1500, 'sort courant : 150 min au niveau 15');
  const l = p.t.lune.props;
  check(l.emits_bright_light && l.bright_light_distance === 18 && l.low_light_distance === 36 && l.dim_light_opacity === 0.3, 'Lune éclaire à 18 m + 18 m');
  check(p.t.lune2.props.bright_light_distance === 60, 'son token sur la carte en pieds : 60 ft');
  check(p.t.paz.props.low_light_distance === 3 && !p.t.paz.props.emits_bright_light, 'Paz pas touché');
  p.dire('gm', '!buff time 150min confirm 1');
  check(p.buffs().length === 0 && p.eteint(p.t.lune) && p.eteint(p.t.lune2), 'fin du sort : lumière éteinte (état d\'avant remis)');
});

describe('Lumière d\'avant remise, plusieurs effets', () => {
  const p = partie();
  p.dire('gm', `!buff add --name Torche --dur 1h --targets ${p.t.paz.id}`);
  check(p.t.paz.props.bright_light_distance === 6 && p.t.paz.props.lightColor === '#ffb366', 'Torche : 6 m, orangée');
  p.dire('gm', `!buff add --spell light --cl 15 --targets ${p.t.paz.id}`);
  p.dire('gm', `!buff add --spell daylight --cl 15 --targets ${p.t.paz.id}`);
  check(p.t.paz.props.bright_light_distance === 18, 'Lumière du jour en plus : la plus grande éclaire');
  p.dire('gm', '!buff time 1h confirm 3');
  check(p.buffs().length === 2 && p.t.paz.props.bright_light_distance === 18, 'torche finie : toujours 18 m');
  p.dire('gm', '!buff clear all confirm 2');
  check(p.t.paz.props.emits_low_light === true && p.t.paz.props.low_light_distance === 3 && !p.t.paz.props.emits_bright_light, 'tout fini : sa lumière faible de 3 m revient');
});

describe('Lumière changée à la main pendant l\'effet', () => {
  const p = partie();
  p.dire('gm', `!buff add --spell light --cl 5 --targets ${p.t.lune.id}`);
  p.t.lune.set({ bright_light_distance: 9, low_light_distance: 9 }); // macro Lumière
  p.dire('gm', '!buff clear all confirm 1');
  check(p.t.lune.props.bright_light_distance === 9 && p.t.lune.props.emits_bright_light, 'pas éteinte : le joueur a choisi une autre lumière');
  check(p.eteint(p.t.lune2), 'son autre token, inchangé, est remis');
});

describe('Autres effets, nouveau token, redémarrage', () => {
  const p = partie();
  p.dire('gm', `!buff add --spell bless --cl 5 --targets ${p.t.lune.id}`);
  p.dire('gm', `!buff add --name Invisibilité --dur 3r --targets ${p.t.paz.id}`);
  check(p.eteint(p.t.lune) && p.t.paz.props.low_light_distance === 3, 'Bénédiction et Invisibilité ne touchent pas la lumière');
  p.dire('gm', `!buff add --spell dancinglights --cl 5 --targets ${p.t.lune.id}`);
  const t3 = p.tok('Lune', p.lune);
  p.fire('add:graphic', t3);
  p.timers.splice(0).forEach((f) => f());
  check(t3.props.bright_light_distance === 6, 'un token de Lune posé ensuite éclaire aussi');
  p.fire('ready');
  check(Object.keys(p.sb.state.Lumiere.tokens).length === 3, 'redémarrage : rien en double');
  const r = p.dire('gm', '!lumiere list');
  check(r.includes('Lune') && r.includes('Lumières dansantes'), 'list : tokens allumés');
  t3.remove();
  check(!p.sb.state.Lumiere.tokens[t3.id], 'token supprimé : oublié');
  check(p.dire('pD', '!lumiere list').includes('réservée au MJ'), 'list : MJ seulement');
});

console.log(`\n${total - echecs.length}/${total} vérifications réussies`);
if (echecs.length) { console.log('\nÉCHECS :\n' + echecs.join('\n')); process.exit(1); }
