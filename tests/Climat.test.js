/*
 * Climat.test.js — tests de Climat.js (script API Roll20)
 *
 * Lancer :  node Climat.test.js            (teste ../scripts/Climat.js)
 *           node Climat.test.js autre.js   (teste un autre fichier)
 *
 * Aucune dépendance : Node.js suffit, Roll20 n'est pas nécessaire.
 * Trois niveaux de tests :
 *   - logique pure avec des dés SCRIPTÉS : on impose chaque tirage (« le d100 vaut 85,
 *     le d10 vaut 3 ») et on vérifie le texte et les températures. Le faux dé refuse
 *     une valeur hors de ses faces et un dé tiré en trop ;
 *   - propriétés sur des milliers de tirages (générateur pseudo-aléatoire à graine
 *     fixe, donc résultat identique à chaque lancement) : bornes de température,
 *     cohérence neige / pluie / blizzard, proportions de la table, persistance ;
 *   - flux complet : le script est chargé dans un FAUX Roll20 (module vm) et on lui
 *     envoie de vraies commandes « !climat », « !region », « !RollClimat ».
 *
 * Limite : ces tests n'ont jamais tourné dans une vraie campagne Roll20. Le rendu du
 * modèle pf_generic et les boutons à question (?{Mois|...}) ne sont pas vérifiés ici.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'scripts', 'Climat.js'));
const CODE = fs.readFileSync(SCRIPT, 'utf8');
const C = require(SCRIPT);

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
const proche = (valeur, cible, tolerance) => Math.abs(valeur - cible) <= tolerance;

// ---------------------------------------------------------------- dés
// Dé scripté : renvoie les valeurs données, dans l'ordre.
function scripte(valeurs) {
  const file = valeurs.slice();
  const rng = (faces) => {
    if (!file.length) throw new Error('dé tiré en trop : d' + faces);
    const v = file.shift();
    if (!Number.isInteger(v) || v < 1 || v > faces) throw new Error('valeur ' + v + ' impossible sur un d' + faces);
    return v;
  };
  rng.reste = () => file.length;
  return rng;
}
// Générateur pseudo-aléatoire à graine (mulberry32) : mêmes tirages à chaque lancement.
function graine(seed) {
  let a = seed >>> 0;
  const alea = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (faces) => Math.floor(alea() * faces) + 1;
}
const equilibre = (s) => (s.match(/\(/g) || []).length === (s.match(/\)/g) || []).length;
const REGION = (id) => C.REGIONS.find((r) => r.id === id);

// Texte de l'évènement pour une catégorie, une température et des dés donnés.
const texte = (evt, profil, tj, des) => {
  const rng = scripte(des);
  const t = C.decrireEvenement(evt, profil, tj, rng);
  if (rng.reste() !== 0) throw new Error('dés non consommés : ' + rng.reste() + ' (' + t + ')');
  return t;
};

// ================================================================ DONNÉES
describe('Données du calendrier et des niveaux', () => {
  check(C.MOIS.length === 12, '12 mois');
  check(C.MOIS.map((m) => m.nom).join(' ') ===
    'Abadius Calistril Pharast Gozran Desnus Sarénith Erastus Arodus Rova Lamashan Neth Kuthona',
  'ordre des mois golariens');
  check(C.MOIS.map((m) => m.base).join(',') === '-10,-5,0,5,10,10,15,15,10,5,0,-5',
    'températures de base de chaque mois, identiques à l’ancienne table');
  check(C.REGIONS.map((r) => r.id).join(' ') === 'tresfroid froid tempere chaud treschaud', 'cinq niveaux de chaleur');
  check(C.REGIONS.map((r) => (r.de10 ? 'd10' : '0') + (r.decalage >= 0 ? '+' : '') + r.decalage).join(' ') ===
    'd10-10 d10-5 0+0 d10+5 d10+10', 'écarts : d10-10, d10-5, aucun, d10+5, d10+10');
  check(C.REGIONS.map((r) => r.profil).join(' ') === 'froid froid tempere tempere desert',
    'profils : très froid et froid = froid, chaud = tempéré, très chaud = désert');
});

// ================================================================ ARGUMENTS
describe('Lecture des arguments (niveau, mois, jours)', () => {
  const a = (s) => C.analyserArguments(s);
  check(a('froid abadius').region === 'froid' && a('froid abadius').mois === 'abadius', '« froid abadius »');
  check(a('froid abadius').jours === 1, 'sans nombre : 1 jour');
  check(a('tresfroid kuthona 7').region === 'tresfroid' && a('tresfroid kuthona 7').jours === 7, '« tresfroid kuthona 7 »');
  check(a('très froid Sarénith').region === 'tresfroid' && a('très froid Sarénith').mois === 'sarenith',
    'accents, espace et majuscules acceptés');
  check(a('tres froid sarenith').region === 'tresfroid', '« tres froid » avec espace');
  check(a('Très-Chaud Neth').region === 'treschaud', 'trait d’union et majuscules');
  check(a('treschaud rova').region === 'treschaud', '« treschaud » n’est pas pris pour « chaud »');
  check(a('chaud rova').region === 'chaud', '« chaud » seul');
  check(a('tresfroid abadius').region === 'tresfroid', '« tresfroid » n’est pas pris pour « froid »');
  check(a('tempéré pharast').region === 'tempere', 'tempéré accentué');
  check(a('3 tempere neth').jours === 3 && a('3 tempere neth').mois === 'neth', 'nombre avant le reste');
  check(a('froid abadius 99').jours === C.MAX_JOURS, 'plus de ' + C.MAX_JOURS + ' jours : plafonné');
  check(a('froid abadius 0').jours === 1, '0 jour : ramené à 1');
  check(a('').region === null && a('').mois === null && a('').jours === 1, 'texte vide : rien de reconnu');
  check(a('froid').mois === null, 'mois absent');
  check(a('abadius').region === null, 'niveau absent');
  check(a('froid decembre').mois === null, 'mois inconnu');
  check(a(undefined).region === null, 'undefined sans exception');
  check(C.MOIS.every((m) => a('froid ' + m.nom).mois === m.id), 'les 12 noms de mois affichés sont reconnus');
});

// ================================================================ TABLE DES ÉVÈNEMENTS
describe('Table d100 : limites des tranches', () => {
  const ev = (profil, jet, des, prec) => C.tirerEvenement(profil, jet, scripte(des || []), prec || null);
  ['froid', 'tempere', 'desert'].forEach((p) => {
    check(ev(p, 1).cat === 'calme' && ev(p, 70).cat === 'calme', p + ' : 1 et 70 = calme');
    check(ev(p, 91).cat === 'tempete' && ev(p, 99).cat === 'tempete', p + ' : 91 et 99 = tempête');
  });
  check(ev('froid', 71, [30]).cat === 'vague' && ev('froid', 80, [30]).cat === 'vague', 'froid : 71 et 80 = vague');
  check(ev('tempere', 71, [50]).cat === 'vague' && ev('tempere', 80, [50]).cat === 'vague', 'tempéré : 71 et 80 = vague');
  check(ev('desert', 71, [1]).cat === 'vent' && ev('desert', 80, [1]).cat === 'vent', 'désert : 71 et 80 = vent');
  check(ev('froid', 81).cat === 'precipitation' && ev('froid', 90).cat === 'precipitation', 'froid : 81 et 90 = précipitations');
  check(ev('tempere', 81).cat === 'precipitation' && ev('tempere', 90).cat === 'precipitation', 'tempéré : 81 et 90 = précipitations');
  check(ev('desert', 81, [1]).cat === 'vent' && ev('desert', 90, [1]).cat === 'vent', 'désert : 81 et 90 = vent');
  check(ev('froid', 100).cat === 'violente' && ev('tempere', 100).cat === 'violente', '100 = violente tempête (froid, tempéré)');
  check(ev('desert', 100).cat === 'trombes', '100 en désert = trombes d’eau');
});

describe('Vagues de chaleur et de froid', () => {
  const ev = (profil, des, prec) => C.tirerEvenement(profil, 75, scripte(des), prec || null);
  check(ev('froid', [30]).sens === 1, 'froid : d100 = 30 -> chaleur (30 %)');
  check(ev('froid', [31]).sens === -1, 'froid : d100 = 31 -> froid (70 %)');
  check(ev('tempere', [50]).sens === 1, 'tempéré : d100 = 50 -> chaleur');
  check(ev('tempere', [51]).sens === -1, 'tempéré : d100 = 51 -> froid');
  const rng = scripte([]);   // aucun dé permis : une vague qui continue ne tire rien
  check(C.tirerEvenement('froid', 75, rng, { cat: 'vague', sens: -1 }).sens === -1, 'vague qui suit une vague de froid : même sens, sans dé');
  check(C.tirerEvenement('tempere', 75, scripte([]), { cat: 'vague', sens: 1 }).sens === 1, 'vague qui suit une vague de chaleur : même sens');
  check(ev('tempere', [50], { cat: 'calme' }).sens === 1 && ev('tempere', [51], { cat: 'calme' }).sens === -1,
    'veille calme : le sens est tiré normalement (50 -> chaleur, 51 -> froid)');
});

// ================================================================ TEXTES
describe('Vent du désert (ancien défaut : priorité d’opérateurs)', () => {
  const vent = (des) => texte({ cat: 'vent', fort: des[0] === 2 }, 'desert', 30, []);
  const t1 = C.tirerEvenement('desert', 75, scripte([1]));
  const t2 = C.tirerEvenement('desert', 75, scripte([2]));
  check(t1.cat === 'vent' && t1.fort === false, 'd2 = 1 -> vent moyen');
  check(t2.cat === 'vent' && t2.fort === true, 'd2 = 2 -> vent important');
  const m = texte(t1, 'desert', 30, []);
  const f = texte(t2, 'desert', 30, []);
  check(m === 'Venteux : vent moyen (15 à 30 km/h).', 'texte du vent moyen : ' + m);
  check(f === 'Venteux : vent important (30 à 50 km/h).', 'texte du vent important : ' + f);
  check(m !== f, 'les deux intensités sortent bien (avant : toujours « moyen »)');
  check(vent([1]).startsWith('Venteux : ') && vent([2]).startsWith('Venteux : '), 'préfixe « Venteux : » présent dans les deux cas');
});

describe('Précipitations selon la température', () => {
  const p = (tj, des) => texte({ cat: 'precipitation' }, 'tempere', tj, des);
  check(p(10, [30, 2, 3]) === 'Brouillard pendant 5 heures.', 'd100 = 30 : brouillard, 2d4 heures');
  check(p(-8, [30, 1, 1]) === 'Brouillard pendant 2 heures.', 'le brouillard ne dépend pas de la température');
  check(p(0, [31, 1, 1]) === 'Neige pendant 2 heures.', '0 °C : neige');
  check(p(-15, [90, 4, 4]) === 'Neige pendant 8 heures.', '-15 °C, d100 = 90 : neige, 8 heures');
  check(p(1, [31, 1, 1]) === 'Pluie pendant 2 heures.', '1 °C : pluie');
  check(p(25, [60, 2, 2]) === 'Pluie pendant 4 heures.', '25 °C : pluie');
  check(p(3, [91, 12]) === 'Neige fondue pendant 12 minutes.', '3 °C, d100 = 91 : neige fondue, d20 minutes');
  check(p(-4, [100, 20]) === 'Neige fondue pendant 20 minutes.', '-4 °C, d100 = 100 : neige fondue');
  check(p(4, [91, 12]) === 'Grêle pendant 12 minutes.', '4 °C : grêle');
  check(p(22, [100, 1]) === 'Grêle pendant 1 minute.', 'singulier : 1 minute');
});

describe('Tempête (91 à 99)', () => {
  const t = (profil, tj, des) => texte({ cat: 'tempete' }, profil, tj, des);
  check(t('tempere', 12, [1, 1]).endsWith('Une tempête sévit pendant 1 heure.'), '2d4 - 1 = 1 heure (singulier)');
  check(t('tempere', 12, [4, 4]).endsWith('pendant 7 heures.'), '2d4 - 1 = 7 heures au maximum');
  check(t('tempere', 12, [2, 3]).includes('pendant 4 heures.'), 'espace avant « heures » (ancien défaut : « 4heures »)');
  check(t('tempere', 12, [2, 2]).includes('vents sont violents (50 à 80 km/h)') &&
    t('tempere', 12, [2, 2]).includes('visibilité diminuée de 75 %'), 'vents 50 à 80 km/h, visibilité -75 %');
  check(t('tempere', 12, [2, 2]).startsWith('Tempête :'), 'tempête ordinaire');
  check(t('froid', -3, [2, 2]).startsWith('Tempête de neige :'), 'tempête de neige quand il gèle');
  check(t('desert', 38, [2, 2]).startsWith('Tempête de sable :'), 'tempête de sable en désert');
});

describe('Violente tempête (100) : un seul phénomène, choisi par la température', () => {
  const v = (tj, des) => texte({ cat: 'violente' }, 'tempere', tj, des);
  const bliz = v(0, [3, 2]);
  check(bliz.startsWith('Violente tempête (blizzard)') && bliz.includes('30 cm') && bliz.includes('2 jours'),
    '0 °C : blizzard, neige 30 cm, 2 jours');
  check(v(-20, [1, 1]).includes('10 cm') && v(-20, [1, 1]).includes('1 jour.'), 'blizzard minimal : 10 cm, 1 jour');
  const cyc = v(1, [6]);
  check(cyc.startsWith('Violente tempête (cyclone)') && cyc.includes('6 heures'), '1 °C : cyclone, d6 heures');
  check(v(19, [1]).includes('(cyclone)') && v(19, [1]).includes('1 heure.'), '19 °C : encore un cyclone');
  const ou = v(20, [1]);
  check(ou.startsWith('Violente tempête (ouragan)') && ou.includes('vingt-quatre à quarante-huit heures'),
    '20 °C, d2 = 1 : ouragan');
  const to = v(35, [2, 6]);
  check(to.startsWith('Violente tempête (tornade)') && to.includes('60 minutes'), '35 °C, d2 = 2 : tornade, d6 x 10 minutes');
  check(v(35, [2, 1]).includes('10 minutes'), 'tornade minimale : 10 minutes');
  check(!/blizzard/.test(v(20, [1])) && !/tornade/.test(ou) && !/cyclone/.test(to), 'un seul phénomène par texte');
  [bliz, cyc, ou, to].forEach((s, i) => check(equilibre(s), 'parenthèses équilibrées (ancien défaut : « minutes) » orphelin), texte ' + (i + 1)));
});

describe('Trombes d’eau en désert (100)', () => {
  const t = (des) => texte({ cat: 'trombes' }, 'desert', 30, des);
  check(t([1, 1]).endsWith('pendant 2 heures.'), '2d4 : minimum 2 heures');
  check(t([4, 4]).endsWith('pendant 8 heures.'), '2d4 : maximum 8 heures');
  check(equilibre(t([2, 2])), 'parenthèses équilibrées');
});

describe('Vagues : texte', () => {
  check(texte({ cat: 'vague', sens: 1 }, 'froid', 5, []) === 'Vague de chaleur (+5 °C).', 'vague de chaleur');
  check(texte({ cat: 'vague', sens: -1 }, 'froid', 5, []) === 'Vague de froid (-5 °C).', 'vague de froid');
  check(texte({ cat: 'calme' }, 'froid', 5, []) === 'Rien de particulier, temps calme.', 'temps calme');
});

// ================================================================ UN JOUR
describe('Température du jour et de la nuit', () => {
  const ctx = { profil: 'tempere', base: 10, ecart: 3 };
  let rng = scripte([4, 4, 50, 7]);
  let j = C.genererJour(1, ctx, rng, null);
  check(rng.reste() === 0, 'ordre des dés : aléa (2d4), d100, d10 de nuit');
  check(j.temperatureJour === 16, 'jour = base 10 + écart 3 + aléa (4+4-5 = 3) = 16');
  check(j.temperatureNuit === 9, 'nuit = jour - d10 = 16 - 7 = 9');
  check(j.ligne2 === 'Température : 16 °C, la nuit : 9 °C.', 'ligne des températures : ' + j.ligne2);
  check(j.cat === 'calme' && j.agite === false, 'd100 = 50 : calme, pas agité');

  const nuitSansVague = C.genererJour(1, { profil: 'froid', base: 0, ecart: -4 }, scripte([3, 2, 50, 4]), null);
  check(nuitSansVague.temperatureJour === -4 && nuitSansVague.temperatureNuit === -8, 'sans vague : jour -4, nuit -8');
  const chaleur = C.genererJour(1, { profil: 'froid', base: 0, ecart: -4 }, scripte([3, 2, 75, 10, 4]), null);
  check(chaleur.cat === 'vague' && chaleur.sens === 1, 'd100 = 75, d100 = 10 : vague de chaleur');
  check(chaleur.temperatureJour === 1, 'la vague de chaleur ajoute 5 °C au jour (-4 + 5)');
  check(chaleur.temperatureNuit === -3, 'et à la nuit (ancien défaut : la nuit ne changeait pas) : 1 - 4 = -3');
  check(chaleur.temperatureNuit - nuitSansVague.temperatureNuit === 5, 'même d10 de nuit : écart de 5 °C exactement');
  const froid = C.genererJour(1, { profil: 'tempere', base: 5, ecart: 0 }, scripte([3, 2, 75, 51, 2]), null);
  check(froid.sens === -1 && froid.temperatureJour === 0 && froid.temperatureNuit === -2, 'vague de froid : jour 0, nuit -2');
  check(froid.ligne1 === 'Vague de froid (-5 °C).', 'texte de la vague de froid');
  const nuitMin = C.genererJour(1, ctx, scripte([3, 3, 10, 1]), null);
  check(nuitMin.temperatureNuit === nuitMin.temperatureJour - 1, 'la nuit est au moins 1 °C plus froide que le jour');
});

describe('Persistance d’un jour sur l’autre', () => {
  const ctx = { profil: 'tempere', base: 10, ecart: 0 };
  const agite = { agite: true, cat: 'calme' };
  let rng = scripte([3, 2, 40, 85, 2, 50, 2, 3]);
  let j = C.genererJour(2, ctx, rng, agite);
  check(rng.reste() === 0, 'veille agitée : le d100 est tiré deux fois');
  check(j.jet === 85 && j.cat === 'precipitation' && j.agite === true, 'on garde le plus haut (85)');
  check(j.ligne1 === 'Pluie pendant 5 heures.', 'précipitation à 10 °C : ' + j.ligne1);
  rng = scripte([3, 2, 85, 2, 50, 2, 3]);
  j = C.genererJour(2, ctx, rng, { agite: false, cat: 'calme' });
  check(rng.reste() === 0 && j.jet === 85, 'veille calme : un seul d100');
  rng = scripte([3, 2, 20, 90, 2, 50, 2, 3]);
  j = C.genererJour(2, ctx, rng, agite);
  check(j.jet === 90, 'le second d100 peut aussi être gardé (90 > 20)');
  rng = scripte([3, 2, 80, 30, 10, 4]);
  j = C.genererJour(2, ctx, rng, agite);
  check(j.jet === 80 && j.cat === 'vague' && rng.reste() === 0, 'le plus haut peut être le premier (80 > 30)');
  rng = scripte([3, 2, 75, 72, 5]);
  j = C.genererJour(2, ctx, rng, { agite: true, cat: 'vague', sens: -1 });
  check(rng.reste() === 0 && j.cat === 'vague' && j.sens === -1, 'vague après vague de froid : même sens, aucun dé de sens');
  check(j.ligne1 === 'Vague de froid (-5 °C).', 'texte de la vague prolongée');
});

// ================================================================ UNE SÉRIE
describe('Série de jours', () => {
  // tempéré : pas de d10 d'écart
  let rng = scripte([3, 2, 50, 4]);
  let m = C.genererMeteo('tempere', 'pharast', 1, rng);
  check(rng.reste() === 0 && m.ecart === 0, 'tempéré : aucun d10 d’écart');
  check(m.jours.length === 1 && m.jours[0].temperatureJour === 0 && m.jours[0].temperatureNuit === -4,
    'tempéré, Pharast (base 0), aléa 0 : 0 °C le jour, -4 la nuit');

  rng = scripte([4, 3, 2, 50, 1]);
  m = C.genererMeteo('tresfroid', 'abadius', 1, rng);
  check(m.ecart === -6, 'très froid : d10 - 10 = 4 - 10 = -6');
  check(m.jours[0].temperatureJour === -16 && m.jours[0].temperatureNuit === -17, 'Abadius -10, écart -6 : -16 °C, nuit -17');

  rng = scripte([7, 3, 2, 50, 1]);
  m = C.genererMeteo('chaud', 'erastus', 1, rng);
  check(m.ecart === 12 && m.jours[0].temperatureJour === 27, 'chaud : d10 + 5 = 12 ; Erastus 15 + 12 = 27 °C');

  rng = scripte([10, 3, 2, 50, 1]);
  m = C.genererMeteo('treschaud', 'arodus', 1, rng);
  check(m.ecart === 20 && m.jours[0].temperatureJour === 35, 'très chaud : d10 + 10 = 20 ; Arodus 15 + 20 = 35 °C');

  rng = scripte([5, 3, 2, 50, 1, 4, 4, 50, 2, 3, 3, 50, 1]);
  m = C.genererMeteo('froid', 'neth', 3, rng);
  check(rng.reste() === 0 && m.jours.length === 3, '3 jours : un seul d10 d’écart pour la série (5 - 5 = 0)');
  check(m.jours.map((j) => j.temperatureJour).join(',') === '0,3,1', 'jour 1 : 0 + aléa 0 ; jour 2 : aléa 3 ; jour 3 : aléa 1');
  check(m.jours.map((j) => j.jour).join(',') === '1,2,3', 'jours numérotés 1, 2, 3');

  const hasard = graine(1);
  check(C.genererMeteo('froid', 'neth', 99, hasard).jours.length === C.MAX_JOURS, '99 jours demandés : plafonné à ' + C.MAX_JOURS);
  check(C.genererMeteo('froid', 'neth', 0, hasard).jours.length === 1, '0 jour : 1 jour');
  check(C.genererMeteo('froid', 'neth', 'x', hasard).jours.length === 1, 'nombre illisible : 1 jour');
  check(C.genererMeteo('froid', 'neth', 2.7, hasard).jours.length === 2, '2,7 jours : 2 jours');

  let erreur = '';
  try { C.genererMeteo('froid', 'decembre', 1, hasard); } catch (e) { erreur = e.message; }
  check(/Mois inconnu/.test(erreur), 'mois inconnu : exception claire, plus de NaN (' + erreur + ')');
  erreur = '';
  try { C.genererMeteo('glacial', 'neth', 1, hasard); } catch (e) { erreur = e.message; }
  check(/Région inconnue/.test(erreur), 'niveau inconnu : exception claire');

  const a = C.genererMeteo('froid', 'neth', 5, graine(42));
  const b = C.genererMeteo('froid', 'neth', 5, graine(42));
  check(JSON.stringify(a) === JSON.stringify(b), 'mêmes dés, même météo : aucun état caché');
});

// ================================================================ PROPRIÉTÉS SUR DES MILLIERS DE TIRAGES
describe('Bornes et sorties saines sur tous les mois et tous les niveaux', () => {
  const rng = graine(2026);
  let jours = 0, mauvais = 0, bornes = 0, interdits = 0, nuit = 0;
  const INTERDITS = /undefined|NaN|\{\{|\}\}|\[|\]|@|%\{|=|\|/;
  C.REGIONS.forEach((r) => C.MOIS.forEach((mo) => {
    const mini = mo.base + (r.de10 ? 1 + r.decalage : 0) - 3 - 5;
    const maxi = mo.base + (r.de10 ? 10 + r.decalage : 0) + 3 + 5;
    for (let k = 0; k < 40; k++) {
      C.genererMeteo(r.id, mo.id, C.MAX_JOURS, rng).jours.forEach((j) => {
        jours++;
        if (!Number.isInteger(j.temperatureJour) || !Number.isInteger(j.temperatureNuit)) mauvais++;
        if (j.temperatureJour < mini || j.temperatureJour > maxi) bornes++;
        if (j.temperatureNuit < j.temperatureJour - 10 || j.temperatureNuit > j.temperatureJour - 1) nuit++;
        if (INTERDITS.test(j.ligne1) || INTERDITS.test(j.ligne2)) interdits++;
        if (!equilibre(j.ligne1)) interdits++;
      });
    }
  }));
  check(jours === 5 * 12 * 40 * C.MAX_JOURS, jours + ' jours simulés');
  check(mauvais === 0, 'températures toujours entières (jamais NaN)');
  check(bornes === 0, 'température du jour toujours dans [base + écart mini - 8, base + écart maxi + 8]');
  check(nuit === 0, 'nuit toujours entre jour - 10 et jour - 1');
  check(interdits === 0, 'aucun « undefined », « NaN », « = », « }} », crochet ou parenthèse orpheline dans les textes');
});

describe('Cohérence texte / température sur 5 000 jours par niveau', () => {
  const rng = graine(7);
  const vus = { neige: 0, pluie: 0, neigeFondue: 0, grele: 0, blizzard: 0, cyclone: 0, ouragan: 0, tornade: 0, sable: 0 };
  const faux = [];
  C.REGIONS.forEach((r) => {
    for (let k = 0; k < 5000 / C.MAX_JOURS * 3; k++) {
      C.genererMeteo(r.id, C.MOIS[k % 12].id, C.MAX_JOURS, rng).jours.forEach((j) => {
        const tj = j.temperatureJour, t = j.ligne1;
        if (/^Neige pendant/.test(t)) { vus.neige++; if (tj > 0) faux.push('neige à ' + tj); }
        if (/^Pluie pendant/.test(t)) { vus.pluie++; if (tj <= 0) faux.push('pluie à ' + tj); }
        if (/^Neige fondue/.test(t)) { vus.neigeFondue++; if (tj > 3) faux.push('neige fondue à ' + tj); }
        if (/^Grêle/.test(t)) { vus.grele++; if (tj <= 3) faux.push('grêle à ' + tj); }
        if (/\(blizzard\)/.test(t)) { vus.blizzard++; if (tj > 0) faux.push('blizzard à ' + tj); }
        if (/\(cyclone\)/.test(t)) { vus.cyclone++; if (tj <= 0 || tj >= 20) faux.push('cyclone à ' + tj); }
        if (/\(ouragan\)/.test(t)) { vus.ouragan++; if (tj < 20) faux.push('ouragan à ' + tj); }
        if (/\(tornade\)/.test(t)) { vus.tornade++; if (tj < 20) faux.push('tornade à ' + tj); }
        if (/^Tempête de sable/.test(t)) { vus.sable++; if (r.profil !== 'desert') faux.push('sable hors désert'); }
        if (/^Tempête de neige/.test(t) && tj > 0) faux.push('tempête de neige à ' + tj);
      });
    }
  });
  check(faux.length === 0, 'aucune incohérence' + (faux.length ? ' : ' + faux.slice(0, 5).join(' ; ') : ''));
  check(vus.neige > 0 && vus.pluie > 0, 'neige (' + vus.neige + ') et pluie (' + vus.pluie + ') se produisent toutes deux');
  check(vus.neigeFondue > 0 && vus.grele > 0, 'neige fondue (' + vus.neigeFondue + ') et grêle (' + vus.grele + ') aussi');
  check(vus.blizzard > 0 && vus.cyclone > 0, 'blizzard (' + vus.blizzard + ') et cyclone (' + vus.cyclone + ') sont atteignables');
  check(vus.ouragan > 0 && vus.tornade > 0, 'ouragan (' + vus.ouragan + ') et tornade (' + vus.tornade + ') sont atteignables');
  check(vus.sable > 0, 'tempête de sable en désert (' + vus.sable + ')');
});

describe('Proportions de la table d100 (jours sans veille agitée)', () => {
  const rng = graine(99);
  const N = 30000;
  const ctx = { profil: 'tempere', base: 10, ecart: 0 };
  const n = { calme: 0, vague: 0, precipitation: 0, tempete: 0, violente: 0 };
  for (let i = 0; i < N; i++) n[C.genererJour(1, ctx, rng, null).cat]++;
  const p = (k) => n[k] / N;
  check(proche(p('calme'), 0.70, 0.01), 'calme ~ 70 % : ' + (100 * p('calme')).toFixed(1) + ' %');
  check(proche(p('vague'), 0.10, 0.008), 'vague ~ 10 % : ' + (100 * p('vague')).toFixed(1) + ' %');
  check(proche(p('precipitation'), 0.10, 0.008), 'précipitations ~ 10 % : ' + (100 * p('precipitation')).toFixed(1) + ' %');
  check(proche(p('tempete'), 0.09, 0.008), 'tempête ~ 9 % : ' + (100 * p('tempete')).toFixed(1) + ' %');
  check(proche(p('violente'), 0.01, 0.0025), 'violente tempête ~ 1 % : ' + (100 * p('violente')).toFixed(2) + ' %');

  let ch = 0, tot = 0;
  const froid = { profil: 'froid', base: 0, ecart: 0 };
  for (let i = 0; i < N; i++) { const j = C.genererJour(1, froid, rng, null); if (j.cat === 'vague') { tot++; if (j.sens > 0) ch++; } }
  check(proche(ch / tot, 0.30, 0.035), 'froid : ~ 30 % des vagues sont des vagues de chaleur : ' + (100 * ch / tot).toFixed(1) + ' %');
  ch = 0; tot = 0;
  for (let i = 0; i < N; i++) { const j = C.genererJour(1, ctx, rng, null); if (j.cat === 'vague') { tot++; if (j.sens > 0) ch++; } }
  check(proche(ch / tot, 0.50, 0.04), 'tempéré : ~ 50 % : ' + (100 * ch / tot).toFixed(1) + ' %');

  const dsrt = { profil: 'desert', base: 15, ecart: 15 };
  let fort = 0, vents = 0;
  for (let i = 0; i < N; i++) { const j = C.genererJour(1, dsrt, rng, null); if (j.cat === 'vent') { vents++; if (/important/.test(j.ligne1)) fort++; } }
  check(proche(fort / vents, 0.5, 0.03), 'désert : vent important ~ 50 % des vents : ' + (100 * fort / vents).toFixed(1) + ' %');
  check(proche(vents / N, 0.20, 0.012), 'désert : vent sur 71 à 90, soit ~ 20 % des jours : ' + (100 * vents / N).toFixed(1) + ' %');
});

describe('Persistance : le mauvais temps dure', () => {
  const rng = graine(5);
  const ctx = { profil: 'tempere', base: 10, ecart: 0 };
  let apresAgite = 0, agiteApresAgite = 0, apresCalme = 0, agiteApresCalme = 0;
  for (let i = 0; i < 80000; i++) {
    const veille = C.genererJour(1, ctx, rng, null);
    const jour = C.genererJour(2, ctx, rng, veille);
    if (veille.agite) { apresAgite++; if (jour.agite) agiteApresAgite++; } else { apresCalme++; if (jour.agite) agiteApresCalme++; }
  }
  const pa = agiteApresAgite / apresAgite, pc = agiteApresCalme / apresCalme;
  check(proche(pc, 0.30, 0.012), 'après un jour calme : ~ 30 % de jours agités : ' + (100 * pc).toFixed(1) + ' %');
  check(proche(pa, 0.51, 0.015), 'après un jour agité : ~ 51 % (1 - 0,7 au carré) : ' + (100 * pa).toFixed(1) + ' %');
  check(pa > pc + 0.15, 'nettement plus de mauvais temps après un jour agité');
});

// ================================================================ MESSAGES
describe('Boutons et cartes', () => {
  const lignes = (carte) => (carte.match(/\{\{(.*?)\}\}/g) || []);
  const reste = (carte) => carte.replace(/\{\{.*?\}\}/g, '').trim();

  const cr = C.carteRegions();
  check(cr.startsWith('/w gm &{template:pf_generic}'), 'carte chuchotée au MJ, modèle pf_generic');
  check(lignes(cr).length === 6, 'titre + 5 lignes de bouton : ' + lignes(cr).length);
  check(!/BlindRolls/.test(cr), 'plus de titre « BlindRolls »');
  check(/name=Climat - Niveau de chaleur/.test(cr), 'titre « Climat - Niveau de chaleur »');
  C.REGIONS.forEach((r) => check(cr.includes('[' + r.nom + '](!region ' + r.id + ')'), 'bouton ' + r.nom + ' -> !region ' + r.id));
  check(reste(cr) === '/w gm &{template:pf_generic}', 'rien en dehors des {{ }}');

  const cm = C.carteMois('froid');
  check(lignes(cm).length === 3, 'titre + ligne des mois + ligne « Plusieurs jours »');
  C.MOIS.forEach((m) => check(cm.includes('[' + m.nom + '](!RollClimat froid ' + m.id + ')'), 'bouton ' + m.nom + ' porte le niveau : !RollClimat froid ' + m.id));
  check(/\[Plusieurs jours\]\(!RollClimat froid \?\{Mois\|Abadius\|[^}]*Kuthona\} \?\{Jours\|7\}\)/.test(cm),
    'bouton « Plusieurs jours » avec question sur le mois et le nombre de jours');
  check(reste(cm) === '/w gm &{template:pf_generic}', 'rien en dehors des {{ }} (la question ?{...} ne referme pas la ligne)');
  check(/name=Mois - Froid/.test(cm), 'titre rappelant le niveau');
  check(!/Calistril\]\(!RollClimat Calistril/.test(cm), 'plus de bouton sans niveau (ancien : !RollClimat Calistril)');

  const un = C.carteResultat(C.genererMeteo('froid', 'abadius', 1, graine(3)));
  check(lignes(un).length === 3, 'un jour : titre + 2 lignes (évènement, températures)');
  check(/name=Climat - Froid - Abadius\}\}/.test(un), 'titre un jour : niveau et mois');
  const sept = C.carteResultat(C.genererMeteo('tresfroid', 'kuthona', 7, graine(3)));
  check(lignes(sept).length === 8, 'sept jours : titre + 7 lignes');
  check(/name=Climat - Très froid - Kuthona - 7 jours\}\}/.test(sept), 'titre multi-jours avec le nombre de jours');
  check(/\{\{ Jour 7 : /.test(sept) && /\{\{ Jour 1 : /.test(sept), 'chaque ligne commence par « Jour N : »');
});

describe('Commandes', () => {
  const rng = () => graine(11);
  const t = (cmd, args) => C.traiterCommande(cmd, args, rng());
  check(t('!climat', '').length === 1 && t('!climat', '')[0] === C.carteRegions(), '!climat -> boutons de niveau');
  check(t('!region', 'froid').length === 1 && t('!region', 'froid')[0] === C.carteMois('froid'), '!region froid -> boutons de mois');
  check(t('!region', 'tres froid')[0] === C.carteMois('tresfroid'), '!region tres froid (avec espace) accepté');
  const e1 = t('!region', 'glacial');
  check(e1.length === 2 && /niveau de chaleur inconnu/.test(e1[0]) && e1[1] === C.carteRegions(), '!region inconnu -> erreur + boutons de niveau');
  const e2 = t('!RollClimat', 'froid');
  check(e2.length === 2 && /mois inconnu ou absent/.test(e2[0]) && e2[1] === C.carteMois('froid'), '!RollClimat sans mois -> erreur + boutons de mois');
  const e3 = t('!RollClimat', 'froid decembre');
  check(/mois inconnu/.test(e3[0]) && !/NaN/.test(e3.join('')), 'mois inconnu -> erreur, jamais de NaN');
  const e4 = t('!RollClimat', '');
  check(/niveau de chaleur inconnu ou absent/.test(e4[0]) && e4[1] === C.carteRegions(), '!RollClimat vide -> erreur + boutons de niveau');
  const e5 = t('!RollClimat', 'Abadius');
  check(/niveau de chaleur/.test(e5[0]), 'ancien bouton « !RollClimat Abadius » (sans niveau) -> invitation à choisir un niveau');
  const r = t('!RollClimat', 'froid abadius');
  check(r.length === 1 && /name=Climat - Froid - Abadius\}\}/.test(r[0]), '!RollClimat froid abadius -> une carte');
  check(t('!rollclimat', 'froid abadius')[0] === r[0], 'commande insensible à la casse');
  check(/7 jours/.test(t('!RollClimat', 'froid abadius 7')[0]), '!RollClimat froid abadius 7 -> 7 jours');
  check(t('!gabarit', 'lancer') === null, 'commande d’un autre script : ignorée');
  check(t('!climatologie', '') === null, '« !climatologie » n’est pas « !climat »');
  check(t('', '') === null && t(undefined, '') === null, 'commande vide : ignorée');
  check(C.traiterCommande('!RollClimat', 'froid abadius', graine(11))[0] === r[0], 'mêmes dés, même carte');
});

// ================================================================ FAUX ROLL20
describe('Flux complet dans un faux Roll20', () => {
  function monde(seed) {
    const envoyes = [];
    const logs = [];
    const gestionnaires = {};
    const hasard = graine(seed);
    const sandbox = {
      on: (evenement, f) => { gestionnaires[evenement] = f; },
      sendChat: (qui, texte) => envoyes.push({ qui, texte }),
      randomInteger: hasard,
      log: (x) => logs.push(x),
      console
    };
    vm.createContext(sandbox);
    vm.runInContext(CODE, sandbox);
    const dire = (contenu, extra) => gestionnaires['chat:message'](Object.assign(
      { type: 'api', content: contenu, who: 'Sheo (GM)', playerid: 'P1' }, extra || {}));
    return { sandbox, envoyes, logs, gestionnaires, dire };
  }

  const w = monde(21);
  check(typeof w.gestionnaires['chat:message'] === 'function', 'le script écoute chat:message');
  check(Object.keys(w.gestionnaires).length === 1, 'et rien d’autre');
  check(!('region' in w.sandbox) && !('mois' in w.sandbox), 'plus de variables globales « region » et « mois »');

  w.dire('!climat');
  check(w.envoyes.length === 1 && w.envoyes[0].qui === 'Sheo (GM)', '!climat : un message, envoyé au nom de celui qui a parlé');
  check(w.envoyes[0].texte.startsWith('/w gm '), 'chuchoté au MJ');
  check(w.envoyes[0].texte === C.carteRegions(), 'même carte que la logique pure');

  w.envoyes.length = 0;
  w.dire('!region tresfroid');
  check(w.envoyes.length === 1 && /Mois - Très froid/.test(w.envoyes[0].texte), '!region tresfroid : boutons de mois');

  w.envoyes.length = 0;
  w.dire('!RollClimat froid abadius');
  check(w.envoyes.length === 1, '!RollClimat froid abadius : une seule carte (avant : deux chuchotements)');
  check(/Température : -?\d+ °C, la nuit : -?\d+ °C/.test(w.envoyes[0].texte), 'la carte donne les températures');
  check(!/NaN|undefined/.test(w.envoyes[0].texte), 'ni NaN ni undefined');

  w.envoyes.length = 0;
  w.dire('!RollClimat froid sarenith 5');
  check(w.envoyes.length === 1 && /5 jours/.test(w.envoyes[0].texte), 'cinq jours dans une seule carte');

  w.envoyes.length = 0;
  w.dire('!RollClimat froid decembre');
  check(w.envoyes.length === 2 && /mois inconnu/.test(w.envoyes[0].texte), 'mois inconnu : message d’erreur puis boutons');

  w.envoyes.length = 0;
  w.dire('Bonjour tout le monde', { type: 'general' });
  w.dire('!climat', { type: 'general' });
  w.dire('/me lance !RollClimat froid abadius', { type: 'emote' });
  w.dire('!autrecommande truc');
  check(w.envoyes.length === 0, 'messages ordinaires et commandes d’autres scripts : aucune réponse');
  check(w.logs.length === 0, 'plus aucun log (avant : chaque message du chat était écrit dans le journal)');

  // sans état : l'ordre des appels ne change pas le résultat, et deux niveaux ne se mélangent pas
  const seul = monde(5);
  seul.dire('!RollClimat treschaud arodus');
  const attendu = seul.envoyes[0].texte;
  const melange = monde(5);
  melange.dire('!region tresfroid');          // une région « choisie » avant n'a plus d'effet
  melange.envoyes.length = 0;
  melange.dire('!RollClimat treschaud arodus');
  check(melange.envoyes[0].texte === attendu, 'un !region précédent n’influence plus la météo (avant : région globale partagée)');
  const deux = monde(8);
  deux.dire('!RollClimat tresfroid abadius');
  deux.dire('!RollClimat treschaud abadius');
  const t1 = deux.envoyes[0].texte, t2 = deux.envoyes[1].texte;
  const temp = (s) => parseInt(s.match(/Température : (-?\d+)/)[1], 10);
  // très froid en Abadius : au plus -10 + 0 + 3 + 5 = -2 °C, donc toujours négatif ; très chaud : au moins -7 °C
  check(temp(t1) < 0 && temp(t2) > temp(t1),
    'très froid puis très chaud, même mois, deux niveaux bien distincts : ' + temp(t1) + ' °C puis ' + temp(t2) + ' °C');
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
