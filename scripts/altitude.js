/*
 * altitude.js — Flying combat (Pathfinder 1e) for the Roll20 API
 * Version 1.5 — falling with boots of the cat (cat: 1 damage per die);
 * v1.5 — fall message whispered;
 * v1.4 — menu in meters, no more "unknown fly speed" message;
 * v1.3 — "Rejoindre": only the movement needed to reach the target
 *               (no more reach or 3D distance calculation);
 * v1.2 — negative altitudes (level 0 of your choice, e.g. top of a cliff),
 *               falling to ground at another altitude (to=);
 * v1.1 — label to the right of the token (no longer under the nameplate),
 *               bigger, !alt style; v1.0 — with gabarit.js v1.5, templates take altitude into account
 *
 * The map is 2D: this script keeps each token's ALTITUDE, shows it
 * next to the token, and does the flight calculations for the players.
 *
 * RULES APPLIED
 *   - Fly skill (Core p. 96): you ascend at half speed at 45° at most, you
 *     descend at normal speed at any angle. Ascending steeper
 *     than 45°: Fly check DC 20. Moving less than half your
 *     speed: DC 10 (hovering: DC 15), otherwise you fall.
 *   - Paizo FAQ "Fly" (July 2011): no diagonal counting on the
 *     vertical; ascending is handled only by the half speed.
 *     So, with H squares horizontally and V squares of height:
 *       ascend     : each square of ascent costs 2 squares, the rest 1
 *                    -> cost = V + max(H, V)   (3 squares at 45° = 6 squares)
 *       descend    : cost = max(H, V)
 *   - Falling: 1d6 per 10 ft (3 m), 20d6 at most. A creature
 *     that can fly negates the damage with a DC 10 Fly check, unless it
 *     falls because of a failed Fly check or a collision.
 *   - Reaching a target: the gap is counted in squares on each axis (on the
 *     ground with the diagonal rule); a token covers as many squares in
 *     height as in width. In contact = at most one square of gap on each
 *     axis. Reach is not calculated.
 *
 * UNITS
 *   A distance is given in feet (30, 30ft), meters (9m) or squares
 *   (6sq). A bare number is in the page unit (the one of the Measure
 *   tool). Everything is converted to SQUARES (5 ft = 1.5 m = 1 square).
 *
 * SETUP: create the "Vol" macro (visible to all, in the macro
 * bar) with the content of macro/Vol.macro.txt:   !alt
 * It shows a button menu; each button acts on the token
 * selected at the time of the click.
 *
 * COMMANDS (options in English; act on the selected tokens, or
 * on the given ids)
 *   !alt                          button menu
 *   !alt set [id...] <altitude>   30 / 9m / 6sq (absolute altitude),
 *                                 +10 / -3m (change), =-9m (negative
 *                                 absolute: below level 0, for example
 *                                 at the foot of a cliff taken as 0)
 *   !alt fly [id] <horizontal> <vertical> [speed=60]
 *                                 cost of a flying move BEFORE moving
 *                                 (vertical: + ascends, - descends)
 *   !alt dist <id> <target id>    gap between two tokens and flying movement
 *                                 to reach the target
 *   !alt fall [id...] [to=-9m] [cat]
 *                                 fall to the ground (altitude 0, or to=):
 *                                 damage roll; cat = boots of the cat
 *                                 (1 damage per die)
 *   !alt show                     list of the page's altitudes (whispered)
 *   !alt clear all                GM: resets all altitudes to 0
 *   !alt style color=#ff3300 size=26
 *                                 GM: color and size of the labels
 *
 * A player only acts on the tokens they control; the GM on all.
 * Fly speed read from the Pathfinder Community sheet (speed-fly, in meters
 * if the sheet is in meters); speed=60 overrides it (Fly spell, for example).
 */
