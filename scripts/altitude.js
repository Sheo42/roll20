/*
 * altitude.js — Combat en vol (Pathfinder 1e) pour l'API Roll20
 * Version 1.5 — chute avec bottes du chat (cat : 1 dégât par dé) ;
 * v1.4 — menu en mètres, plus de message « vitesse de vol inconnue » ;
 * v1.3 — « Rejoindre » : seulement le mouvement pour venir au contact
 *               (plus de calcul d'allonge ni de distance 3D) ;
 * v1.2 — altitudes négatives (niveau 0 au choix, ex. haut d'une falaise),
 *               chute vers un sol à une autre altitude (to=) ;
 * v1.1 — étiquette à droite du token (plus sous la plaque du nom),
 *               plus grosse, !alt style ; v1.0 — avec gabarit.js v1.5, les gabarits tiennent compte de l'altitude
 *
 * La carte est en 2D : ce script garde l'ALTITUDE de chaque token, l'affiche
 * sous le token, et fait les calculs de vol à la place des joueurs.
 *
 * RÈGLES APPLIQUÉES
 *   - Compétence Vol (Core p. 96) : on monte à mi-vitesse à 45° maximum, on
 *     descend à vitesse normale sous n'importe quel angle. Monter plus raide
 *     que 45° : test de Vol DD 20. Se déplacer de moins de la moitié de sa
 *     vitesse : DD 10 (rester sur place : DD 15), sinon chute.
 *   - FAQ Paizo « Fly » (juillet 2011) : pas de décompte en diagonale sur la
 *     verticale ; la montée est gérée uniquement par la mi-vitesse.
 *     Donc, avec H cases à l'horizontale et V cases de hauteur :
 *       monter     : chaque case de montée coûte 2 cases, le reste 1
 *                    -> coût = V + max(H, V)   (3 cases à 45° = 6 cases)
 *       descendre  : coût = max(H, V)
 *   - Chute : 1d6 par tranche de 10 ft (3 m), 20d6 au maximum. Une créature
 *     qui sait voler annule les dégâts par un test de Vol DD 10, sauf si elle
 *     tombe à cause d'un test de Vol raté ou d'une collision.
 *   - Rejoindre une cible : l'écart se compte en cases sur chaque axe (au
 *     sol avec la règle des diagonales) ; un token occupe autant de cases en
 *     hauteur qu'en largeur. Au contact = au plus une case d'écart sur chaque
 *     axe. L'allonge n'est pas calculée.
 *
 * UNITÉS
 *   Une distance se donne en pieds (30, 30ft), en mètres (9m) ou en cases
 *   (6sq). Un nombre seul est dans l'unité de la page (celle de l'outil
 *   Mesurer). Tout est converti en CASES (5 ft = 1,5 m = 1 case).
 *
 * MISE EN PLACE : crée la macro « Vol » (visible par tous, dans la barre de
 * macros) avec le contenu de macro/Vol.macro.txt :   !alt
 * Elle affiche un menu de boutons ; chaque bouton agit sur le token
 * sélectionné au moment du clic.
 *
 * COMMANDES (options en anglais ; agissent sur les tokens sélectionnés, ou
 * sur les ids donnés)
 *   !alt                          menu de boutons
 *   !alt set [id...] <altitude>   30 / 9m / 6sq (altitude absolue),
 *                                 +10 / -3m (changement), =-9m (absolue
 *                                 négative : sous le niveau 0, par exemple
 *                                 en bas d'une falaise prise comme 0)
 *   !alt fly [id] <horizontal> <vertical> [speed=60]
 *                                 coût d'un déplacement en vol AVANT de bouger
 *                                 (vertical : + monte, - descend)
 *   !alt dist <id> <id cible>     écart entre deux tokens et mouvement en vol
 *                                 pour venir au contact de la cible
 *   !alt fall [id...] [to=-9m] [cat]
 *                                 chute jusqu'au sol (altitude 0, ou to=) :
 *                                 jet de dégâts ; cat = bottes du chat
 *                                 (1 dégât par dé)
 *   !alt show                     liste des altitudes de la page (chuchoté)
 *   !alt clear all                MJ : remet toutes les altitudes à 0
 *   !alt style color=#ff3300 size=26
 *                                 MJ : couleur et taille des étiquettes
 *
 * Un joueur n'agit que sur les tokens qu'il contrôle ; le MJ sur tous.
 * Vitesse de vol lue sur la fiche Pathfinder Community (speed-fly, en mètres
 * si la fiche est en mètres) ; speed=60 la remplace (sort Vol, par exemple).
 */
