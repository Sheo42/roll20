/*
 * Climat.js — météo aléatoire (Pathfinder 1e, calendrier de Golarion) pour l'API Roll20
 * Version 2.0 — sans état global, météo cohérente avec la température, mode multi-jours.
 *
 * UTILISATION (MJ)
 *   !climat                       5 boutons de niveau de chaleur
 *   !region <niveau>              12 boutons de mois (Abadius à Kuthona)
 *   !RollClimat <niveau> <mois> [jours]
 *                                 météo, chuchotée au MJ. Exemples :
 *                                   !RollClimat froid abadius
 *                                   !RollClimat tresfroid kuthona 7
 *   Niveaux : tresfroid, froid, tempere, chaud, treschaud (accents et espaces
 *   acceptés : « très froid »). Le niveau est passé dans la commande : le script
 *   ne retient rien entre deux appels (plus de variable globale).
 *   Plusieurs jours : de 1 à 14, dans le même mois (pour un voyage à cheval sur deux
 *   mois, lancer le second mois à part).
 *
 * TEMPÉRATURE DU JOUR
 *   base du mois (-10 à 15 °C) + écart du niveau + aléa du jour
 *     très froid : d10 - 10   froid : d10 - 5   tempéré : 0   chaud : d10 + 5
 *     très chaud : d10 + 10   (l'écart est tiré UNE fois par série de jours)
 *     aléa du jour : 2d4 - 5, soit de -3 à +3 °C (voir ALEA_JOUR)
 *   Une vague de chaleur / de froid ajoute / retire 5 °C au jour ET à la nuit.
 *   La nuit vaut le jour moins un d10.
 *
 * ÉVÉNEMENT DU JOUR (d100)
 *    1 - 70   temps calme
 *   71 - 80   froid : vague de chaleur 30 % / de froid 70 %   tempéré : 50 % / 50 %
 *             désert : vent
 *   81 - 90   froid et tempéré : brouillard 30 %, pluie ou neige 60 %,
 *             grêle ou neige fondue 10 %   désert : vent
 *   91 - 99   tempête de 1 à 7 h (vents 50 à 80 km/h, visibilité -75 %)
 *   100       froid et tempéré : violente tempête   désert : trombes d'eau (2 à 8 h)
 *   « Désert » = niveau « très chaud ». « Chaud » se traite comme « tempéré ».
 *
 * COHÉRENCE AVEC LA TEMPÉRATURE (température du jour, vague comprise)
 *   neige si <= 0 °C, sinon pluie ; neige fondue si <= 3 °C, sinon grêle
 *   violente tempête : blizzard si <= 0 °C ; cyclone de 1 à 19 °C ;
 *                      ouragan ou tornade (1 chance sur 2) à partir de 20 °C
 *   Les seuils sont les constantes TEMP_* ci-dessous.
 *
 * CONTINUITÉ ENTRE LES JOURS
 *   Après un jour agité (d100 > 70), le d100 du lendemain est tiré deux fois et on
 *   garde le plus haut : le mauvais temps tend à durer. Une vague qui suit une vague
 *   va dans le même sens.
 *
 * Le script est un seul fichier, sans dépendance. Les tirages passent par une
 * fonction « rng(faces) » : randomInteger dans Roll20, un faux dé dans les tests.
 */