(() => {
  'use strict';

  // ===================== PURE LOGIC =====================

  // text -> { cases, relatif, signe, valeur }; unite = default unit ('ft' or 'm')
  // "+10" / "-10": change; "10": value; "=-10": negative value
  function lireDistance(txt, unite = 'ft') {
    const m = String(txt || '').trim().toLowerCase()
      .match(/^(=?)\s*([+-]?)\s*(\d+(?:[.,]\d+)?)\s*(sq|squares?|cases?|ft|feet|m)?$/);
    if (!m) return null;
    const n = parseFloat(m[3].replace(',', '.'));
    const u = m[4] || unite;
    let cases;
    if (/^(sq|square|squares|case|cases)$/.test(u)) cases = n;
    else if (u === 'm') cases = n / 1.5;
    else cases = n / 5;
    cases = Math.round(cases);
    const signe = m[2] === '-' ? -1 : 1;
    return { cases, relatif: m[2] !== '' && m[1] !== '=', signe, valeur: signe * cases || 0 };
  }

  // PF1 distance on 2 axes, in squares: every second diagonal counts double
  const dist2 = (a, b) => {
    a = Math.abs(a); b = Math.abs(b);
    return Math.max(a, b) + Math.floor(Math.min(a, b) / 2);
  };

  // gap in squares between two square intervals [a0, a1] and [b0, b1] (inclusive)
  const ecart = (a0, a1, b0, b1) => (a1 < b0 ? b0 - a1 : b1 < a0 ? a0 - b1 : 0);

  // cost in squares of a flight of h squares horizontally and v squares of height
  // (v > 0 ascends, v < 0 descends)
  function coutVol(h, v) {
    h = Math.abs(h);
    if (v > 0) return v + Math.max(h, v);
    return Math.max(h, -v);
  }

  // maximum horizontal distance for an altitude change v with s squares
  // of movement; -1 if the altitude change alone costs too much
  function horizontalMax(v, s) {
    if (v > 0) return 2 * v > s ? -1 : s - v;
    return -v > s ? -1 : s;
  }

  // flight analysis: cost, Fly checks, remaining movement
  function analyseVol(h, v, vitesse) {
    h = Math.abs(h);
    const cout = coutVol(h, v);
    const r = { h, v, cout, tests: [] };
    if (v > 0 && v > h) r.tests.push({ dd: 20, raison: 'montée à plus de 45°' });
    if (vitesse > 0) {
      r.vitesse = vitesse;
      r.reste = vitesse - cout;
      r.resteDouble = 2 * vitesse - cout;
      r.hMax = horizontalMax(v, vitesse);
      r.hMaxDouble = horizontalMax(v, 2 * vitesse);
      if (cout === 0) r.tests.push({ dd: 15, raison: 'rester sur place' });
      else if (cout * 2 < vitesse) r.tests.push({ dd: 10, raison: 'moins de la moitié de sa vitesse' });
    }
    return r;
  }

  // damage dice of a fall of n squares: 1d6 per 10 ft, 20d6 at most
  const desChute = (cases) => Math.min(20, Math.floor((cases * 5) / 10));

  // shows a number of squares in the page unit
  function enUnite(cases, unite) {
    if (unite === 'm') { const m = cases * 1.5; return (m % 1 ? m.toFixed(1).replace('.', ',') : String(m)) + ' m'; }
    return cases * 5 + ' ft';
  }

  if (typeof module !== 'undefined') {
    module.exports = { lireDistance, dist2, ecart, coutVol, horizontalMax, analyseVol, desChute, enUnite };
  }
  if (typeof on !== 'function') return; // outside Roll20: stop here

  // ===================== ROLL20 PART =====================

  state.Altitude = state.Altitude || {};
  state.Altitude.alt = state.Altitude.alt || {};       // token -> altitude in squares
  state.Altitude.labels = state.Altitude.labels || {}; // token -> displayed text

  const PX = 70;
  const COULEUR = '#ff3300';
  const NOM = 'Altitude';

  const pageDe = (t) => getObj('page', t.get('_pageid'));
  const unitePage = (page) => (page && /^m/i.test(page.get('scale_units') || '') ? 'm' : 'ft');
  const casePx = (page) => PX * (parseFloat(page && page.get('snapping_increment')) || 1);
  const altDe = (t) => state.Altitude.alt[t.id] || 0;
  const altTexte = (a, u) => (a < 0 ? '-' : '') + enUnite(Math.abs(a), u);
  const nomDe = (t) => t.get('name') || 'token';
  const chuchoter = (qui, texte) => sendChat(NOM, `/w "${qui}" ${texte}`);

  function controle(t, playerid) {
    if (playerid === 'API' || playerIsGM(playerid)) return true; // API: gabarit.js (Viseur)
    const ok = (s) => String(s || '').split(',').some((x) => x === 'all' || x === playerid);
    if (ok(t.get('controlledby'))) return true;
    const c = t.get('represents') && getObj('character', t.get('represents'));
    return !!(c && ok(c.get('controlledby')));
  }

  // ---------- label next to the token ----------
  // font sizes Roll20 accepts for a text
  const TAILLES = [12, 14, 16, 18, 20, 22, 26, 32, 40, 56];
  const style = () => Object.assign({ couleur: COULEUR, taille: 26 }, state.Altitude.style || {});

  // label to the RIGHT of the token, at the height of its bar: under the token, it
  // would be hidden by the nameplate
  function placeEtiquette(t) {
    const id = state.Altitude.labels[t.id];
    let txt = id && getObj('text', id);
    const a = altDe(t);
    if (!a) {
      if (txt) txt.remove();
      delete state.Altitude.labels[t.id];
      return;
    }
    const st = style();
    const texte = (a > 0 ? '↑ ' : '↓ ') + enUnite(Math.abs(a), unitePage(pageDe(t)));
    const largeur = texte.length * st.taille * 0.6; // estimate: the text is centered on left
    const props = {
      text: texte,
      left: t.get('left') + t.get('width') / 2 + 4 + largeur / 2,
      top: t.get('top') - t.get('height') / 2 + st.taille / 2,
      layer: t.get('layer'),
      font_size: st.taille, font_family: 'Contrail One', color: st.couleur
    };
    if (txt) { txt.set(props); return; }
    txt = createObj('text', Object.assign({ pageid: t.get('_pageid') }, props));
    if (txt) state.Altitude.labels[t.id] = txt.id;
  }

  function fixerAltitude(t, cases) {
    const a = Math.round(cases) || 0; // negative: below the reference level (0)
    if (a) state.Altitude.alt[t.id] = a; else delete state.Altitude.alt[t.id];
    placeEtiquette(t);
    return a;
  }

  // gabarit.js recomputes the affected areas in 3D when an altitude changes
  function signalerGabarit(toks) {
    if (!state.gabarit) return;
    [...new Set(toks.map((t) => t.get('_pageid')))].forEach((p) => sendChat(NOM, `!gabarit refresh ${p}`));
  }

  // fly speed (in squares) read from the sheet, 0 if unknown
  function vitesseVol(t) {
    const cid = t.get('represents');
    if (!cid) return 0;
    const v = parseFloat(getAttrByName(cid, 'speed-fly')) || 0;
    if (v <= 0) return 0;
    const metres = String(getAttrByName(cid, 'use_metrics') || '') === '1';
    return Math.round(metres ? v / 1.5 : v / 5);
  }
  const manoeuvrabilite = (t) => {
    const cid = t.get('represents');
    return (cid && String(getAttrByName(cid, 'speed-fly-maneuverability') || '').trim()) || '';
  };

  // squares covered by a token: [i0, i1], [j0, j1] and [k0, k1] in height
  function volume(t) {
    const cp = casePx(pageDe(t));
    const nx = Math.max(1, Math.round(t.get('width') / cp));
    const ny = Math.max(1, Math.round(t.get('height') / cp));
    const i0 = Math.round((t.get('left') - (nx * cp) / 2) / cp);
    const j0 = Math.round((t.get('top') - (ny * cp) / 2) / cp);
    const k0 = altDe(t);
    return { i: [i0, i0 + nx - 1], j: [j0, j0 + ny - 1], k: [k0, k0 + Math.max(nx, ny) - 1] };
  }

  // ---------- commands ----------
  const IDS = /^-[\w-]{10,}$/;

  function tokensDuMessage(msg, args) {
    const ids = args.filter((a) => IDS.test(a));
    const src = ids.length ? ids : (msg.selected || []).filter((s) => s._type === 'graphic').map((s) => s._id);
    return src.map((id) => getObj('graphic', id)).filter(Boolean);
  }

  function ligneVol(r, u) {
    const f = (c) => `<b>${enUnite(c, u)}</b>`;
    const sens = r.v > 0 ? `monter de ${enUnite(r.v, u)}` : r.v < 0 ? `descendre de ${enUnite(-r.v, u)}` : 'altitude inchangée';
    let s = `${enUnite(r.h, u)} à l'horizontale, ${sens} : coût ${f(r.cout)}`;
    if (r.vitesse) {
      s += `<br>Vitesse de vol ${enUnite(r.vitesse, u)} : `;
      s += r.reste >= 0 ? `reste ${enUnite(r.reste, u)} (action de mouvement)`
        : r.resteDouble >= 0 ? `possible en double mouvement (reste ${enUnite(r.resteDouble, u)})`
          : 'trop loin pour un tour';
      if (r.v !== 0) {
        const hm = r.hMax >= 0 ? `jusqu'à ${enUnite(r.hMax, u)}` : 'impossible';
        const hm2 = r.hMaxDouble >= 0 ? `${enUnite(r.hMaxDouble, u)}` : 'impossible';
        s += `<br>Avec ce changement d'altitude, distance horizontale max : ${hm} (double mouvement : ${hm2})`;
      }
    }
    r.tests.forEach((x) => { s += `<br>⚠ Test de Vol DD ${x.dd} (${x.raison})`; });
    return s;
  }

  on('chat:message', (msg) => {
    if (msg.type !== 'api' || !/^!alt\b/i.test(msg.content)) return;
    const qui = msg.who.replace(/ \(GM\)$/, '');
    const args = msg.content.trim().split(/\s+/).slice(1);
    const cmd = (args[0] || '').toLowerCase();
    const reste = args.slice(1);
    const estMJ = playerIsGM(msg.playerid);
    const toks = tokensDuMessage(msg, reste);
    const permis = toks.filter((t) => controle(t, msg.playerid));
    const unite = unitePage(toks[0] ? pageDe(toks[0]) : getObj('page', Campaign().get('playerpageid')));

    if (cmd === 'set') {
      const d = lireDistance(reste.filter((a) => !IDS.test(a))[0], unite);
      if (!d) { chuchoter(qui, 'Usage : !alt set &lt;altitude&gt; (30, 9m, 6sq, +10, -3m, 0)'); return; }
      if (!permis.length) { chuchoter(qui, 'Sélectionne un token que tu contrôles.'); return; }
      const lignes = permis.map((t) => {
        const a = fixerAltitude(t, d.relatif ? altDe(t) + d.valeur : d.valeur);
        return `${nomDe(t)} : ${altTexte(a, unite)}`;
      });
      signalerGabarit(permis);
      if (msg.playerid !== 'API') chuchoter(qui, lignes.join('<br>'));
      return;
    }

    if (cmd === 'fly') {
      const vals = reste.filter((a) => !IDS.test(a) && !/=/.test(a));
      const h = lireDistance(vals[0], unite);
      const v = lireDistance(vals[1] || '0', unite);
      if (!h || !v) { chuchoter(qui, 'Usage : !alt fly &lt;horizontal&gt; &lt;vertical (+ monte, - descend)&gt; [speed=60]'); return; }
      const opt = reste.find((a) => /^speed=/i.test(a));
      const t = toks[0];
      let vitesse = opt ? (lireDistance(opt.split('=')[1], unite) || {}).cases || 0 : t ? vitesseVol(t) : 0;
      const r = analyseVol(h.cases, v.valeur, vitesse);
      let s = (t ? `<b>${nomDe(t)}</b>${manoeuvrabilite(t) ? ' (' + manoeuvrabilite(t) + ')' : ''}<br>` : '') + ligneVol(r, unite);
      if (t && permis.includes(t) && v.valeur !== 0) {
        const apres = altDe(t) + v.valeur;
        s += `<br>[Appliquer : altitude ${altTexte(apres, unite)}](!alt set ${t.id} =${apres}sq)`;
      }
      chuchoter(qui, s);
      return;
    }

    if (cmd === 'dist') {
      if (toks.length < 2) { chuchoter(qui, 'Usage : !alt dist &lt;id&gt; &lt;id cible&gt; (ou sélectionne 2 tokens)'); return; }
      const [a, b] = toks;
      const va = volume(a), vb = volume(b);
      const dx = ecart(va.i[0], va.i[1], vb.i[0], vb.i[1]);
      const dy = ecart(va.j[0], va.j[1], vb.j[0], vb.j[1]);
      const dz = ecart(va.k[0], va.k[1], vb.k[0], vb.k[1]);
      const hz = dist2(dx, dy);
      let s = `<b>${nomDe(a)}</b> → <b>${nomDe(b)}</b><br>`;
      s += `Écart : ${enUnite(hz, unite)} à l'horizontale, ${enUnite(dz, unite)} en hauteur`;
      if (hz <= 1 && dz <= 1) s += '<br><b>Déjà au contact</b>';
      else {
        // in contact: one square of gap remains on each axis
        const sens = altDe(b) >= altDe(a) ? 1 : -1;
        const r = analyseVol(Math.max(0, hz - 1), sens * Math.max(0, dz - 1), 0);
        s += `<br>Pour venir au contact en volant : <b>${enUnite(r.cout, unite)}</b> de mouvement`;
        r.tests.forEach((x) => { s += `<br>⚠ Test de Vol DD ${x.dd} (${x.raison})`; });
      }
      chuchoter(qui, s);
      return;
    }

    if (cmd === 'fall') {
      if (!permis.length) { chuchoter(qui, 'Sélectionne un token que tu contrôles.'); return; }
      // altitude of the ground you fall to (to=-9m below a cliff); 0 by default
      const opt = reste.find((a) => /^to=/i.test(a));
      const chat = reste.some((a) => /^cat$/i.test(a));
      const sol = opt ? lireDistance(opt.slice(3).replace(/^([+-])/, '=$1'), unite) : { valeur: 0 };
      if (!sol) { chuchoter(qui, 'Usage : !alt fall [to=-9m] (altitude du sol, 0 par défaut)'); return; }
      permis.forEach((t) => {
        const hauteur = altDe(t) - sol.valeur;
        if (hauteur <= 0) { chuchoter(qui, `${nomDe(t)} n'est pas au-dessus du sol (${altTexte(sol.valeur, unite)}).`); return; }
        const n = desChute(hauteur);
        fixerAltitude(t, sol.valeur);
        // Boots of the Cat: minimum damage (1 per die), lands on its feet
        const jet = !n ? 'aucun dégât (moins de 3 m / 10 ft)'
          : chat ? `<b>${n}</b> dégât${n > 1 ? 's' : ''} (bottes du chat : 1 par dé, retombe sur ses pieds)`
            : `[[${n}d6]] dégâts`;
         chuchoter(qui,` tombe de ${enUnite(hauteur, unite)} : ${jet}.`
          + `Une créature qui sait voler annule les dégâts avec un test de Vol DD 10 (sauf après un test de Vol raté ou une collision).`);
      });
      signalerGabarit(permis);
      return;
    }

    if (cmd === 'show') {
      const page = toks[0] ? toks[0].get('_pageid') : Campaign().get('playerpageid');
      const lignes = Object.keys(state.Altitude.alt).map((id) => getObj('graphic', id))
        .filter((t) => t && t.get('_pageid') === page && (estMJ || t.get('layer') !== 'gmlayer'))
        .map((t) => `${nomDe(t)} : ${altTexte(altDe(t), unite)}`);
      chuchoter(qui, lignes.length ? lignes.join('<br>') : 'Tout le monde est à l\'altitude 0.');
      return;
    }

    if (cmd === 'style') {
      if (!estMJ) { chuchoter(qui, 'Réservé au MJ.'); return; }
      const st = Object.assign({}, state.Altitude.style || {});
      reste.forEach((a) => {
        const m = a.match(/^(color|size)=(.+)$/i);
        if (!m) return;
        if (/^color$/i.test(m[1]) && /^#[0-9a-f]{6}$/i.test(m[2])) st.couleur = m[2];
        if (/^size$/i.test(m[1])) { const n = parseInt(m[2], 10); st.taille = TAILLES.reduce((x, y) => (Math.abs(y - n) < Math.abs(x - n) ? y : x)); }
      });
      state.Altitude.style = st;
      Object.keys(state.Altitude.alt).forEach((id) => { const t = getObj('graphic', id); if (t) placeEtiquette(t); });
      const s2 = style();
      chuchoter(qui, `Étiquettes : couleur ${s2.couleur}, taille ${s2.taille}. Usage : !alt style color=#ff3300 size=26`);
      return;
    }

    if (cmd === 'clear') {
      if (!estMJ) { chuchoter(qui, 'Réservé au MJ.'); return; }
      const ids = (reste[0] || '').toLowerCase() === 'all' ? Object.keys(state.Altitude.alt) : toks.map((t) => t.id);
      ids.forEach((id) => {
        const t = getObj('graphic', id);
        if (t) fixerAltitude(t, 0);
        else { delete state.Altitude.alt[id]; const l = getObj('text', state.Altitude.labels[id]); if (l) l.remove(); delete state.Altitude.labels[id]; }
      });
      if (state.gabarit) sendChat(NOM, '!gabarit refresh');
      chuchoter(qui, `${ids.length} altitude(s) remise(s) à 0.`);
      return;
    }

    chuchoter(qui, menu());
  });

  // button menu, distances in meters whatever the page unit;
  // the ?{...} and @{...} queries are encoded so they are only
  // evaluated on click, with the token selected at that moment
  function menu() {
    const q = (s) => s.replace(/\?/g, '&#63;').replace(/\|/g, '&#124;').replace(/@/g, '&#64;')
      .replace(/\(/g, '&#40;').replace(/\)/g, '&#41;');
    const b = (txt, cmd) => `[${txt}](${q(cmd)})`;
    return '<b>Vol</b> (sélectionne ton token)<br>'
      + b('Coût d\'un vol', '!alt fly ?{Distance horizontale en m (outil Mesurer)|0}m ?{Hauteur en m : + monte / - descend|0}m') + ' '
      + b('Altitude', '!alt set ?{Altitude en m : 9 / +3 / -3 (changement) / =-9 (sous le 0) / 0|+3}m') + ' '
      + b('Rejoindre', '!alt dist @{selected|token_id} @{target|Cible|token_id}') + ' '
      + b('Chute', '!alt fall to=?{Altitude du sol d\'arrivée en m|0}m ?{Bottes du chat|Non,no|Oui,cat}') + ' '
      + b('Liste', '!alt show');
  }

  // the label follows its token
  on('change:graphic', (obj, prev) => {
    if (!state.Altitude.alt[obj.id]) return;
    if (['left', 'top', 'height', 'layer'].every((k) => obj.get(k) === prev[k])) return;
    placeEtiquette(obj);
  });

  on('destroy:graphic', (obj) => {
    const l = state.Altitude.labels[obj.id] && getObj('text', state.Altitude.labels[obj.id]);
    if (l) l.remove();
    delete state.Altitude.labels[obj.id];
    delete state.Altitude.alt[obj.id];
  });

  on('ready', () => {
    // cleanup: altitudes of tokens that disappeared while the script was stopped
    Object.keys(state.Altitude.alt).forEach((id) => {
      const t = getObj('graphic', id);
      if (t) placeEtiquette(t);
      else {
        const l = getObj('text', state.Altitude.labels[id]);
        if (l) l.remove();
        delete state.Altitude.alt[id];
        delete state.Altitude.labels[id];
      }
    });
    log('altitude.js v1.5 loaded');
  });
})();