(() => {
  'use strict';

  // ===================== LOGIQUE PURE =====================

  // texte -> { cases, relatif, signe, valeur } ; unite = unité par défaut ('ft' ou 'm')
  // « +10 » / « -10 » : changement ; « 10 » : valeur ; « =-10 » : valeur négative
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

  // distance PF1 sur 2 axes, en cases : une diagonale sur deux compte double
  const dist2 = (a, b) => {
    a = Math.abs(a); b = Math.abs(b);
    return Math.max(a, b) + Math.floor(Math.min(a, b) / 2);
  };

  // écart en cases entre deux intervalles de cases [a0, a1] et [b0, b1] (inclus)
  const ecart = (a0, a1, b0, b1) => (a1 < b0 ? b0 - a1 : b1 < a0 ? a0 - b1 : 0);

  // coût en cases d'un vol de h cases à l'horizontale et v cases de hauteur
  // (v > 0 monte, v < 0 descend)
  function coutVol(h, v) {
    h = Math.abs(h);
    if (v > 0) return v + Math.max(h, v);
    return Math.max(h, -v);
  }

  // distance horizontale maximale pour un changement d'altitude v avec s cases
  // de mouvement ; -1 si le changement d'altitude seul coûte trop
  function horizontalMax(v, s) {
    if (v > 0) return 2 * v > s ? -1 : s - v;
    return -v > s ? -1 : s;
  }

  // analyse d'un vol : coût, tests de Vol, mouvement restant
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

  // dés de dégâts d'une chute de n cases : 1d6 par 10 ft, 20d6 au maximum
  const desChute = (cases) => Math.min(20, Math.floor((cases * 5) / 10));

  // affichage d'un nombre de cases dans l'unité de la page
  function enUnite(cases, unite) {
    if (unite === 'm') { const m = cases * 1.5; return (m % 1 ? m.toFixed(1).replace('.', ',') : String(m)) + ' m'; }
    return cases * 5 + ' ft';
  }

  if (typeof module !== 'undefined') {
    module.exports = { lireDistance, dist2, ecart, coutVol, horizontalMax, analyseVol, desChute, enUnite };
  }
  if (typeof on !== 'function') return; // hors Roll20 : on s'arrête ici

  // ===================== PARTIE ROLL20 =====================

  state.Altitude = state.Altitude || {};
  state.Altitude.alt = state.Altitude.alt || {};       // token -> altitude en cases
  state.Altitude.labels = state.Altitude.labels || {}; // token -> texte affiché

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
    if (playerid === 'API' || playerIsGM(playerid)) return true; // API : gabarit.js (Viseur)
    const ok = (s) => String(s || '').split(',').some((x) => x === 'all' || x === playerid);
    if (ok(t.get('controlledby'))) return true;
    const c = t.get('represents') && getObj('character', t.get('represents'));
    return !!(c && ok(c.get('controlledby')));
  }

  // ---------- étiquette sous le token ----------
  // tailles de police acceptées par Roll20 pour un texte
  const TAILLES = [12, 14, 16, 18, 20, 22, 26, 32, 40, 56];
  const style = () => Object.assign({ couleur: COULEUR, taille: 26 }, state.Altitude.style || {});

  // étiquette à DROITE du token, à hauteur de sa barre : sous le token, elle
  // serait cachée par la plaque du nom
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
    const largeur = texte.length * st.taille * 0.6; // estimation : le texte est centré sur left
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
    const a = Math.round(cases) || 0; // négative : sous le niveau de référence (0)
    if (a) state.Altitude.alt[t.id] = a; else delete state.Altitude.alt[t.id];
    placeEtiquette(t);
    return a;
  }

  // gabarit.js recalcule les zones touchées en 3D quand une altitude change
  function signalerGabarit(toks) {
    if (!state.gabarit) return;
    [...new Set(toks.map((t) => t.get('_pageid')))].forEach((p) => sendChat(NOM, `!gabarit refresh ${p}`));
  }

  // vitesse de vol (en cases) lue sur la fiche, 0 si inconnue
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

  // cases occupées par un token : [i0, i1], [j0, j1] et [k0, k1] en hauteur
  function volume(t) {
    const cp = casePx(pageDe(t));
    const nx = Math.max(1, Math.round(t.get('width') / cp));
    const ny = Math.max(1, Math.round(t.get('height') / cp));
    const i0 = Math.round((t.get('left') - (nx * cp) / 2) / cp);
    const j0 = Math.round((t.get('top') - (ny * cp) / 2) / cp);
    const k0 = altDe(t);
    return { i: [i0, i0 + nx - 1], j: [j0, j0 + ny - 1], k: [k0, k0 + Math.max(nx, ny) - 1] };
  }

  // ---------- commandes ----------
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
        // au contact : il reste une case d'écart sur chaque axe
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
      // altitude du sol où l'on tombe (to=-9m sous une falaise) ; 0 par défaut
      const opt = reste.find((a) => /^to=/i.test(a));
      const chat = reste.some((a) => /^cat$/i.test(a));
      const sol = opt ? lireDistance(opt.slice(3).replace(/^([+-])/, '=$1'), unite) : { valeur: 0 };
      if (!sol) { chuchoter(qui, 'Usage : !alt fall [to=-9m] (altitude du sol, 0 par défaut)'); return; }
      permis.forEach((t) => {
        const hauteur = altDe(t) - sol.valeur;
        if (hauteur <= 0) { chuchoter(qui, `${nomDe(t)} n'est pas au-dessus du sol (${altTexte(sol.valeur, unite)}).`); return; }
        const n = desChute(hauteur);
        fixerAltitude(t, sol.valeur);
        // Bottes du chat (Boots of the Cat) : dégâts minimum (1 par dé), retombe sur ses pieds
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

  // menu de boutons, distances en mètres quelle que soit l'unité de la page ;
  // les requêtes ?{...} et @{...} sont encodées pour n'être
  // évaluées qu'au clic, avec le token sélectionné à ce moment-là
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

  // l'étiquette suit son token
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
    // ménage : altitudes de tokens disparus pendant que le script était arrêté
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
    log('altitude.js v1.5 chargé');
  });
})();