(function () {
  'use strict';

  // ===================== RÉGLAGES =====================
  const MAX_JOURS = 14;      // plafond du mode multi-jours
  const TEMP_GEL = 0;        // <= : neige, blizzard
  const TEMP_GRESIL = 3;     // <= : neige fondue (sinon grêle)
  const TEMP_ORAGE = 20;     // >= : ouragan ou tornade (sinon cyclone)
  const VAGUE = 5;           // écart d'une vague de chaleur / de froid, en °C

  // ===================== DONNÉES =====================
  const MOIS = [
    { id: 'abadius',   nom: 'Abadius',   base: -10 },
    { id: 'calistril', nom: 'Calistril', base: -5 },
    { id: 'pharast',   nom: 'Pharast',   base: 0 },
    { id: 'gozran',    nom: 'Gozran',    base: 5 },
    { id: 'desnus',    nom: 'Desnus',    base: 10 },
    { id: 'sarenith',  nom: 'Sarénith',  base: 10 },
    { id: 'erastus',   nom: 'Erastus',   base: 15 },
    { id: 'arodus',    nom: 'Arodus',    base: 15 },
    { id: 'rova',      nom: 'Rova',      base: 10 },
    { id: 'lamashan',  nom: 'Lamashan',  base: 5 },
    { id: 'neth',      nom: 'Neth',      base: 0 },
    { id: 'kuthona',   nom: 'Kuthona',   base: -5 }
  ];

  // profil : froid (très froid, froid), tempere (tempéré, chaud), desert (très chaud)
  // de10 : l'écart de température est « d10 + decalage » ; sinon il vaut 0
  const REGIONS = [
    { id: 'tresfroid', nom: 'Très froid', profil: 'froid',   de10: true,  decalage: -10 },
    { id: 'froid',     nom: 'Froid',      profil: 'froid',   de10: true,  decalage: -5 },
    { id: 'tempere',   nom: 'Tempéré',    profil: 'tempere', de10: false, decalage: 0 },
    { id: 'chaud',     nom: 'Chaud',      profil: 'tempere', de10: true,  decalage: 5 },
    { id: 'treschaud', nom: 'Très chaud', profil: 'desert',  de10: true,  decalage: 10 }
  ];

  // ===================== LOGIQUE PURE =====================
  function rngParDefaut(faces) { return Math.floor(Math.random() * faces) + 1; }

  const parId = (liste, id) => liste.find((x) => x.id === id) || null;
  const trouverMois = (id) => parId(MOIS, id);
  const trouverRegion = (id) => parId(REGIONS, id);

  const nb = (n, mot) => n + ' ' + mot + (n > 1 ? 's' : '');

  // minuscules, sans accents
  function normaliser(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function limiterJours(jours) {
    const n = Math.floor(Number(jours));
    if (!isFinite(n) || n < 1) return 1;
    return Math.min(MAX_JOURS, n);
  }

  // « froid abadius 5 », « très froid Sarénith », « 3 tresfroid neth »... dans n'importe quel ordre
  function analyserArguments(texte) {
    const brut = normaliser(texte);
    const nombre = brut.match(/\d+/);
    const lettres = brut.replace(/[^a-z]/g, '');
    // les noms les plus longs d'abord : « treschaud » contient « chaud »
    const region = REGIONS.slice().sort((a, b) => b.id.length - a.id.length)
      .find((r) => lettres.indexOf(r.id) !== -1);
    const mois = MOIS.find((m) => lettres.indexOf(m.id) !== -1);
    return {
      region: region ? region.id : null,
      mois: mois ? mois.id : null,
      jours: limiterJours(nombre ? parseInt(nombre[0], 10) : 1)
    };
  }

  function ventDesert(rng) {
    return { cat: 'vent', fort: rng(2) === 2 };
  }

  // jet : d100 du jour. Ne tire que les dés qui changent la température ou la nature de l'évènement.
  function tirerEvenement(profil, jet, rng, precedent) {
    if (jet <= 70) return { cat: 'calme' };
    if (jet <= 80) {
      if (profil === 'desert') return ventDesert(rng);
      let sens;
      if (precedent && precedent.cat === 'vague') {
        sens = precedent.sens;                       // une vague se prolonge dans le même sens
      } else {
        const seuilChaleur = profil === 'froid' ? 30 : 50;
        sens = rng(100) <= seuilChaleur ? 1 : -1;
      }
      return { cat: 'vague', sens: sens };
    }
    if (jet <= 90) return profil === 'desert' ? ventDesert(rng) : { cat: 'precipitation' };
    if (jet <= 99) return { cat: 'tempete' };
    return profil === 'desert' ? { cat: 'trombes' } : { cat: 'violente' };
  }

  function decrirePrecipitation(tj, rng) {
    const jet = rng(100);
    if (jet <= 30) return 'Brouillard pendant ' + nb(rng(4) + rng(4), 'heure') + '.';
    if (jet <= 90) {
      return (tj <= TEMP_GEL ? 'Neige' : 'Pluie') + ' pendant ' + nb(rng(4) + rng(4), 'heure') + '.';
    }
    return (tj <= TEMP_GRESIL ? 'Neige fondue' : 'Grêle') + ' pendant ' + nb(rng(20), 'minute') + '.';
  }

  function decrireViolente(tj, rng) {
    const vents = 'les vents dépassent 80 km/h (voir la section sur les vents)';
    if (tj <= TEMP_GEL) {
      const neige = rng(3) * 10;
      const jours = rng(3);
      return 'Violente tempête (blizzard) : ' + vents + ', avec d’importantes chutes de neige (' + neige +
        ' cm). Le blizzard persiste pendant ' + nb(jours, 'jour') + '.';
    }
    if (tj < TEMP_ORAGE) {
      return 'Violente tempête (cyclone) : ' + vents + '. Le cyclone persiste pendant ' +
        nb(rng(6), 'heure') + '.';
    }
    if (rng(2) === 1) {
      return 'Violente tempête (ouragan) : ' + vents + ', avec des trombes d’eau (voir « Précipitations »). ' +
        'Un ouragan peut parfois durer jusqu’à une semaine, mais il aura principalement de l’impact sur les ' +
        'personnages de vingt-quatre à quarante-huit heures, le temps que sa partie centrale traverse la région ' +
        'où se trouve le groupe.';
    }
    return 'Violente tempête (tornade) : ' + vents + '. Sa durée de vie est extrêmement réduite : ' +
      nb(rng(6) * 10, 'minute') + '. Généralement, elle se forme dans le cadre d’un orage. ' +
      'Voir les sections sur les tempêtes et sur les vents.';
  }

  // Texte de l'évènement. tj : température du jour, vague comprise.
  function decrireEvenement(evt, profil, tj, rng) {
    switch (evt.cat) {
      case 'calme':
        return 'Rien de particulier, temps calme.';
      case 'vague':
        return evt.sens > 0 ? 'Vague de chaleur (+' + VAGUE + ' °C).' : 'Vague de froid (-' + VAGUE + ' °C).';
      case 'vent':
        return 'Venteux : vent ' + (evt.fort ? 'important (30 à 50 km/h).' : 'moyen (15 à 30 km/h).');
      case 'precipitation':
        return decrirePrecipitation(tj, rng);
      case 'tempete': {
        const genre = profil === 'desert' ? ' de sable' : (tj <= TEMP_GEL ? ' de neige' : '');
        return 'Tempête' + genre + ' : les vents sont violents (50 à 80 km/h) et la visibilité diminuée de 75 %. ' +
          'Une tempête sévit pendant ' + nb(rng(4) + rng(4) - 1, 'heure') + '.';
      }
      case 'trombes':
        return 'Trombes d’eau : semblables à la pluie (voir « Précipitations »), mais leur violence est telle ' +
          'qu’elles limitent le champ de vision comme le brouillard. Elles peuvent provoquer des inondations ' +
          '(voir Milieu aquatique). Les trombes d’eau durent pendant ' + nb(rng(4) + rng(4), 'heure') + '.';
      case 'violente':
        return decrireViolente(tj, rng);
      default:
        return 'Évènement inconnu : ' + evt.cat;
    }
  }

  const formaterTemperatures = (tj, tn) => 'Température : ' + tj + ' °C, la nuit : ' + tn + ' °C.';

  // ctx : { profil, base, ecart }. precedent : le résultat de la veille (ou null).
  // Ordre des tirages : aléa du jour (2 d4), d100 (+ un second d100 si la veille était agitée),
  // dés propres à l'évènement, d10 de la nuit, dés du texte.
  function genererJour(numero, ctx, rng, precedent) {
    const aleaJour = rng(4) + rng(4) - 5;
    let jet = rng(100);
    if (precedent && precedent.agite) jet = Math.max(jet, rng(100));
    const evt = tirerEvenement(ctx.profil, jet, rng, precedent);
    const delta = evt.cat === 'vague' ? VAGUE * evt.sens : 0;
    const tj = ctx.base + ctx.ecart + aleaJour + delta;
    const tn = tj - rng(10);                          // calculée après la vague : elle la subit aussi
    return {
      jour: numero,
      jet: jet,
      cat: evt.cat,
      sens: evt.sens,
      agite: jet > 70,
      temperatureJour: tj,
      temperatureNuit: tn,
      ligne1: decrireEvenement(evt, ctx.profil, tj, rng),
      ligne2: formaterTemperatures(tj, tn)
    };
  }

  function genererMeteo(regionId, moisId, jours, rng) {
    const r = rng || rngParDefaut;
    const region = trouverRegion(regionId);
    const mois = trouverMois(moisId);
    if (!region) throw new Error('Région inconnue : ' + regionId);
    if (!mois) throw new Error('Mois inconnu : ' + moisId);
    const ecart = region.de10 ? r(10) + region.decalage : 0;   // tiré une seule fois pour la série
    const ctx = { profil: region.profil, base: mois.base, ecart: ecart };
    const liste = [];
    let precedent = null;
    for (let i = 1; i <= limiterJours(jours); i++) {
      precedent = genererJour(i, ctx, r, precedent);
      liste.push(precedent);
    }
    return { region: region, mois: mois, ecart: ecart, jours: liste };
  }

  // ===================== MESSAGES (texte prêt pour sendChat) =====================
  // Dans une carte pf_generic : jamais de « = » ni de « }} » dans le texte d'une ligne.
  const CARTE = '/w gm &{template:pf_generic} ';
  const MOIS_CHOIX = MOIS.map((m) => m.nom).join('|');

  function carteRegions() {
    return CARTE + '{{name=Climat - Niveau de chaleur}} ' +
      REGIONS.map((r) => '{{ [' + r.nom + '](!region ' + r.id + ')}}').join(' ');
  }

  function carteMois(regionId) {
    const region = trouverRegion(regionId);
    return CARTE + '{{name=Mois - ' + region.nom + '}} ' +
      '{{ ' + MOIS.map((m) => '[' + m.nom + '](!RollClimat ' + region.id + ' ' + m.id + ')').join('   ') + '}} ' +
      '{{ [Plusieurs jours](!RollClimat ' + region.id + ' ?{Mois|' + MOIS_CHOIX + '} ?{Jours|7})}}';
  }

  function carteResultat(meteo) {
    const n = meteo.jours.length;
    const titre = 'Climat - ' + meteo.region.nom + ' - ' + meteo.mois.nom + (n > 1 ? ' - ' + nb(n, 'jour') : '');
    const lignes = n === 1
      ? [meteo.jours[0].ligne1, meteo.jours[0].ligne2]
      : meteo.jours.map((j) => 'Jour ' + j.jour + ' : ' + j.ligne1 + ' ' + j.ligne2);
    return CARTE + '{{name=' + titre + '}} ' + lignes.map((l) => '{{ ' + l + '}}').join(' ');
  }

  const erreur = (texte) => '/w gm Climat : ' + texte;

  // Renvoie la liste des messages à chuchoter au MJ, ou null si la commande n'est pas la nôtre.
  function traiterCommande(commande, reste, rng) {
    const cmd = String(commande || '').toLowerCase();
    if (cmd === '!climat') return [carteRegions()];
    if (cmd !== '!region' && cmd !== '!rollclimat') return null;

    const a = analyserArguments(reste);
    if (!a.region) return [erreur('niveau de chaleur inconnu ou absent.'), carteRegions()];
    if (cmd === '!region') return [carteMois(a.region)];
    if (!a.mois) return [erreur('mois inconnu ou absent.'), carteMois(a.region)];
    return [carteResultat(genererMeteo(a.region, a.mois, a.jours, rng))];
  }

  if (typeof module !== 'undefined') {
    module.exports = {
      MAX_JOURS, MOIS, REGIONS, normaliser, analyserArguments, tirerEvenement, decrireEvenement,
      genererJour, genererMeteo, carteRegions, carteMois, carteResultat, traiterCommande
    };
  }
  if (typeof on !== 'function') return; // hors Roll20 : on s'arrête ici

  // ===================== PARTIE ROLL20 =====================
  on('chat:message', function (msg) {
    if (msg.type !== 'api') return;
    const contenu = String(msg.content || '').trim();
    const coupe = contenu.search(/\s/);
    const commande = coupe === -1 ? contenu : contenu.slice(0, coupe);
    const reste = coupe === -1 ? '' : contenu.slice(coupe + 1);
    const messages = traiterCommande(commande, reste, randomInteger);
    if (!messages) return;
    messages.forEach(function (m) { sendChat(msg.who, m); });
  });
})();
