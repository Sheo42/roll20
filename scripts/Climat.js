/*
 * Climat.js — météo aléatoire (Pathfinder 1e, calendrier de Golarion) pour l'API Roll20
 * Version 3.0 — la journée est découpée en 4 phases ; les phénomènes ont une heure de
 *               début, des prémices et peuvent déborder sur les jours suivants.
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
 *   ne retient rien entre deux appels.
 *   Prolongation : si un phénomène tiré (vague de chaleur ou de froid, vent du désert, blizzard,
 *     ouragan...) dépasse le dernier jour demandé, la période est allongée jusqu'à sa fin (5 jours
 *     au plus) ; la carte l'indique. Ces jours ajoutés n'ont ni d100 ni nouveau phénomène.
 *   Plusieurs jours : de 1 à 14, dans le même mois (pour un voyage à cheval sur deux
 *   mois, lancer le second mois à part).
 *
 * LA JOURNÉE EN 4 PHASES
 *   Matin (6-12 h) · Après-midi (12-18 h) · Soir (18-24 h) · Nuit (0-6 h)
 *   Chaque jour s'affiche sur une ligne : la température et l'état de chaque phase.
 *     Jour 2 - Matin (-9 °C) : calme · Après-midi (-6 °C) : prémices (ciel plombé,
 *     le vent forcit) · Soir (-9 °C) : blizzard · Nuit (-15 °C) : blizzard
 *   Quand un phénomène naît, une seconde ligne en donne les règles (vents, durée...).
 *
 * TEMPÉRATURE
 *   Jour (maximum, après-midi) = base du mois (-10 à 15 °C) + écart du niveau + aléa
 *     écart du niveau : très froid d10 - 10 · froid d10 - 5 · tempéré 0 · chaud d10 + 5
 *                       très chaud d10 + 10   (tiré UNE fois par série de jours)
 *     aléa du jour : 2d4 - 5, soit de -3 à +3 °C
 *   Nuit (minimum) = jour moins un d10. Une vague de chaleur / de froid ajoute / retire
 *   5 °C au jour ET à la nuit.
 *   Entre les deux : matin = nuit + 40 % de l'écart jour-nuit, soir = nuit + 60 %.
 *
 * ÉVÉNEMENT DU JOUR (d100)
 *    1 - 70   temps calme
 *   71 - 80   froid : vague de chaleur 30 % / de froid 70 %   tempéré : 50 % / 50 %
 *             désert : vent
 *             Une vague et le vent durent 3 jours (JOURS_VAGUE) : les jours 2 et 3 n'ont
 *             pas de nouveau tirage et la ligne du jour indique « jour 2 sur 3 ».
 *   81 - 90   froid et tempéré : brouillard 30 %, pluie ou neige 60 %,
 *             grêle ou neige fondue 10 %   désert : vent
 *   91 - 99   tempête de 1 à 7 h (2d4 - 1) : tempête de sable en désert, tempête de
 *             neige s'il gèle, sinon orage (foudre ; 10 % de tornade)
 *   100       froid et tempéré : violente tempête   désert : trombes d'eau (2d4 h)
 *   « Désert » = niveau « très chaud ». « Chaud » se traite comme « tempéré ».
 *   Durées (page « Climat » de Pathfinder-FR) : pluie, neige, neige fondue, brouillard
 *   2d4 h ; grêle d20 minutes puis 1d4 h de pluie ; cyclone d6 h ; blizzard d3 jours et
 *   1d3 x 30 cm de neige ; ouragan 24 ou 48 h d'impact ; tornade d6 x 10 minutes.
 *
 * PHÉNOMÈNES DANS LA JOURNÉE
 *   Un phénomène commence à une phase tirée au hasard (le brouillard : le matin ou le
 *   soir, une chance sur deux). S'il commence après le matin, la phase précédente
 *   affiche ses prémices. Sa durée en heures donne le nombre de phases
 *   qu'il occupe (6 h par phase) : un blizzard de 2 jours déborde donc sur le lendemain.
 *   Tant qu'un phénomène est en cours au lever, le jour n'a pas de nouveau tirage : le
 *   phénomène EST l'événement du jour, et la fin de journée est calme une fois fini.
 *   La neige ou la pluie d'une phase dépend de SA température : une pluie qui dure
 *   jusqu'au soir peut virer en neige.
 *   Type de violente tempête (selon le maximum du jour) : blizzard si <= 0 °C, cyclone de
 *   1 à 19 °C, ouragan ou tornade (1 chance sur 2) à partir de 20 °C. Grêle si > 3 °C,
 *   neige fondue sinon. Seuils : constantes TEMP_* ci-dessous.
 *
 * CONTINUITÉ ENTRE LES JOURS
 *   Après un jour agité (d100 > 70, ou phénomène en cours), le d100 du lendemain est tiré
 *   deux fois et on garde le plus haut : le mauvais temps tend à durer. Les jours d'une
 *   vague ou de vent ne comptent pas comme agités (ce sont des temps stables). Une vague
 *   qui suit une vague va dans le même sens.
 *
 * Le script est un seul fichier, sans dépendance. Les tirages passent par une
 * fonction « rng(faces) » : randomInteger dans Roll20, un faux dé dans les tests.
 */
