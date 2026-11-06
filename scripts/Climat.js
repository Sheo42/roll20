/*
 * Climat.js — random weather (Pathfinder 1e, Golarion calendar) for the Roll20 API
 * Version 3.0 — the day is split into 4 phases; phenomena have a start time,
 *               warning signs, and can spill over into the following days.
 *
 * USAGE (GM)
 *   !climat                       5 heat-level buttons
 *   !region <level>               12 month buttons (Abadius to Kuthona)
 *   !RollClimat <level> <month> [days]
 *                                 weather, whispered to the GM. Examples:
 *                                   !RollClimat cold abadius
 *                                   !RollClimat verycold kuthona 7
 *   Levels (in English): verycold, cold, temperate, hot, veryhot (capitals
 *   and spaces accepted: "very cold"). The level is passed in the command:
 *   the script remembers nothing between two calls.
 *   Extension: if a rolled phenomenon (heat or cold wave, desert wind, blizzard,
 *     hurricane...) goes past the last requested day, the period is extended until it ends (5 days
 *     at most); the card says so. These added days have neither a d100 nor a new phenomenon.
 *   Several days: from 1 to 14, in the same month (for a journey spanning two
 *   months, roll the second month separately).
 *
 * THE DAY IN 4 PHASES
 *   Morning (6-12 h) · Afternoon (12-18 h) · Evening (18-24 h) · Night (0-6 h)
 *   Each day is shown on one line: the temperature and the state of each phase.
 *     Jour 2 - Matin (-9 °C) : calme · Après-midi (-6 °C) : prémices (ciel plombé,
 *     le vent forcit) · Soir (-9 °C) : blizzard · Nuit (-15 °C) : blizzard
 *   When a phenomenon starts, a second line gives its rules (winds, duration...).
 *
 * TEMPERATURE
 *   Day (maximum, afternoon) = month base (-10 to 15 °C) + level offset + daily random
 *     level offset: very cold d10 - 10 · cold d10 - 5 · temperate 0 · hot d10 + 5
 *                       very hot d10 + 10   (rolled ONCE per series of days)
 *     daily random: 2d4 - 5, i.e. from -3 to +3 °C
 *   Night (minimum) = day minus a d10. A heat / cold wave adds / removes
 *   5 °C to the day AND the night.
 *   In between: morning = night + 40% of the day-night gap, evening = night + 60%.
 *
 * EVENT OF THE DAY (d100)
 *    1 - 70   calm weather
 *   71 - 80   cold: heat wave 30% / cold wave 70%   temperate: 50% / 50%
 *             desert: wind
 *             A wave and the wind last 3 days (JOURS_VAGUE): days 2 and 3 have
 *             no new roll and the day's line says "jour 2 sur 3".
 *   81 - 90   cold and temperate: fog 30%, rain or snow 60%,
 *             hail or sleet 10%   desert: wind
 *   91 - 99   storm of 1 to 7 h (2d4 - 1): sandstorm in the desert, snowstorm
 *             if it freezes, otherwise thunderstorm (lightning; 10% tornado)
 *   100       cold and temperate: powerful storm   desert: downpour (2d4 h)
 *   "Desert" = level "very hot". "Hot" is treated as "temperate".
 *   Durations ("Climat" page on Pathfinder-FR): rain, snow, sleet, fog
 *   2d4 h; hail d20 minutes then 1d4 h of rain; cyclone d6 h; blizzard d3 days and
 *   1d3 x 30 cm of snow; hurricane 24 or 48 h of impact; tornado d6 x 10 minutes.
 *
 * PHENOMENA DURING THE DAY
 *   A phenomenon starts at a randomly rolled phase (fog: morning or
 *   evening, one chance in two). If it starts after the morning, the previous phase
 *   shows its warning signs. Its duration in hours gives the number of phases
 *   it covers (6 h per phase): a 2-day blizzard therefore spills over into the next day.
 *   While a phenomenon is still going at dawn, the day has no new roll: the
 *   phenomenon IS the event of the day, and the rest of the day is calm once it ends.
 *   Snow or rain in a phase depends on THAT phase's temperature: rain lasting
 *   until the evening can turn into snow.
 *   Type of powerful storm (by the day's maximum): blizzard if <= 0 °C, cyclone from
 *   1 to 19 °C, hurricane or tornado (1 chance in 2) from 20 °C. Hail if > 3 °C,
 *   sleet otherwise. Thresholds: TEMP_* constants below.
 *
 * CONTINUITY BETWEEN DAYS
 *   After a stormy day (d100 > 70, or phenomenon in progress), the next day's d100 is rolled
 *   twice and the highest is kept: bad weather tends to last. Days of a
 *   wave or wind do not count as stormy (they are stable weather). A wave
 *   following a wave goes in the same direction.
 *
 * The script is a single file, with no dependency. Rolls go through a
 * "rng(faces)" function: randomInteger in Roll20, a fake die in the tests.
 */
