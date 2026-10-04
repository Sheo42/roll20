/*
 * Climat.test.js — tests de Climat.js (script API Roll20)
 *
 * Lancer :  node Climat.test.js            (teste ../scripts/Climat.js)
 *           node Climat.test.js autre.js   (teste un autre fichier)
 *
 * Aucune dépendance : Node.js suffit, Roll20 n'est pas nécessaire.
 * Trois niveaux de tests :
 *   - logique pure avec des dés SCRIPTÉS : on impose chaque tirage (« le d100 vaut 85,
 *     le d10 vaut 3 ») et on vérifie les phases, les textes et les températures. Le faux
 *     dé refuse une valeur hors de ses faces et un dé tiré en trop ;
 *   - propriétés sur des milliers de tirages (générateur pseudo-aléatoire à graine
 *     fixe, donc résultat identique à chaque lancement) : bornes de température,
 *     cohérence neige / pluie / blizzard, prémices, débordement d'un jour sur l'autre,
 *     proportions de la table, persistance ;
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
const INTERDITS = /undefined|NaN|\{\{|\}\}|\[|\]|@|%\{|=|\|/;
const NB = C.PHASES.length;

// phénomène créé avec des dés scriptés, qui doivent tous être consommés
const cree = (cat, profil, tj, des) => {
  const rng = scripte(des);
  const ph = C.creerPhenomene(cat, profil, tj, rng);
  if (rng.reste() !== 0) throw new Error('dés non consommés : ' + rng.reste());
  return ph;
};
// jour créé avec des dés scriptés, qui doivent tous être consommés
const jour = (numero, ctx, des, precedent, grille) => {
  const rng = scripte(des);
  const j = C.genererJour(numero, ctx, rng, precedent || null, grille);
  if (rng.reste() !== 0) throw new Error('dés non consommés : ' + rng.reste());
  return j;
};
const etats = (j) => j.phases.map((p) => p.etat);
const temperatures = (j) => j.phases.map((p) => p.temperature);

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
  check(C.PHASES.map((p) => p.nom).join(' ') === 'Matin Après-midi Soir Nuit', 'quatre phases : matin, après-midi, soir, nuit');
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
  check(C.tirerEvenement('froid', 75, scripte([]), { cat: 'vague', sens: -1 }).sens === -1,
    'vague qui suit une vague de froid : même sens, sans dé');
  check(C.tirerEvenement('tempere', 75, scripte([]), { cat: 'vague', sens: 1 }).sens === 1,
    'vague qui suit une vague de chaleur : même sens');
  check(ev('tempere', [50], { cat: 'calme' }).sens === 1 && ev('tempere', [51], { cat: 'calme' }).sens === -1,
    'veille calme : le sens est tiré normalement (50 -> chaleur, 51 -> froid)');
});

// ================================================================ TEMPÉRATURES DANS LA JOURNÉE
describe('Température de chaque phase', () => {
  check(C.temperaturesPhases(10, 0).join(',') === '4,10,6,0', 'jour 10, nuit 0 : matin 4, après-midi 10, soir 6, nuit 0');
  check(C.temperaturesPhases(5, 4).join(',') === '4,5,5,4', 'écart d’un seul degré : 4, 5, 5, 4');
  check(C.temperaturesPhases(-5, -15).join(',') === '-11,-5,-9,-15', 'températures négatives : -11, -5, -9, -15');
  const rng = graine(4);
  let ok = true;
  for (let i = 0; i < 2000; i++) {
    const tn = rng(60) - 40;
    const tj = tn + rng(10);
    const t = C.temperaturesPhases(tj, tn);
    if (t[1] !== tj || t[3] !== tn || !(t[3] <= t[0] && t[0] <= t[2] && t[2] <= t[1])) ok = false;
  }
  check(ok, 'toujours : nuit <= matin <= soir <= après-midi, après-midi = jour, nuit = nuit (2 000 tirages)');
});

// ================================================================ CRÉATION DES PHÉNOMÈNES
describe('Précipitations', () => {
  const p = (tj, des) => cree('precipitation', 'tempere', tj, des);
  let ph = p(10, [30, 2, 3]);
  check(ph.type === 'brouillard' && ph.heures === 5 && ph.longueur === 1, 'd100 = 30 : brouillard, 2d4 = 5 heures, 1 phase');
  check(ph.texte === 'Brouillard pendant 5 heures.', 'texte du brouillard : ' + ph.texte);
  check(ph.premices === null, 'pas de prémices pour un brouillard');
  ph = p(-8, [31, 1, 1]);
  check(ph.type === 'precip' && ph.heures === 2, 'd100 = 31 : précipitations, 2 heures');
  check(ph.texte === 'Précipitations pendant 2 heures (neige quand il gèle, pluie sinon).', 'texte : ' + ph.texte);
  check(p(25, [31, 1, 1]).type === 'precip', 'même type à 25 °C (neige ou pluie se décide phase par phase)');
  ph = p(10, [90, 4, 4]);
  check(ph.heures === 8 && ph.longueur === 2, 'd100 = 90, 4 + 4 : 8 heures, 2 phases');
  ph = p(3, [91, 1, 1]);
  check(ph.type === 'fondue' && ph.texte === 'Neige fondue pendant 2 heures.', '3 °C, d100 = 91 : neige fondue 2d4 heures : ' + ph.texte);
  check(p(-4, [100, 4, 3]).type === 'fondue', '-4 °C, d100 = 100 : neige fondue');
  ph = p(4, [91, 12, 3]);
  check(ph.type === 'grele' && ph.heures === 3, '4 °C : grêle');
  check(ph.texte === 'Grêle pendant 12 minutes, puis pluie pendant 3 heures.', 'grêle d20 minutes puis 1d4 heures de pluie : ' + ph.texte);
  check(p(20, [100, 1, 1]).texte === 'Grêle pendant 1 minute, puis pluie pendant 1 heure.', 'singulier : 1 minute, 1 heure');
  check(ph.premices === null, 'pas de prémices pour la grêle');
});

describe('Tempêtes (91 à 99) : sable, neige ou orage', () => {
  let ph = cree('tempete', 'desert', 38, [2, 3]);
  check(ph.type === 'sable' && ph.heures === 4, 'désert : tempête de sable, 2d4 - 1 = 4 heures');
  check(ph.texte.startsWith('Tempête de sable :') && ph.texte.includes('Elle dure 4 heures.'), 'texte du sable : ' + ph.texte);
  check(ph.texte.includes('vents sont violents (50 à 80 km/h)') && ph.texte.includes('visibilité diminuée de 75 %'),
    'vents 50 à 80 km/h, visibilité -75 %');
  ph = cree('tempete', 'froid', 0, [4, 4]);
  check(ph.type === 'tempeteneige' && ph.heures === 7 && ph.longueur === 2, '0 °C : tempête de neige, 7 heures au maximum, 2 phases');
  ph = cree('tempete', 'tempere', 1, [1, 1, 5]);
  check(ph.type === 'orage' && ph.heures === 1 && ph.tornade === false, '1 °C : orage, 1 heure au minimum, pas de tornade (d10 = 5)');
  check(ph.texte.startsWith('Orage :') && ph.texte.includes('Il dure 1 heure.') && ph.texte.includes('Foudre'),
    'texte de l’orage : ' + ph.texte);
  ph = cree('tempete', 'tempere', 15, [2, 2, 1, 6]);
  check(ph.tornade === true && ph.texte.includes('vire à la tornade pendant 60 minutes'), 'd10 = 1 : l’orage vire à la tornade (d6 x 10 minutes)');
  check(cree('tempete', 'tempere', 15, [2, 2, 2]).tornade === false, 'd10 = 2 : pas de tornade (1 chance sur 10)');
  [ph, cree('tempete', 'desert', 30, [1, 1]), cree('tempete', 'froid', -5, [1, 1])].forEach((x, i) =>
    check(equilibre(x.texte), 'parenthèses équilibrées, texte ' + (i + 1)));
});

describe('Violente tempête (100) : un seul phénomène, choisi par la température', () => {
  let ph = cree('violente', 'froid', 0, [3, 2]);
  check(ph.type === 'blizzard' && ph.heures === 48 && ph.longueur === 8, '0 °C : blizzard de 2 jours = 48 heures = 8 phases');
  check(ph.texte.startsWith('Violente tempête (blizzard)') && ph.texte.includes('90 cm') && ph.texte.includes('2 jours'),
    'neige 1d3 x 30 cm (ici 90 cm), 2 jours : ' + ph.texte);
  ph = cree('violente', 'froid', -20, [1, 1]);
  check(ph.heures === 24 && ph.longueur === 4 && ph.texte.includes('30 cm') && ph.texte.includes('1 jour.'),
    'blizzard minimal : 30 cm, 1 jour = 4 phases');
  ph = cree('violente', 'tempere', 1, [6]);
  check(ph.type === 'cyclone' && ph.heures === 6 && ph.longueur === 1 && ph.texte.includes('6 heures'), '1 °C : cyclone, d6 heures');
  check(cree('violente', 'tempere', 19, [1]).type === 'cyclone', '19 °C : encore un cyclone');
  ph = cree('violente', 'tempere', 20, [1, 2]);
  check(ph.type === 'ouragan' && ph.heures === 48 && ph.longueur === 8, '20 °C, d2 = 1 : ouragan, impact 48 heures');
  check(cree('violente', 'tempere', 20, [1, 1]).heures === 24, 'ouragan : impact de 24 heures aussi');
  ph = cree('violente', 'tempere', 35, [2, 6]);
  check(ph.type === 'tornade' && ph.longueur === 1 && ph.texte.includes('60 minutes'), '35 °C, d2 = 2 : tornade, d6 x 10 minutes, 1 phase');
  check(cree('violente', 'tempere', 35, [2, 1]).texte.includes('10 minutes'), 'tornade minimale : 10 minutes');
  ['blizzard', 'cyclone', 'ouragan', 'tornade'].forEach((t) => {
    const x = { blizzard: cree('violente', 'froid', -1, [1, 1]), cyclone: cree('violente', 'tempere', 5, [3]),
      ouragan: cree('violente', 'tempere', 25, [1, 1]), tornade: cree('violente', 'tempere', 25, [2, 3]) }[t];
    check(equilibre(x.texte), 'parenthèses équilibrées (ancien défaut : « minutes) » orphelin), ' + t);
    check(x.premices !== null, 'prémices prévues pour ' + t);
  });
});

describe('Trombes d’eau en désert (100)', () => {
  check(cree('trombes', 'desert', 30, [1, 1]).texte.endsWith('pendant 2 heures.'), '2d4 : minimum 2 heures');
  const ph = cree('trombes', 'desert', 30, [4, 4]);
  check(ph.texte.endsWith('pendant 8 heures.') && ph.longueur === 2, '2d4 : maximum 8 heures, 2 phases');
  check(equilibre(ph.texte) && ph.premices !== null, 'parenthèses équilibrées, prémices prévues');
  let erreur = '';
  try { C.creerPhenomene('calme', 'froid', 0, scripte([])); } catch (e) { erreur = e.message; }
  check(/sans phénomène/.test(erreur), 'catégorie sans phénomène : exception claire');
});

describe('Phase de départ et noms par phase', () => {
  check(C.phaseDepart({ type: 'brouillard' }, scripte([])) === 0, 'le brouillard se lève le matin, sans dé');
  check(C.phaseDepart({ type: 'orage' }, scripte([1])) === 1 && C.phaseDepart({ type: 'orage' }, scripte([2])) === 2,
    'orage : après-midi (d2 = 1) ou soir (d2 = 2)');
  check(C.phaseDepart({ type: 'tornade' }, scripte([1])) === 1 && C.phaseDepart({ type: 'tornade' }, scripte([2])) === 2,
    'tornade : après-midi ou soir');
  check([1, 2, 3, 4].map((d) => C.phaseDepart({ type: 'blizzard' }, scripte([d]))).join(',') === '0,1,2,3',
    'blizzard : d4 = 1 à 4 -> matin, après-midi, soir, nuit');
  check(C.etiquette({ type: 'precip' }, 0) === 'neige' && C.etiquette({ type: 'precip' }, 1) === 'pluie',
    'précipitations : neige à 0 °C, pluie à 1 °C');
  check(C.etiquette({ type: 'fondue' }, 20) === 'neige fondue' && C.etiquette({ type: 'grele' }, -9) === 'grêle, puis pluie',
    'neige fondue et grêle ne dépendent pas de la phase');
  check(C.etiquette({ type: 'orage', tornade: true }, 10) === 'orage et tornade' && C.etiquette({ type: 'orage' }, 10) === 'orage',
    'orage avec ou sans tornade');
  check(C.etiquette({ type: 'sable' }, 40) === 'tempête de sable' && C.etiquette({ type: 'tempeteneige' }, -5) === 'tempête de neige' &&
    C.etiquette({ type: 'trombes' }, 30) === 'trombes d’eau' && C.etiquette({ type: 'blizzard' }, -9) === 'blizzard',
    'autres noms');
});

// ================================================================ UN JOUR
describe('Température du jour et de la nuit', () => {
  const ctx = { profil: 'tempere', base: 10, ecart: 3 };
  let j = jour(1, ctx, [4, 4, 50, 7]);
  check(j.temperatureJour === 16, 'jour = base 10 + écart 3 + aléa (4+4-5 = 3) = 16');
  check(j.temperatureNuit === 9, 'nuit = jour - d10 = 16 - 7 = 9');
  check(temperatures(j).join(',') === '12,16,13,9', 'phases : 12, 16, 13, 9');
  check(etats(j).every((e) => e === 'calme') && j.cat === 'calme' && j.agite === false, 'd100 = 50 : calme, pas agité');
  check(j.ligne === 'Calme toute la journée - Matin (12 °C) · Après-midi (16 °C) · Soir (13 °C) · Nuit (9 °C)',
    'journée calme sur une ligne : ' + j.ligne);

  const sans = jour(1, { profil: 'froid', base: 0, ecart: -4 }, [3, 2, 50, 4]);
  check(sans.temperatureJour === -4 && sans.temperatureNuit === -8, 'sans vague : jour -4, nuit -8');
  const chaleur = jour(1, { profil: 'froid', base: 0, ecart: -4 }, [3, 2, 75, 10, 4]);
  check(chaleur.cat === 'vague' && chaleur.sens === 1, 'd100 = 75, d100 = 10 : vague de chaleur');
  check(chaleur.temperatureJour === 1, 'la vague de chaleur ajoute 5 °C au jour (-4 + 5)');
  check(chaleur.temperatureNuit === -3, 'et à la nuit (ancien défaut : la nuit ne changeait pas) : 1 - 4 = -3');
  check(chaleur.temperatureNuit - sans.temperatureNuit === 5, 'même d10 de nuit : écart de 5 °C exactement');
  check(temperatures(chaleur).join(',') === '-1,1,-1,-3', 'toutes les phases subissent la vague : -1, 1, -1, -3');
  check(chaleur.tag === 'Vague de chaleur (+5 °C)' && chaleur.description === '', 'la vague est un préfixe de la ligne du jour');
  check(chaleur.ligne.startsWith('Vague de chaleur (+5 °C) - Matin (-1 °C) · Après-midi (1 °C)'), 'ligne : ' + chaleur.ligne);
  const froid = jour(1, { profil: 'tempere', base: 5, ecart: 0 }, [3, 2, 75, 51, 2]);
  check(froid.sens === -1 && froid.temperatureJour === 0 && froid.temperatureNuit === -2, 'vague de froid : jour 0, nuit -2');
  check(froid.tag === 'Vague de froid (-5 °C)', 'texte de la vague de froid');
  const nuitMin = jour(1, ctx, [3, 3, 10, 1]);
  check(nuitMin.temperatureNuit === nuitMin.temperatureJour - 1, 'la nuit est au moins 1 °C plus froide que le jour');
});

describe('Vent du désert (ancien défaut : priorité d’opérateurs)', () => {
  const ctx = { profil: 'desert', base: 15, ecart: 15 };
  const moyen = jour(1, ctx, [3, 2, 85, 1, 4]);
  const fort = jour(1, ctx, [3, 2, 85, 2, 4]);
  check(moyen.tag === 'Venteux : vent moyen (15 à 30 km/h)', 'd2 = 1 : ' + moyen.tag);
  check(fort.tag === 'Venteux : vent important (30 à 50 km/h)', 'd2 = 2 : ' + fort.tag);
  check(moyen.tag !== fort.tag, 'les deux intensités sortent bien (avant : toujours « moyen »)');
  check(moyen.tag.startsWith('Venteux : ') && fort.tag.startsWith('Venteux : '), 'préfixe « Venteux : » présent dans les deux cas');
  check(etats(fort).every((e) => e === 'calme') && fort.ligne.startsWith('Venteux : vent important'), 'le vent dure toute la journée');
});

describe('Phénomène dans la journée : prémices, phase de départ', () => {
  const tempere = { profil: 'tempere', base: 10, ecart: 0 };
  // orage au soir (d2 = 2), 3 heures
  let j = jour(1, tempere, [3, 2, 95, 4, 2, 2, 5, 2]);
  check(etats(j).join(' | ') === 'calme | prémices (air lourd, gros nuages sombres) | orage | calme',
    'orage le soir : prémices l’après-midi : ' + etats(j).join(' | '));
  check(j.cat === 'tempete' && j.agite === true && j.description.startsWith('Orage :'), 'catégorie tempête, jour agité, règles en seconde ligne');
  check(temperatures(j).join(',') === '8,10,8,6', 'températures des phases : 8, 10, 8, 6');
  // orage l'après-midi (d2 = 1) : prémices le matin
  j = jour(1, tempere, [3, 2, 95, 4, 2, 2, 5, 1]);
  check(etats(j).join(' | ') === 'prémices (air lourd, gros nuages sombres) | orage | calme | calme', 'orage l’après-midi : prémices le matin');
  // blizzard d'un jour qui commence au lever : pas de prémices, toute la journée
  const froid = { profil: 'froid', base: -10, ecart: 0 };
  j = jour(1, froid, [3, 2, 100, 5, 1, 1, 1]);
  check(etats(j).join(' | ') === 'blizzard | blizzard | blizzard | blizzard', 'blizzard déjà là au lever : toute la journée, sans prémices');
  check(!/se poursuit/.test(j.ligne), 'un blizzard de 24 h qui finit avec la journée ne « se poursuit » pas');
  check(j.ligne.startsWith('Matin (-13 °C) : blizzard · Après-midi (-10 °C) : blizzard'), 'ligne : ' + j.ligne.slice(0, 80));
  // blizzard de 2 jours qui commence le soir, sur un seul jour demandé
  j = jour(1, froid, [3, 2, 100, 5, 1, 2, 3]);
  check(etats(j).join(' | ') === 'calme | prémices (ciel plombé, le vent forcit) | blizzard | blizzard (se poursuit)',
    'blizzard de 2 jours à partir du soir : « se poursuit » : ' + etats(j).join(' | '));
  check(j.description.includes('2 jours') && j.description.includes('30 cm'), 'règles : 2 jours, 30 cm');
  // brouillard : toujours le matin, sans dé de départ
  j = jour(1, tempere, [3, 2, 85, 4, 30, 1, 1]);
  check(etats(j).join(' | ') === 'brouillard | calme | calme | calme', 'brouillard : le matin, sans prémices');
  check(j.description === 'Brouillard pendant 2 heures.', 'description : ' + j.description);
  // précipitation qui commence l'après-midi
  j = jour(1, tempere, [3, 2, 85, 4, 50, 2, 3, 2]);
  check(etats(j).join(' | ') === 'calme | pluie | calme | calme', 'pluie l’après-midi (5 heures, une seule phase)');
});

describe('La neige ou la pluie suit la température de la phase', () => {
  // 7 heures de précipitations = 2 phases : après-midi (juste au-dessus de 0) puis soir (sous 0)
  const ctx = { profil: 'froid', base: -4, ecart: 0 };
  const j = jour(1, ctx, [3, 2, 85, 8, 50, 4, 3, 2]);
  check(temperatures(j).join(',') === '-9,-4,-7,-12', 'températures : -9, -4, -7, -12 (jour -4, nuit -12)');
  check(etats(j).join(' | ') === 'calme | neige | neige | calme', 'sous 0 °C toute la journée : neige');
  const doux = jour(1, { profil: 'froid', base: 2, ecart: 0 }, [3, 2, 85, 8, 50, 4, 3, 2]);
  check(temperatures(doux).join(',') === '-3,2,-1,-6', 'jour 2 °C, nuit -6 : -3, 2, -1, -6');
  check(etats(doux).join(' | ') === 'calme | pluie | neige | calme', 'pluie l’après-midi qui vire en neige le soir');
});

describe('Persistance d’un jour sur l’autre', () => {
  const ctx = { profil: 'tempere', base: 10, ecart: 0 };
  const agite = { agite: true, cat: 'calme' };
  let j = jour(2, ctx, [3, 2, 40, 85, 2, 50, 2, 3, 2], agite, new Array(8).fill(null));
  check(j.jet === 85 && j.cat === 'precipitation' && j.agite === true, 'veille agitée : deux d100 (40 et 85), on garde le plus haut');
  check(etats(j).join(' | ') === 'calme | pluie | calme | calme', 'précipitation à 10 °C : ' + etats(j).join(' | '));
  j = jour(2, ctx, [3, 2, 85, 2, 50, 2, 3, 2], { agite: false, cat: 'calme' }, new Array(8).fill(null));
  check(j.jet === 85, 'veille calme : un seul d100');
  j = jour(2, ctx, [3, 2, 20, 90, 2, 50, 2, 3, 2], agite, new Array(8).fill(null));
  check(j.jet === 90, 'le second d100 peut aussi être gardé (90 > 20)');
  j = jour(1, ctx, [3, 2, 80, 30, 10, 4], agite);
  check(j.jet === 80 && j.cat === 'vague', 'le plus haut peut être le premier (80 > 30)');
  j = jour(1, ctx, [3, 2, 75, 72, 5], { agite: true, cat: 'vague', sens: -1 });
  check(j.cat === 'vague' && j.sens === -1 && j.tag === 'Vague de froid (-5 °C)', 'vague après vague de froid : même sens, aucun dé de sens');
});

// ================================================================ UNE SÉRIE
describe('Débordement d’un phénomène sur les jours suivants', () => {
  // très froid, Abadius : écart d10 - 10 = 4 - 10 = -6, base -10, aléa 0 -> jour -16 °C
  // J1 : d100 = 100, blizzard de 2 jours (48 h = 8 phases) qui commence au soir (phase 3)
  // J2 : phénomène en cours au lever -> aucun d100 ; J3 : idem jusqu'au milieu de l'après-midi
  let rng = scripte([4, 3, 2, 100, 5, 2, 2, 3, 3, 2, 3, 3, 2, 4]);
  let m = C.genererMeteo('tresfroid', 'abadius', 3, rng);
  check(rng.reste() === 0, 'jours 2 et 3 : aucun d100 tiré (le blizzard est l’évènement du jour)');
  check(m.ecart === -6, 'écart du niveau tiré une fois : -6');
  const [j1, j2, j3] = m.jours;
  check(etats(j1).join(' | ') === 'calme | prémices (ciel plombé, le vent forcit) | blizzard | blizzard', 'jour 1 : prémices, puis blizzard le soir et la nuit');
  check(etats(j2).join(' | ') === 'blizzard | blizzard | blizzard | blizzard', 'jour 2 : blizzard toute la journée');
  check(etats(j3).join(' | ') === 'blizzard | blizzard | calme | calme', 'jour 3 : le blizzard se termine à la fin de l’après-midi, puis calme');
  check(j2.cat === 'suite' && j3.cat === 'suite', 'jours 2 et 3 : catégorie « suite »');
  check(j2.jet === null && j2.description === '' && j2.tag === '', 'jour 2 : ni d100, ni nouvelle description');
  check(j2.agite === true && j3.agite === true, 'jours en suite : agités');
  check(j1.description.includes('2 jours') && j1.description.includes('60 cm'), 'règles données une seule fois, le jour 1 : ' + j1.description.slice(0, 80));
  check(j2.temperatureJour === -16 && j2.temperatureNuit === -19 && j3.temperatureNuit === -20,
    'les températures continuent de varier : jour 2 nuit -19, jour 3 nuit -20');
  check(!/se poursuit/.test(m.jours.map((j) => j.ligne).join(' ')), 'sur 3 jours, le blizzard finit dans la série : pas de « se poursuit »');

  // même blizzard, mais 2 jours demandés : il dépasse la série
  rng = scripte([4, 3, 2, 100, 5, 2, 2, 3, 3, 2, 3]);
  m = C.genererMeteo('tresfroid', 'abadius', 2, rng);
  check(rng.reste() === 0 && etats(m.jours[1]).join(' | ') === 'blizzard | blizzard | blizzard | blizzard (se poursuit)',
    'série de 2 jours : « se poursuit » sur la dernière phase');
});

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
  let jours = 0, mauvais = 0, bornes = 0, interdits = 0, nuit = 0, phasesFaux = 0, parentheses = 0;
  C.REGIONS.forEach((r) => C.MOIS.forEach((mo) => {
    const mini = mo.base + (r.de10 ? 1 + r.decalage : 0) - 3 - 5;
    const maxi = mo.base + (r.de10 ? 10 + r.decalage : 0) + 3 + 5;
    for (let k = 0; k < 40; k++) {
      C.genererMeteo(r.id, mo.id, C.MAX_JOURS, rng).jours.forEach((j) => {
        jours++;
        if (!Number.isInteger(j.temperatureJour) || !Number.isInteger(j.temperatureNuit)) mauvais++;
        if (j.temperatureJour < mini || j.temperatureJour > maxi) bornes++;
        if (j.temperatureNuit < j.temperatureJour - 10 || j.temperatureNuit > j.temperatureJour - 1) nuit++;
        const t = temperatures(j);
        if (j.phases.length !== NB || t[1] !== j.temperatureJour || t[3] !== j.temperatureNuit ||
          !(t[3] <= t[0] && t[0] <= t[2] && t[2] <= t[1])) phasesFaux++;
        [j.ligne, j.description, j.tag].forEach((s) => { if (INTERDITS.test(s)) interdits++; if (!equilibre(s)) parentheses++; });
      });
    }
  }));
  check(jours === 5 * 12 * 40 * C.MAX_JOURS, jours + ' jours simulés');
  check(mauvais === 0, 'températures toujours entières (jamais NaN)');
  check(bornes === 0, 'température du jour toujours dans [base + écart mini - 8, base + écart maxi + 8]');
  check(nuit === 0, 'nuit toujours entre jour - 10 et jour - 1');
  check(phasesFaux === 0, '4 phases, après-midi = jour, nuit = nuit, nuit <= matin <= soir <= après-midi');
  check(interdits === 0, 'aucun « undefined », « NaN », « = », « }} », crochet ou barre dans les textes');
  check(parentheses === 0, 'aucune parenthèse orpheline');
});

describe('Cohérence du texte avec la température et les phases (5 régions, 12 mois)', () => {
  const rng = graine(7);
  const faux = [];
  const vus = { neige: 0, pluie: 0, neigeFondue: 0, grele: 0, blizzard: 0, cyclone: 0, ouragan: 0, tornade: 0,
    sable: 0, orage: 0, suite: 0, premices: 0, brouillard: 0 };
  const premier = (j, re) => j.phases.findIndex((p) => re.test(p.etat));
  C.REGIONS.forEach((r) => C.MOIS.forEach((mo) => {
    for (let k = 0; k < 20; k++) {
      const m = C.genererMeteo(r.id, mo.id, C.MAX_JOURS, rng);
      m.jours.forEach((j, i) => {
        const tj = j.temperatureJour, d = j.description;
        // neige / pluie : selon la température de la phase elle-même
        j.phases.forEach((p) => {
          if (p.etat === 'neige') { vus.neige++; if (p.temperature > 0) faux.push('neige à ' + p.temperature); }
          if (p.etat === 'pluie') { vus.pluie++; if (p.temperature <= 0) faux.push('pluie à ' + p.temperature); }
          if (/^prémices/.test(p.etat)) vus.premices++;
        });
        // type de phénomène : selon le maximum du jour
        if (/^Neige fondue/.test(d)) { vus.neigeFondue++; if (tj > 3) faux.push('neige fondue à ' + tj); }
        if (/^Grêle/.test(d)) { vus.grele++; if (tj <= 3) faux.push('grêle à ' + tj); }
        if (/\(blizzard\)/.test(d)) { vus.blizzard++; if (tj > 0) faux.push('blizzard à ' + tj); }
        if (/\(cyclone\)/.test(d)) { vus.cyclone++; if (tj <= 0 || tj >= 20) faux.push('cyclone à ' + tj); }
        if (/\(ouragan\)/.test(d)) { vus.ouragan++; if (tj < 20) faux.push('ouragan à ' + tj); }
        if (/\(tornade\)/.test(d)) { vus.tornade++; if (tj < 20) faux.push('tornade à ' + tj); }
        if (/^Tempête de sable/.test(d)) { vus.sable++; if (r.profil !== 'desert') faux.push('sable hors désert'); }
        if (/^Orage/.test(d)) { vus.orage++; if (tj <= 0 || r.profil === 'desert') faux.push('orage à ' + tj + ' en ' + r.profil); }
        if (/^Tempête de neige/.test(d) && (tj > 0 || r.profil === 'desert')) faux.push('tempête de neige à ' + tj);
        // heures de départ
        if (/^Brouillard/.test(d)) { vus.brouillard++; if (j.phases[0].etat !== 'brouillard') faux.push('brouillard hors du matin'); }
        if (/^Orage|\(tornade\)/.test(d)) {
          const idx = premier(j, /^(orage|tornade)/);
          if (idx !== 1 && idx !== 2) faux.push('orage ou tornade en phase ' + idx);
        }
        // prémices : juste avant le phénomène, jamais avant le matin, jamais seules
        j.phases.forEach((p, n) => {
          if (/^prémices/.test(p.etat)) {
            const suivant = j.phases[n + 1];
            if (!suivant || suivant.etat === 'calme' || /^prémices/.test(suivant.etat)) faux.push('prémices sans phénomène derrière');
          }
        });
        // débordement : un jour « suite » suit un jour dont la dernière phase était active
        if (j.cat === 'suite') {
          vus.suite++;
          const veille = m.jours[i - 1];
          if (i === 0) faux.push('suite le premier jour');
          else if (veille.phases[NB - 1].etat === 'calme' || /^prémices/.test(veille.phases[NB - 1].etat)) faux.push('suite après une nuit calme');
          if (j.jet !== null || j.description !== '' || j.tag !== '') faux.push('suite avec d100 ou description');
          if (j.phases[0].etat === 'calme') faux.push('suite avec un matin calme');
        } else if (j.jet === null) faux.push('jour sans d100 hors suite');
      });
    }
  }));
  check(faux.length === 0, 'aucune incohérence' + (faux.length ? ' : ' + faux.slice(0, 5).join(' ; ') : ''));
  check(vus.neige > 0 && vus.pluie > 0, 'neige (' + vus.neige + ') et pluie (' + vus.pluie + ') se produisent toutes deux');
  check(vus.neigeFondue > 0 && vus.grele > 0, 'neige fondue (' + vus.neigeFondue + ') et grêle (' + vus.grele + ') aussi');
  check(vus.blizzard > 0 && vus.cyclone > 0, 'blizzard (' + vus.blizzard + ') et cyclone (' + vus.cyclone + ') sont atteignables');
  check(vus.ouragan > 0 && vus.tornade > 0, 'ouragan (' + vus.ouragan + ') et tornade (' + vus.tornade + ') sont atteignables');
  check(vus.sable > 0 && vus.orage > 0 && vus.brouillard > 0, 'sable (' + vus.sable + '), orage (' + vus.orage + '), brouillard (' + vus.brouillard + ')');
  check(vus.suite > 0, 'des jours « suite » apparaissent (' + vus.suite + ') : les phénomènes longs débordent');
  check(vus.premices > 0, 'des prémices apparaissent (' + vus.premices + ')');
});

describe('Proportions de la table d100 et heures de départ (jours isolés)', () => {
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
  for (let i = 0; i < N; i++) { const j = C.genererJour(1, dsrt, rng, null); if (j.cat === 'vent') { vents++; if (/important/.test(j.tag)) fort++; } }
  check(proche(fort / vents, 0.5, 0.03), 'désert : vent important ~ 50 % des vents : ' + (100 * fort / vents).toFixed(1) + ' %');
  check(proche(vents / N, 0.20, 0.012), 'désert : vent sur 71 à 90, soit ~ 20 % des jours : ' + (100 * vents / N).toFixed(1) + ' %');

  // heure de départ des tempêtes de neige : uniforme sur les 4 phases
  const gel = { profil: 'froid', base: -10, ecart: 0 };
  const depart = [0, 0, 0, 0];
  let tempetes = 0;
  for (let i = 0; i < N; i++) {
    const j = C.genererJour(1, gel, rng, null);
    if (j.cat === 'tempete') { tempetes++; depart[j.phases.findIndex((x) => x.etat === 'tempête de neige')]++; }
  }
  check(depart.every((d) => proche(d / tempetes, 0.25, 0.04)), 'tempête de neige : départ uniforme matin / après-midi / soir / nuit : ' +
    depart.map((d) => (100 * d / tempetes).toFixed(0) + ' %').join(', '));
  // orage : après-midi ou soir uniquement, moitié-moitié
  const orages = [0, 0, 0, 0];
  let nbOrages = 0;
  for (let i = 0; i < N; i++) {
    const j = C.genererJour(1, ctx, rng, null);
    if (j.cat === 'tempete') { nbOrages++; orages[j.phases.findIndex((x) => /^orage/.test(x.etat))]++; }
  }
  check(orages[0] === 0 && orages[3] === 0 && proche(orages[1] / nbOrages, 0.5, 0.05),
    'orage : jamais le matin ni la nuit, ~ 50 % l’après-midi : ' + (100 * orages[1] / nbOrages).toFixed(0) + ' %');
  const durees = { tornade: 0 };
  for (let i = 0; i < 60000; i++) {
    const j = C.genererJour(1, ctx, rng, null);
    if (j.cat === 'tempete') { if (/tornade/.test(j.description)) durees.tornade++; }
  }
  check(proche(durees.tornade / (60000 * 0.09), 0.10, 0.03), 'orage : ~ 10 % virent à la tornade : ' + (100 * durees.tornade / (60000 * 0.09)).toFixed(1) + ' %');
});

describe('Persistance : le mauvais temps dure', () => {
  const rng = graine(5);
  const ctx = { profil: 'tempere', base: 10, ecart: 0 };
  let apresAgite = 0, agiteApresAgite = 0, apresCalme = 0, agiteApresCalme = 0;
  for (let i = 0; i < 80000; i++) {
    const veille = C.genererJour(1, ctx, rng, null);
    const lendemain = C.genererJour(2, ctx, rng, veille, new Array(2 * NB).fill(null));
    if (veille.agite) { apresAgite++; if (lendemain.agite) agiteApresAgite++; } else { apresCalme++; if (lendemain.agite) agiteApresCalme++; }
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

  // une ligne par jour, plus une ligne de règles pour chaque phénomène qui naît
  const compte = (meteo) => 1 + meteo.jours.length + meteo.jours.filter((j) => j.description).length;
  const m1 = C.genererMeteo('froid', 'abadius', 1, graine(3));
  const un = C.carteResultat(m1);
  check(lignes(un).length === compte(m1), 'un jour : titre + ligne du jour + règles éventuelles (' + lignes(un).length + ')');
  check(/name=Climat - Froid - Abadius\}\}/.test(un), 'titre un jour : niveau et mois');
  check(!/\{\{ Jour 1 - /.test(un), 'un seul jour : pas de préfixe « Jour 1 - »');
  const m7 = C.genererMeteo('tresfroid', 'kuthona', 7, graine(3));
  const sept = C.carteResultat(m7);
  check(lignes(sept).length === compte(m7), 'sept jours : titre + 7 lignes + règles (' + lignes(sept).length + ')');
  check(/name=Climat - Très froid - Kuthona - 7 jours\}\}/.test(sept), 'titre multi-jours avec le nombre de jours');
  check(/\{\{ Jour 7 - /.test(sept) && /\{\{ Jour 1 - /.test(sept), 'chaque ligne de jour commence par « Jour N - »');
  check(reste(sept) === '/w gm &{template:pf_generic}', 'rien en dehors des {{ }}');
  const m14 = C.genererMeteo('chaud', 'rova', 14, graine(8));
  const rangees = lignes(C.carteResultat(m14)).map((l) => l.slice(2, -2));
  check(rangees.length === compte(m14), '14 jours : ' + rangees.length + ' lignes (titre + 14 jours + règles)');
  check(rangees[0].startsWith('name=') && rangees.slice(1).every((l) => !INTERDITS.test(l)),
    '14 jours : aucun caractère interdit dans les lignes (seul le titre contient « name= »)');
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
  check(/Matin \(-?\d+ °C\)/.test(w.envoyes[0].texte) && /Nuit \(-?\d+ °C\)/.test(w.envoyes[0].texte), 'la carte donne la température de chaque phase');
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
  const temp = (s) => parseInt(s.match(/Après-midi \((-?\d+) °C\)/)[1], 10);
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