(function () {
  'use strict';

  // ===================== RÉGLAGES =====================
  const JOURS_SUPPLEMENTAIRES = 5; // plafond de la prolongation automatique
  const MAX_JOURS = 14;      // plafond du mode multi-jours
  const TEMP_GEL = 0;        // <= : neige, blizzard, tempête de neige
  const TEMP_GRESIL = 3;     // <= : neige fondue (sinon grêle)
  const TEMP_ORAGE = 20;     // >= : ouragan ou tornade (sinon cyclone)
  const VAGUE = 5;           // écart d'une vague de chaleur / de froid, en °C
  const HEURES_PHASE = 6;    // durée d'une phase de la journée
  const JOURS_VAGUE = 3;     // durée d'une vague de chaleur / de froid et du vent du désert

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

  // fraction : part de l'écart nuit -> jour atteinte pendant la phase
  const PHASES = [
    { nom: 'Matin',      fraction: 0.4 },   //  6 - 12 h
    { nom: 'Après-midi', fraction: 1 },     // 12 - 18 h : maximum du jour
    { nom: 'Soir',       fraction: 0.6 },   // 18 - 24 h
    { nom: 'Nuit',       fraction: 0 }      //  0 -  6 h : minimum
  ];
  const NB_PHASES = PHASES.length;

  // signes avant-coureurs, affichés dans la phase qui précède le phénomène
  const PREMICES = {
    blizzard: 'ciel plombé, le vent forcit',
    cyclone: 'ciel qui s’assombrit, le vent monte',
    ouragan: 'ciel bas, air lourd, le vent monte',
    tornade: 'ciel verdâtre, air lourd, grand calme',
    tempeteneige: 'ciel qui se couvre, le vent se lève',
    orage: 'air lourd, gros nuages sombres',
    sable: 'horizon voilé de poussière, le vent se lève',
    trombes: 'ciel chargé de nuages noirs'
  };

  // évènements qui créent un phénomène posé dans la grille (les autres durent la journée)
  const CATS_PHENOMENE = ['precipitation', 'tempete', 'violente', 'trombes'];

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

  // Température de chaque phase (Matin, Après-midi, Soir, Nuit), entre la nuit tn et le jour tj.
  function temperaturesPhases(tj, tn) {
    return PHASES.map((p) => tn + Math.round(p.fraction * (tj - tn)));
  }

  // Un phénomène : type, durée en heures, nombre de phases occupées, texte de règles, prémices.
  function phenomene(type, heures, texte, extra) {
    return Object.assign({
      type: type,
      heures: heures,
      longueur: Math.max(1, Math.ceil(heures / HEURES_PHASE)),
      texte: texte,
      premices: PREMICES[type] || null
    }, extra || {});
  }

  // Tire la nature et la durée du phénomène. tj : maximum du jour (vague comprise).
  // Ordre des dés : voir chaque cas. La phase de départ est tirée à part (phaseDepart).
  function creerPhenomene(cat, profil, tj, rng) {
    switch (cat) {
      case 'precipitation': {
        const jet = rng(100);
        if (jet <= 30) {
          const h = rng(4) + rng(4);
          return phenomene('brouillard', h, 'Brouillard pendant ' + nb(h, 'heure') + '.');
        }
        if (jet <= 90) {
          const h = rng(4) + rng(4);
          return phenomene('precip', h, 'Précipitations pendant ' + nb(h, 'heure') +
            ' (neige quand il gèle, pluie sinon).');
        }
        if (tj <= TEMP_GRESIL) {
          const h = rng(4) + rng(4);
          return phenomene('fondue', h, 'Neige fondue pendant ' + nb(h, 'heure') + '.');
        }
        const minutes = rng(20);
        const h = rng(4);
        return phenomene('grele', h, 'Grêle pendant ' + nb(minutes, 'minute') + ', puis pluie pendant ' +
          nb(h, 'heure') + '.');
      }
      case 'tempete': {
        const h = rng(4) + rng(4) - 1;
        const vents = ' : les vents sont violents (50 à 80 km/h) et la visibilité diminuée de 75 %.';
        if (profil === 'desert') {
          return phenomene('sable', h, 'Tempête de sable' + vents + ' Elle dure ' + nb(h, 'heure') + '.');
        }
        if (tj <= TEMP_GEL) {
          return phenomene('tempeteneige', h, 'Tempête de neige' + vents + ' Elle dure ' + nb(h, 'heure') + '.');
        }
        let texte = 'Orage' + vents + ' Il dure ' + nb(h, 'heure') +
          '. Foudre : un impact par minute pendant la première heure.';
        let tornade = false;
        if (rng(10) === 1) {                                  // 10 % : l'orage tourne en tornade
          texte += ' L’orage vire à la tornade pendant ' + nb(rng(6) * 10, 'minute') + '.';
          tornade = true;
        }
        return phenomene('orage', h, texte, { tornade: tornade });
      }
      case 'violente': {
        const vents = 'les vents dépassent 80 km/h (voir la section sur les vents)';
        if (tj <= TEMP_GEL) {
          const neige = rng(3) * 30;
          const jours = rng(3);
          return phenomene('blizzard', jours * 24, 'Violente tempête (blizzard) : ' + vents +
            ', avec d’importantes chutes de neige (' + neige + ' cm au total). Le blizzard dure ' +
            nb(jours, 'jour') + '.');
        }
        if (tj < TEMP_ORAGE) {
          const h = rng(6);
          return phenomene('cyclone', h, 'Violente tempête (cyclone) : ' + vents + '. Le cyclone dure ' +
            nb(h, 'heure') + '.');
        }
        if (rng(2) === 1) {
          const h = rng(2) * 24;
          return phenomene('ouragan', h, 'Violente tempête (ouragan) : ' + vents +
            ', avec des trombes d’eau (voir « Précipitations »). Un ouragan peut parfois durer jusqu’à une ' +
            'semaine, mais il aura principalement de l’impact sur les personnages pendant ' + h +
            ' heures, le temps que sa partie centrale traverse la région où se trouve le groupe.');
        }
        const m = rng(6) * 10;
        return phenomene('tornade', m / 60, 'Violente tempête (tornade) : ' + vents +
          '. Sa durée de vie est extrêmement réduite : ' + nb(m, 'minute') + '. Généralement, elle se ' +
          'forme dans le cadre d’un orage. Voir les sections sur les tempêtes et sur les vents.');
      }
      case 'trombes': {
        const h = rng(4) + rng(4);
        return phenomene('trombes', h, 'Trombes d’eau : semblables à la pluie (voir « Précipitations »), ' +
          'mais leur violence est telle qu’elles limitent le champ de vision comme le brouillard. Elles ' +
          'peuvent provoquer des inondations (voir Milieu aquatique). Les trombes d’eau durent pendant ' +
          nb(h, 'heure') + '.');
      }
      default:
        throw new Error('Évènement sans phénomène : ' + cat);
    }
  }

  // Phase de départ (0 = matin ... 3 = nuit). Le brouillard se forme le matin ou le soir
  // (une chance sur deux) ; tout le reste peut arriver à n'importe quelle phase.
  function phaseDepart(ph, rng) {
    if (ph.type === 'brouillard') return rng(2) === 1 ? 0 : 2;
    return rng(NB_PHASES) - 1;
  }

  // Vague de chaleur / de froid et vent du désert : ils durent JOURS_VAGUE jours, sans phases.
  const estJournalier = (ph) => ph.type === 'vague' || ph.type === 'vent';

  // Nom du phénomène dans une phase, selon la température de CETTE phase.
  function etiquette(ph, temperature) {
    switch (ph.type) {
      case 'blizzard':
      case 'cyclone':
      case 'ouragan':
      case 'tornade': return ph.type;
      case 'tempeteneige': return 'tempête de neige';
      case 'sable': return 'tempête de sable';
      case 'orage': return ph.tornade ? 'orage et tornade' : 'orage';
      case 'trombes': return 'trombes d’eau';
      case 'vague':
      case 'vent': return 'calme';          // le jour est calme : la vague ou le vent figure en tête de ligne
      case 'brouillard': return 'brouillard';
      case 'precip': return temperature <= TEMP_GEL ? 'neige' : 'pluie';
      case 'fondue': return 'neige fondue';
      case 'grele': return 'grêle, puis pluie';
      default: return ph.type;
    }
  }

  // Pose un phénomène dans la grille (4 cases par jour), avec ses prémices si ce n'est pas le matin.
  function placer(grille, debut, ph) {
    ph.debut = debut;
    ph.fin = debut + ph.longueur - 1;
    // grille extensible (genererMeteo) : elle s'allonge pour contenir tout le phénomène, dans la limite fixée
    if (grille.limite) while (grille.length <= ph.fin && grille.length < grille.limite) grille.push(null);
    for (let c = debut; c <= ph.fin && c < grille.length; c++) grille[c] = { ph: ph, role: 'actif' };
    if (ph.premices && debut % NB_PHASES >= 1 && grille[debut - 1] === null) {
      grille[debut - 1] = { ph: ph, role: 'premices' };
    }
  }

  // Vague ou vent : sert de préfixe à la ligne de chacun de ses jours (températures déjà corrigées).
  function texteEvenementJour(evt, numero) {
    const base = evt.cat === 'vague'
      ? (evt.sens > 0 ? 'Vague de chaleur (+' + VAGUE + ' °C)' : 'Vague de froid (-' + VAGUE + ' °C)')
      : 'Venteux : vent ' + (evt.fort ? 'important (30 à 50 km/h)' : 'moyen (15 à 30 km/h)');
    return base + ', jour ' + numero + ' sur ' + JOURS_VAGUE;
  }

  // ctx : { profil, base, ecart }. precedent : le résultat de la veille (ou null).
  // grille : une case par phase de toute la série (null = calme) ; partagée entre les jours
  // pour que les phénomènes débordent. Sans grille, le jour est isolé.
  // Ordre des tirages : aléa du jour (2 d4) ; d100 (+ un second si la veille était agitée), sauf si
  // un phénomène, une vague ou un vent est en cours au lever ; dés de l'évènement (sens de la vague,
  // intensité du vent) ; d10 de la nuit ; si un phénomène naît : sa nature et sa durée (creerPhenomene),
  // puis sa phase de départ. Un jour « suite » (suite: true) n'a ni d100 ni nouveau phénomène.
  function genererJour(numero, ctx, rng, precedent, grille) {
    const g = grille || new Array(NB_PHASES).fill(null);
    const debutJour = (numero - 1) * NB_PHASES;
    const aleaJour = rng(4) + rng(4) - 5;
    const enCours = g[debutJour] && g[debutJour].role === 'actif' ? g[debutJour].ph : null;

    let jet = null;
    let evt;
    if (enCours) {
      // le phénomène (ou la vague, ou le vent) en cours est l'évènement du jour : pas de d100
      evt = { cat: enCours.cat, sens: enCours.sens, fort: enCours.fort };
    } else {
      jet = rng(100);
      if (precedent && precedent.agite) jet = Math.max(jet, rng(100));
      evt = tirerEvenement(ctx.profil, jet, rng, precedent);
    }
    const delta = evt.cat === 'vague' ? VAGUE * evt.sens : 0;
    const tj = ctx.base + ctx.ecart + aleaJour + delta;
    const tn = tj - rng(10);                   // calculée après la vague : elle la subit aussi
    const temps = temperaturesPhases(tj, tn);

    let description = '';
    let tag = '';
    if (evt.cat === 'vague' || evt.cat === 'vent') {
      let ph = enCours;
      if (!ph) {                                // elle commence au lever et dure JOURS_VAGUE jours
        ph = phenomene(evt.cat, JOURS_VAGUE * 24, '', { cat: evt.cat, sens: evt.sens, fort: evt.fort });
        placer(g, debutJour, ph);
      }
      tag = texteEvenementJour(evt, Math.floor((debutJour - ph.debut) / NB_PHASES) + 1);
    } else if (!enCours && CATS_PHENOMENE.indexOf(evt.cat) !== -1) {
      const ph = creerPhenomene(evt.cat, ctx.profil, tj, rng);
      ph.cat = evt.cat;
      placer(g, debutJour + phaseDepart(ph, rng), ph);
      description = ph.texte;
    }

    const phases = PHASES.map((p, i) => {
      const c = g[debutJour + i];
      let etat = 'calme';
      if (c && c.role === 'premices') {
        etat = 'prémices (' + c.ph.premices + ')';
      } else if (c && !estJournalier(c.ph)) {
        etat = etiquette(c.ph, temps[i]);
        if (debutJour + i === g.length - 1 && c.ph.fin > g.length - 1) etat += ' (se poursuit)';
      }
      return { nom: p.nom, temperature: temps[i], etat: etat };
    });

    // Une journée sans phénomène ne répète pas « calme » quatre fois.
    const tousCalmes = phases.every((p) => p.etat === 'calme');
    const detail = phases.map((p) => p.nom + ' (' + p.temperature + ' °C)' + (tousCalmes ? '' : ' : ' + p.etat)).join(' · ');
    const prefixe = tag || (tousCalmes ? 'Calme toute la journée' : '');

    return {
      jour: numero,
      jet: jet,
      cat: evt.cat,
      sens: evt.sens,
      suite: Boolean(enCours),
      // une vague ou un vent qui se prolonge ne rend pas le lendemain plus instable
      agite: enCours ? !estJournalier(enCours) : jet > 70,
      temperatureJour: tj,
      temperatureNuit: tn,
      phases: phases,
      tag: tag,
      description: description,
      ligne: prefixe ? prefixe + ' - ' + detail : detail
    };
  }

  function genererMeteo(regionId, moisId, jours, rng) {
    const r = rng || rngParDefaut;
    const region = trouverRegion(regionId);
    const mois = trouverMois(moisId);
    if (!region) throw new Error('Région inconnue : ' + regionId);
    if (!mois) throw new Error('Mois inconnu : ' + moisId);
    const n = limiterJours(jours);
    const ecart = region.de10 ? r(10) + region.decalage : 0;   // tiré une seule fois pour la série
    const ctx = { profil: region.profil, base: mois.base, ecart: ecart };
    const grille = new Array(n * NB_PHASES).fill(null);
    grille.limite = (n + JOURS_SUPPLEMENTAIRES) * NB_PHASES;
    const liste = [];
    let precedent = null;
    // La période est prolongée tant qu'un phénomène, une vague ou un vent tiré déborde sur le jour suivant.
    for (let i = 1; i <= n + JOURS_SUPPLEMENTAIRES; i++) {
      const c = grille[(i - 1) * NB_PHASES];
      if (i > n && !(c && c.role === 'actif')) break;
      precedent = genererJour(i, ctx, r, precedent, grille);
      liste.push(precedent);
    }
    return { region: region, mois: mois, ecart: ecart, demandes: n, jours: liste };
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
    const lignes = [];
    const ajoutes = n - (meteo.demandes || n);
    if (ajoutes > 0) lignes.push('Période prolongée de ' + nb(ajoutes, 'jour') + ' : un phénomène se poursuit.');
    meteo.jours.forEach((j) => {
      lignes.push((n > 1 ? 'Jour ' + j.jour + ' - ' : '') + j.ligne);
      if (j.description) lignes.push(j.description);
    });
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
      MAX_JOURS, PHASES, MOIS, REGIONS, normaliser, analyserArguments, tirerEvenement, temperaturesPhases,
      creerPhenomene, phaseDepart, etiquette, genererJour, genererMeteo, carteRegions, carteMois,
      carteResultat, traiterCommande
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