(function () {
  'use strict';

  // ===================== SETTINGS =====================
  const JOURS_SUPPLEMENTAIRES = 5; // cap of the automatic extension
  const MAX_JOURS = 14;      // cap of the multi-day mode
  const TEMP_GEL = 0;        // <= : snow, blizzard, snowstorm
  const TEMP_GRESIL = 3;     // <= : sleet (otherwise hail)
  const TEMP_ORAGE = 20;     // >= : hurricane or tornado (otherwise cyclone)
  const VAGUE = 5;           // offset of a heat / cold wave, in °C
  const HEURES_PHASE = 6;    // duration of a phase of the day
  const JOURS_VAGUE = 3;     // duration of a heat / cold wave and of the desert wind

  // ===================== DATA =====================
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

  // profile: froid (very cold, cold), tempere (temperate, hot), desert (very hot)
  // de10: the temperature offset is "d10 + decalage"; otherwise it is 0
  const REGIONS = [
    { id: 'verycold',  nom: 'Très froid', profil: 'froid',   de10: true,  decalage: -10 },
    { id: 'cold',      nom: 'Froid',      profil: 'froid',   de10: true,  decalage: -5 },
    { id: 'temperate', nom: 'Tempéré',    profil: 'tempere', de10: false, decalage: 0 },
    { id: 'hot',       nom: 'Chaud',      profil: 'tempere', de10: true,  decalage: 5 },
    { id: 'veryhot',   nom: 'Très chaud', profil: 'desert',  de10: true,  decalage: 10 }
  ];

  // fraction: share of the night -> day gap reached during the phase
  const PHASES = [
    { nom: 'Matin',      fraction: 0.4 },   //  6 - 12 h
    { nom: 'Après-midi', fraction: 1 },     // 12 - 18 h: maximum of the day
    { nom: 'Soir',       fraction: 0.6 },   // 18 - 24 h
    { nom: 'Nuit',       fraction: 0 }      //  0 -  6 h: minimum
  ];
  const NB_PHASES = PHASES.length;

  // warning signs, shown in the phase before the phenomenon
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

  // events that create a phenomenon placed in the grid (the others last the whole day)
  const CATS_PHENOMENE = ['precipitation', 'tempete', 'violente', 'trombes'];

  // ===================== PURE LOGIC =====================
  function rngParDefaut(faces) { return Math.floor(Math.random() * faces) + 1; }

  const parId = (liste, id) => liste.find((x) => x.id === id) || null;
  const trouverMois = (id) => parId(MOIS, id);
  const trouverRegion = (id) => parId(REGIONS, id);

  const nb = (n, mot) => n + ' ' + mot + (n > 1 ? 's' : '');

  // lower case, without accents
  function normaliser(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function limiterJours(jours) {
    const n = Math.floor(Number(jours));
    if (!isFinite(n) || n < 1) return 1;
    return Math.min(MAX_JOURS, n);
  }

  // "cold abadius 5", "very cold Sarénith", "3 verycold neth"... in any order
  function analyserArguments(texte) {
    const brut = normaliser(texte);
    const nombre = brut.match(/\d+/);
    const lettres = brut.replace(/[^a-z]/g, '');
    // longest names first: "veryhot" contains "hot"
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

  // jet: the day's d100. Only rolls the dice that change the temperature or the kind of event.
  function tirerEvenement(profil, jet, rng, precedent) {
    if (jet <= 70) return { cat: 'calme' };
    if (jet <= 80) {
      if (profil === 'desert') return ventDesert(rng);
      let sens;
      if (precedent && precedent.cat === 'vague') {
        sens = precedent.sens;                       // a wave carries on in the same direction
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

  // Temperature of each phase (Morning, Afternoon, Evening, Night), between night tn and day tj.
  function temperaturesPhases(tj, tn) {
    return PHASES.map((p) => tn + Math.round(p.fraction * (tj - tn)));
  }

  // A phenomenon: type, duration in hours, number of phases covered, rules text, warning signs.
  function phenomene(type, heures, texte, extra) {
    return Object.assign({
      type: type,
      heures: heures,
      longueur: Math.max(1, Math.ceil(heures / HEURES_PHASE)),
      texte: texte,
      premices: PREMICES[type] || null
    }, extra || {});
  }

  // Rolls the kind and duration of the phenomenon. tj: maximum of the day (wave included).
  // Dice order: see each case. The starting phase is rolled separately (phaseDepart).
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
        if (rng(10) === 1) {                                  // 10%: the thunderstorm turns into a tornado
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

  // Starting phase (0 = morning ... 3 = night). Fog forms in the morning or the evening
  // (one chance in two); everything else can happen in any phase.
  function phaseDepart(ph, rng) {
    if (ph.type === 'brouillard') return rng(2) === 1 ? 0 : 2;
    return rng(NB_PHASES) - 1;
  }

  // Heat / cold wave and desert wind: they last JOURS_VAGUE days, without phases.
  const estJournalier = (ph) => ph.type === 'vague' || ph.type === 'vent';

  // Name of the phenomenon in a phase, based on THAT phase's temperature.
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
      case 'vent': return 'calme';          // the day is calm: the wave or the wind shows at the start of the line
      case 'brouillard': return 'brouillard';
      case 'precip': return temperature <= TEMP_GEL ? 'neige' : 'pluie';
      case 'fondue': return 'neige fondue';
      case 'grele': return 'grêle, puis pluie';
      default: return ph.type;
    }
  }

  // Places a phenomenon in the grid (4 cells per day), with its warning signs if it is not the morning.
  function placer(grille, debut, ph) {
    ph.debut = debut;
    ph.fin = debut + ph.longueur - 1;
    // extensible grid (genererMeteo): it grows to hold the whole phenomenon, within the set limit
    if (grille.limite) while (grille.length <= ph.fin && grille.length < grille.limite) grille.push(null);
    for (let c = debut; c <= ph.fin && c < grille.length; c++) grille[c] = { ph: ph, role: 'actif' };
    if (ph.premices && debut % NB_PHASES >= 1 && grille[debut - 1] === null) {
      grille[debut - 1] = { ph: ph, role: 'premices' };
    }
  }

  // Wave or wind: used as a prefix for the line of each of its days (temperatures already adjusted).
  function texteEvenementJour(evt, numero) {
    const base = evt.cat === 'vague'
      ? (evt.sens > 0 ? 'Vague de chaleur (+' + VAGUE + ' °C)' : 'Vague de froid (-' + VAGUE + ' °C)')
      : 'Venteux : vent ' + (evt.fort ? 'important (30 à 50 km/h)' : 'moyen (15 à 30 km/h)');
    return base + ', jour ' + numero + ' sur ' + JOURS_VAGUE;
  }

  // ctx: { profil, base, ecart }. precedent: the previous day's result (or null).
  // grille: one cell per phase of the whole series (null = calm); shared between days
  // so that phenomena spill over. Without a grid, the day stands alone.
  // Roll order: daily random (2 d4); d100 (+ a second one if the previous day was stormy), unless
  // a phenomenon, a wave or a wind is in progress at dawn; event dice (direction of the wave,
  // wind strength); night d10; if a phenomenon starts: its kind and duration (creerPhenomene),
  // then its starting phase. A "suite" day (suite: true) has neither a d100 nor a new phenomenon.
  function genererJour(numero, ctx, rng, precedent, grille) {
    const g = grille || new Array(NB_PHASES).fill(null);
    const debutJour = (numero - 1) * NB_PHASES;
    const aleaJour = rng(4) + rng(4) - 5;
    const enCours = g[debutJour] && g[debutJour].role === 'actif' ? g[debutJour].ph : null;

    let jet = null;
    let evt;
    if (enCours) {
      // the phenomenon (or wave, or wind) in progress is the event of the day: no d100
      evt = { cat: enCours.cat, sens: enCours.sens, fort: enCours.fort };
    } else {
      jet = rng(100);
      if (precedent && precedent.agite) jet = Math.max(jet, rng(100));
      evt = tirerEvenement(ctx.profil, jet, rng, precedent);
    }
    const delta = evt.cat === 'vague' ? VAGUE * evt.sens : 0;
    const tj = ctx.base + ctx.ecart + aleaJour + delta;
    const tn = tj - rng(10);                   // computed after the wave: it is affected too
    const temps = temperaturesPhases(tj, tn);

    let description = '';
    let tag = '';
    if (evt.cat === 'vague' || evt.cat === 'vent') {
      let ph = enCours;
      if (!ph) {                                // it starts at dawn and lasts JOURS_VAGUE days
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

    // A day without a phenomenon does not repeat "calme" four times.
    const tousCalmes = phases.every((p) => p.etat === 'calme');
    const detail = phases.map((p) => p.nom + ' (' + p.temperature + ' °C)' + (tousCalmes ? '' : ' : ' + p.etat)).join(' · ');
    const prefixe = tag || (tousCalmes ? 'Calme toute la journée' : '');

    return {
      jour: numero,
      jet: jet,
      cat: evt.cat,
      sens: evt.sens,
      suite: Boolean(enCours),
      // a wave or a wind that carries on does not make the next day more unstable
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
    const ecart = region.de10 ? r(10) + region.decalage : 0;   // rolled only once for the series
    const ctx = { profil: region.profil, base: mois.base, ecart: ecart };
    const grille = new Array(n * NB_PHASES).fill(null);
    grille.limite = (n + JOURS_SUPPLEMENTAIRES) * NB_PHASES;
    const liste = [];
    let precedent = null;
    // The period is extended as long as a rolled phenomenon, wave or wind spills over into the next day.
    for (let i = 1; i <= n + JOURS_SUPPLEMENTAIRES; i++) {
      const c = grille[(i - 1) * NB_PHASES];
      if (i > n && !(c && c.role === 'actif')) break;
      precedent = genererJour(i, ctx, r, precedent, grille);
      liste.push(precedent);
    }
    return { region: region, mois: mois, ecart: ecart, demandes: n, jours: liste };
  }

  // ===================== MESSAGES (text ready for sendChat) =====================
  // In a pf_generic card: never "=" or "}}" in the text of a line.
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

  // Returns the list of messages to whisper to the GM, or null if the command is not ours.
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
  if (typeof on !== 'function') return; // outside Roll20: stop here

  // ===================== ROLL20 PART =====================
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
