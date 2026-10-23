/*
 * gabarit.js — Gabarits de zones d'effet (Pathfinder 1e) pour l'API Roll20
 * Version 1.4 — l'émanation n'a plus de Viseur (elle reste sur le lanceur) ;
 *               v1.3 : l'émanation suit son lanceur ; les auras se mettent à
 *               jour quand une créature entre dans une zone ou en sort ;
 *               v1.2 : lignes obliques à N cases exactement (formes du manuel) ;
 *               v1.1 : plusieurs gabarits peuvent rester en même temps sur la carte,
 *               chacun avec son propre Viseur, sa couleur et son bouton Effacer ;
 *               cônes droits / diagonaux ; le cône et la ligne PARTENT du Viseur,
 *               direction choisie en le TOURNANT.
 *
 * MISE EN PLACE (une seule fois) : crée la macro « Gabarit » (visible par tous,
 * dans la barre de macros) :
 *
 *   !gabarit cast @{selected|token_id} ?{Forme|Cercle,burst|Cône droit,straightcone|Cône diagonal,diagcone|Ligne,line|Émanation,emanation} ?{Taille|1.5 m / 1 case,1sq|3 m / 2 cases,2sq|4.5 m / 3 cases,3sq|6 m / 4 cases,4sq|7.5 m / 5 cases,5sq|9 m / 6 cases,6sq|12 m / 8 cases,8sq|15 m / 10 cases,10sq|18 m / 12 cases,12sq|24 m / 16 cases,16sq|30 m / 20 cases,20sq|36 m / 24 cases,24sq}
 *
 * UTILISATION (joueur)
 *   Sélectionne ton token, clique « Gabarit », choisis la forme puis la taille.
 *   Un Viseur apparaît près de ton personnage et le gabarit se dessine, avec sa
 *   propre couleur.
 *   - Cercle : déplace le Viseur, le cercle est centré sur lui.
 *   - Cône / ligne : le gabarit PART du Viseur (calé sur l'intersection de grille
 *     la plus proche), comme un gabarit posé sur la carte. TOURNE le Viseur (sa
 *     flèche donne la direction) : touche E + molette de la souris, par pas de
 *     45° (Alt + E + molette : 1° par 1°). Le cône droit s'aimante sur les 4
 *     directions droites, le cône diagonal sur les 4 diagonales ; la rotation du
 *     Viseur s'ajuste toute seule.
 *     Pour appliquer la règle à la lettre, pose le Viseur sur un coin de la case
 *     du lanceur ; sinon, tu simules ce que donnerait le sort si le lanceur se
 *     trouvait ailleurs (le script ne vérifie pas l'origine).
 *   - Émanation : pas de Viseur. Elle part des bords de la case du lanceur et le
 *     SUIT quand il se déplace.
 *   Le gabarit suit le Viseur. Il reste sur la carte jusqu'à ce qu'on l'efface :
 *   relance « Gabarit » pour en ajouter un autre (nouveau Viseur, nouvelle
 *   couleur).
 *   Effacer : bouton « Effacer » du message reçu, ou supprimer le Viseur.
 *
 * UNITÉS
 *   Une taille se donne en cases (4sq), en mètres (6m) ou en pieds (20, 20ft).
 *   Le script la convertit en CASES (5 ft = 1,5 m = 1 case) : l'échelle de la
 *   carte (pieds, mètres...) n'a aucune influence sur la zone.
 *
 * IMAGE DU VISEUR
 *   Roll20 ne permet à un script de créer un token qu'avec une image qui est
 *   déjà dans TA bibliothèque (pas le Marketplace). Le script cherche, dans
 *   l'ordre : l'image choisie avec « !gabarit aimerimg », la constante
 *   VISEUR_IMG ci-dessous, puis l'image du lanceur ou d'un autre token de la
 *   carte (image de secours : teintée en rouge).
 *   L'image doit montrer une FLÈCHE vers le haut (rotation 0 = vers le haut) :
 *   c'est elle qui indique la direction des cônes et des lignes.
 *   Pour un joli réticule : importe une image dans ta bibliothèque, pose-la
 *   comme token, sélectionne-la et lance (MJ) :
 *       !gabarit aimerimg @{selected|token_id}
 *
 * AUTRES COMMANDES
 *   !gabarit cast <id lanceur> <forme> <taille> [color=fire] [duration=60]
 *   !gabarit clear          (efface tous TES gabarits)
 *   !gabarit clear g3       (efface le gabarit n°3)
 *   !gabarit clear all      (MJ : efface tous les gabarits)
 *   (options en anglais : les anciens mots français ne sont plus acceptés)
 *   formes : burst (cercle, aussi sphere, circle), straightcone (cône droit),
 *            diagcone (cône diagonal), cone (8 directions, selon la rotation
 *            du Viseur), line (ligne), emanation
 *   tailles : 4sq (cases), 6m (mètres), 20 ou 20ft (pieds)
 *   couleurs (color=, facultatif, sinon choisie automatiquement) :
 *     fire cold acid electricity (elec) sonic force negative neutral
 *   avec une cible (2e id de token) : corner=nw|ne|sw|se|center
 *
 * RÈGLES PF1e APPLIQUÉES (Chapitre 9, « Aiming a Spell »)
 *  - Le point d'origine est toujours une intersection de grille.
 *  - On compte les cases depuis l'intersection comme pour un déplacement :
 *    « chaque seconde diagonale compte double ». Coût d'une case située à
 *    a cases en largeur et b en hauteur de l'origine (a, b >= 1) :
 *        max(a, b) + floor(min(a, b) / 2)
 *    La case est touchée si ce coût <= la portée en cases.
 *  - cercle : zone centrée sur l'intersection.
 *  - cône droit : quart de cercle dirigé vers le haut, le bas, la gauche ou la
 *    droite (celle des 4 la plus proche de la direction du Viseur). Il part de
 *    l'intersection du Viseur, et couvre les deux cases voisines de ce point
 *    dans la direction visée. Bords à 45°.
 *  - cône diagonal : quart de cercle dirigé vers l'une des 4 diagonales (la plus
 *    proche de la direction du Viseur), parti de l'intersection du Viseur. Les
 *    cases sont comptées avec la règle des diagonales (donc un cône diagonal
 *    couvre moins de cases qu'un cône droit).
 *    (Règle du livre : un cône part d'un coin de la case du lanceur. Le script
 *    laisse l'origine libre pour pouvoir simuler ; c'est au joueur de poser le
 *    Viseur sur un coin de son token pour la règle stricte.)
 *  - ligne : cases traversées par la droite, dans la direction exacte du Viseur,
 *    depuis l'intersection du Viseur (portée comptée de la même façon). Une ligne
 *    exactement horizontale ou verticale longe une frontière entre deux rangées :
 *    elle suit alors la rangée (ou la colonne) du côté du lanceur.
 *  - emanation : comptée depuis le bord de la case du lanceur (lanceur exclu),
 *    redessinée quand le lanceur bouge.
 *  - Une créature est touchée si UNE de ses cases est dans la zone (elle reçoit
 *    l'aura de la couleur du gabarit), recalculée quand une créature se
 *    déplace. Le lanceur n'est jamais touché par son
 *    propre cône, ligne ou émanation.
 *  - Non géré : ligne d'effet (murs), grilles hexagonales.
 */
(() => {
  const PX = 70; // pixels par unité de page Roll20

  // Optionnel : URL d'une image de TA bibliothèque Roll20 pour le Viseur
  // (laisser vide pour que le script en trouve une tout seul).
  const VISEUR_IMG = '';

  const COULEURS = {
    fire: '#ff4400', cold: '#33aaff', acid: '#66cc00', elec: '#ffd800',
    electricity: '#ffd800', sonic: '#bb88ff', force: '#ff66cc',
    negative: '#555555', neutral: '#ffffff'
  };

  // mots acceptés dans la commande (anglais) -> nom interne de la forme
  const FORMES = {
    burst: 'burst', sphere: 'burst', circle: 'burst',
    cone: 'cone',
    straightcone: 'conedroit', 'straight-cone': 'conedroit',
    diagcone: 'conediag', 'diag-cone': 'conediag', diagonalcone: 'conediag',
    line: 'ligne',
    emanation: 'emanation'
  };

  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  // ===================== LOGIQUE PURE (testable hors Roll20) =====================

  // index (>=1) d'une case par rapport à l'intersection, dans le sens `sign`
  const idxRel = (c, o, sign) => (sign > 0 ? c - o + 1 : o - c);
  // index (>=1) d'une case par rapport à l'intersection, sans tenir compte du sens
  const idxAbs = (c, o) => (c >= o ? c - o + 1 : o - c);
  // coût PF1e : chaque seconde diagonale compte double
  const cout = (a, b) => Math.max(a, b) + Math.floor(Math.min(a, b) / 2);

  const cle = (i, j) => i + ',' + j;

  // Rotation d'un token Roll20 (degrés, sens horaire, 0 = flèche vers le haut)
  // -> angle en radians dans le repère de l'écran (y vers le bas, 0 = vers la droite)
  const angleDeRotation = (rot) => ((Number(rot) || 0) - 90) * Math.PI / 180;

  // Direction d'un cône (indice 0..7 dans DIRS : 0 = droite, 1 = bas-droite,
  // 2 = bas, 3 = bas-gauche, 4 = gauche, 5 = haut-gauche, 6 = haut, 7 = haut-droite).
  // angle en radians, y vers le bas (repère Roll20). mode :
  //   'droit' -> 4 directions orthogonales, la plus proche
  //   'diag'  -> 4 diagonales, celle du quadrant visé
  //   'auto'  -> la plus proche parmi les 8
  function dirCone(angle, mode) {
    const q = Math.PI / 4;
    let k;
    if (mode === 'droit') k = 2 * Math.round(angle / (2 * q));
    else if (mode === 'diag') k = 2 * Math.floor(angle / (2 * q)) + 1;
    else k = Math.round(angle / q);
    return ((k % 8) + 8) % 8;
  }

  // "20", "20ft" -> pieds ; "6m" -> mètres ; "4sq" / "4squares" -> cases.
  // Règle : 5 ft = 1,5 m = 1 case. Renvoie un nombre de cases entier >= 1, ou null.
  function tailleEnCases(txt) {
    const m = String(txt).trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*(ft|m|sq|square|squares)?$/);
    if (!m) return null;
    const v = parseFloat(m[1].replace(',', '.'));
    const u = m[2] || 'ft';
    let cases;
    if (u === 'm') cases = v / 1.5;
    else if (u === 'sq' || u === 'square' || u === 'squares') cases = v;
    else cases = v / 5;
    cases = Math.round(cases);
    return cases >= 1 ? cases : null;
  }

  // Boule : origine = intersection (ox, oy) en indices de grille, N = portée en cases
  function casesBurst(ox, oy, N) {
    const set = new Set();
    for (let i = ox - N - 1; i <= ox + N; i++) {
      for (let j = oy - N - 1; j <= oy + N; j++) {
        if (cout(idxAbs(i, ox), idxAbs(j, oy)) <= N) set.add(cle(i, j));
      }
    }
    return set;
  }

  // Cône : dir = indice 0..7 dans DIRS
  function casesCone(ox, oy, N, dir) {
    const [ux, uy] = DIRS[dir];
    const diag = ux !== 0 && uy !== 0;
    const set = new Set();
    for (let i = ox - N - 1; i <= ox + N; i++) {
      for (let j = oy - N - 1; j <= oy + N; j++) {
        let ok = false;
        if (diag) {
          const a = idxRel(i, ox, ux), b = idxRel(j, oy, uy);
          ok = a >= 1 && b >= 1 && cout(a, b) <= N;
        } else {
          let a, b;
          if (ux !== 0) { a = idxRel(i, ox, ux); b = idxAbs(j, oy); }
          else { a = idxRel(j, oy, uy); b = idxAbs(i, ox); }
          ok = a >= 1 && b <= a && cout(a, b) <= N;
        }
        if (ok) set.add(cle(i, j));
      }
    }
    return set;
  }

  // paramètre d'entrée t (0..1) du segment (x0,y0)-(x1,y1) dans le rectangle,
  // ou -1 s'il le traverse sur une longueur nulle
  function segmentTraverse(x0, y0, x1, y1, xmin, ymin, xmax, ymax) {
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) { if (q[k] <= 0) return -1; }
      else {
        const r = q[k] / p[k];
        if (p[k] < 0) { if (r > t1) return -1; if (r > t0) t0 = r; }
        else { if (r < t0) return -1; if (r < t1) t1 = r; }
      }
    }
    return (t1 - t0) * Math.hypot(dx, dy) > 1e-3 ? t0 : -1;
  }

  // Ligne : origine en pixels (O), angle en radians, casePx = taille d'une case.
  // Comme dans le manuel : une ligne droite compte N cases ; une ligne en diagonale
  // exacte suit la règle « une diagonale sur deux compte double » (30 ft = 4 cases) ;
  // une ligne oblique garde les N premières cases traversées, dans l'ordre du trajet.
  function casesLigne(O, angle, N, casePx) {
    const ox = Math.round(O[0] / casePx), oy = Math.round(O[1] / casePx);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const diagonale = Math.abs(Math.abs(ux) - Math.abs(uy)) < 1e-6;
    const L = N * casePx * 2;
    const x1 = O[0] + L * ux, y1 = O[1] + L * uy;
    const touchees = [];
    for (let i = ox - N - 1; i <= ox + N; i++) {
      for (let j = oy - N - 1; j <= oy + N; j++) {
        if (diagonale && cout(idxAbs(i, ox), idxAbs(j, oy)) > N) continue;
        const t = segmentTraverse(O[0], O[1], x1, y1, i * casePx, j * casePx, (i + 1) * casePx, (j + 1) * casePx);
        if (t >= 0) touchees.push([t, i, j]);
      }
    }
    touchees.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const set = new Set();
    for (const [, i, j] of touchees) {
      if (!diagonale && set.size >= N) break;
      set.add(cle(i, j));
    }
    return set;
  }

  // Émanation : depuis le rectangle de cases du lanceur [ci0..ci1] x [cj0..cj1]
  function casesEmanation(ci0, ci1, cj0, cj1, N) {
    const set = new Set();
    for (let i = ci0 - N; i <= ci1 + N; i++) {
      for (let j = cj0 - N; j <= cj1 + N; j++) {
        const gx = i < ci0 ? ci0 - i : (i > ci1 ? i - ci1 : 0);
        const gy = j < cj0 ? cj0 - j : (j > cj1 ? j - cj1 : 0);
        if (!gx && !gy) continue;
        const c = gx && gy ? cout(gx, gy) : Math.max(gx, gy);
        if (c <= N) set.add(cle(i, j));
      }
    }
    return set;
  }

  // Contour : boucles fermées (en indices de grille) délimitant l'ensemble de cases
  function contour(set) {
    const arcs = new Map();
    const add = (x1, y1, x2, y2) => {
      const k = cle(x1, y1);
      if (!arcs.has(k)) arcs.set(k, []);
      arcs.get(k).push([x2, y2]);
    };
    set.forEach((key) => {
      const [i, j] = key.split(',').map(Number);
      if (!set.has(cle(i, j - 1))) add(i, j, i + 1, j);
      if (!set.has(cle(i + 1, j))) add(i + 1, j, i + 1, j + 1);
      if (!set.has(cle(i, j + 1))) add(i + 1, j + 1, i, j + 1);
      if (!set.has(cle(i - 1, j))) add(i, j + 1, i, j);
    });
    const boucles = [];
    let garde = 0;
    while (arcs.size && garde++ < 10000) {
      const k0 = arcs.keys().next().value;
      const depart = k0.split(',').map(Number);
      let cur = depart;
      const boucle = [cur];
      let pas = 0;
      while (pas++ < 10000) {
        const k = cle(cur[0], cur[1]);
        const sorties = arcs.get(k);
        if (!sorties) break;
        const nxt = sorties.pop();
        if (!sorties.length) arcs.delete(k);
        cur = nxt;
        if (cur[0] === depart[0] && cur[1] === depart[1]) break;
        boucle.push(cur);
      }
      // retire les points alignés
      const n = boucle.length;
      const simple = boucle.filter((p, idx) => {
        const a = boucle[(idx + n - 1) % n], b = boucle[(idx + 1) % n];
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
      });
      boucles.push(simple);
    }
    return boucles;
  }

  if (typeof module !== 'undefined') {
    module.exports = { tailleEnCases, dirCone, angleDeRotation, cout, casesBurst, casesCone, casesLigne, casesEmanation, contour };
  }
  if (typeof on !== 'function') return; // hors Roll20 : on s'arrête ici

  // ===================== PARTIE ROLL20 =====================

  state.gabarit = state.gabarit || {};
  state.gabarit.liste = state.gabarit.liste || {};       // id -> gabarit
  state.gabarit.auraOrig = state.gabarit.auraOrig || {}; // token -> aura d'origine
  state.gabarit.compteur = state.gabarit.compteur || 0;

  // couleurs attribuées automatiquement, dans l'ordre, pour distinguer les gabarits
  const PALETTE = ['#ff4400', '#33aaff', '#66cc00', '#ffd800', '#bb88ff', '#ff66cc', '#00cccc', '#ff9900'];

  const FORME_NOM = { burst: 'Cercle', cone: 'Cône', conedroit: 'Cône droit', conediag: 'Cône diagonal', ligne: 'Ligne', emanation: 'Émanation' };
  const MODE_CONE = { cone: 'auto', conedroit: 'droit', conediag: 'diag' };
  const metres = (n) => { const m = n * 1.5; return m % 1 ? m.toFixed(1) : String(m); };
  const libelle = (forme, n) => `${FORME_NOM[forme]} ${metres(n)} m / ${n} case${n > 1 ? 's' : ''}`;

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const echelle = (page) => ({ casePx: PX * (parseFloat(page.get('snapping_increment')) || 1) });
  const centre = (t) => [t.get('left'), t.get('top')];

  const coins = (t) => {
    const l = t.get('left'), tp = t.get('top');
    const w = t.get('width') / 2, h = t.get('height') / 2;
    return { nw: [l - w, tp - h], ne: [l + w, tp - h], sw: [l - w, tp + h], se: [l + w, tp + h] };
  };

  const plusProche = (pts, ref) => pts.reduce((a, b) => (dist(b, ref) < dist(a, ref) ? b : a));

  // coins de la case du lanceur qui regardent dans la direction (ux, uy) :
  // une diagonale -> 1 coin ; une direction droite -> les 2 coins de ce côté
  function coinsDeLaDirection(c, ux, uy) {
    const out = [];
    ['nw', 'ne', 'sw', 'se'].forEach((k) => {
      const sx = k[1] === 'e' ? 1 : -1, sy = k[0] === 's' ? 1 : -1;
      if (ux !== 0 && uy !== 0) { if (sx === ux && sy === uy) out.push(c[k]); }
      else if (ux !== 0) { if (sx === ux) out.push(c[k]); }
      else if (sy === uy) out.push(c[k]);
    });
    return out;
  }
  const parler = (qui, texte) => sendChat('Gabarit', `/w "${qui}" ${texte}`);
  const estViseur = (t) => /^viseur/i.test(t.get('name') || '');
  const gidDuViseur = (id) => Object.keys(state.gabarit.liste).find((g) => state.gabarit.liste[g].viseurId === id);

  // rectangle de cases (indices) occupé par un token
  function rectCases(t, casePx) {
    const nx = Math.max(1, Math.round(t.get('width') / casePx));
    const ny = Math.max(1, Math.round(t.get('height') / casePx));
    const ci0 = Math.round((t.get('left') - (nx * casePx) / 2) / casePx);
    const cj0 = Math.round((t.get('top') - (ny * casePx) / 2) / casePx);
    return { ci0, cj0, ci1: ci0 + nx - 1, cj1: cj0 + ny - 1 };
  }

  // boucles en indices de grille -> un seul tracé Roll20 (plusieurs sous-chemins)
  function creerChemin(pageId, boucles, casePx, couleur) {
    const bp = boucles.map((b) => b.map((p) => [p[0] * casePx, p[1] * casePx]));
    const tous = [].concat(...bp);
    const minX = Math.min(...tous.map((p) => p[0])), maxX = Math.max(...tous.map((p) => p[0]));
    const minY = Math.min(...tous.map((p) => p[1])), maxY = Math.max(...tous.map((p) => p[1]));
    const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    const chemin = [];
    bp.forEach((b) => {
      b.forEach((p, i) => chemin.push([i ? 'L' : 'M', p[0] - minX, p[1] - minY]));
      chemin.push(['L', b[0][0] - minX, b[0][1] - minY]);
    });
    const path = createObj('path', {
      _pageid: pageId,
      layer: 'objects',
      _path: JSON.stringify(chemin),
      left: minX + w / 2,
      top: minY + h / 2,
      width: w,
      height: h,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      stroke: couleur,
      stroke_width: 5,
      fill: 'transparent'
    });
    if (path) toBack(path);
    return path;
  }

  // ---------- calcul et dessin d'un gabarit ----------
  function calculerCases(rec, lanceur, casePx) {
    const N = rec.N;
    if (rec.forme === 'emanation') {
      if (!lanceur) return null;
      const r = rectCases(lanceur, casePx);
      return casesEmanation(r.ci0, r.ci1, r.cj0, r.cj1, N);
    }
    const viseur = rec.viseurId && getObj('graphic', rec.viseurId);
    const cible = viseur || (rec.cibleId && getObj('graphic', rec.cibleId));
    if (!cible) return null;
    // sans Viseur, la zone dépend du lanceur ; avec, le lanceur peut avoir disparu
    if (!viseur && !lanceur) return null;

    if (rec.forme === 'burst') {
      let o;
      if (viseur || rec.coin === 'center') o = centre(cible);
      else {
        const c = coins(cible);
        o = c[rec.coin] || plusProche(Object.values(c), centre(lanceur));
      }
      return casesBurst(Math.round(o[0] / casePx), Math.round(o[1] / casePx), N);
    }

    // direction et origine : le Viseur donne les deux (rotation = direction,
    // intersection la plus proche de son centre = origine). À défaut (cible = un
    // token), direction lanceur -> cible, départ d'un coin de la case du lanceur.
    const c0 = centre(lanceur || viseur);
    const mode = MODE_CONE[rec.forme];
    let angle, o;
    if (viseur) {
      const v = centre(viseur);
      angle = angleDeRotation(viseur.get('rotation'));
      o = [Math.round(v[0] / casePx) * casePx, Math.round(v[1] / casePx) * casePx];
    } else {
      const ref = centre(cible);
      const co = coins(lanceur);
      angle = Math.atan2(ref[1] - c0[1], ref[0] - c0[0]);
      if (mode) {
        const [dx, dy] = DIRS[dirCone(angle, mode)];
        o = plusProche(coinsDeLaDirection(co, dx, dy), ref);
      } else {
        const vx = Math.cos(angle), vy = Math.sin(angle);
        const face = Object.values(co).filter((p) => (p[0] - c0[0]) * vx + (p[1] - c0[1]) * vy > 1e-6);
        o = plusProche(face.length ? face : Object.values(co), ref);
      }
    }
    const ox = Math.round(o[0] / casePx), oy = Math.round(o[1] / casePx);

    if (mode) return casesCone(ox, oy, N, dirCone(angle, mode));

    // ligne : une ligne exactement horizontale ou verticale partant d'une
    // intersection longe la frontière entre deux rangées et ne traverserait aucune
    // case : on la décale d'une fraction de pixel vers le côté du lanceur.
    const ux = Math.cos(angle), uy = Math.sin(angle);
    let nx = 0, ny = 0;
    if (Math.abs(ux) < 1e-9 || Math.abs(uy) < 1e-9) {
      const px = -uy, py = ux; // perpendiculaire à la direction
      const cote = (c0[0] - o[0]) * px + (c0[1] - o[1]) * py;
      const sg = cote < -1e-6 ? -1 : 1;
      nx = sg * 0.5 * px;
      ny = sg * 0.5 * py;
    }
    return casesLigne([ox * casePx + nx, oy * casePx + ny], angle, N, casePx);
  }

  // (re)dessine le contour du gabarit ; renvoie false si impossible
  function dessiner(rec) {
    const lanceur = getObj('graphic', rec.lanceurId);
    const page = getObj('page', rec.pageId);
    if (!page) return false;
    const { casePx } = echelle(page);
    const cases = calculerCases(rec, lanceur, casePx);
    if (!cases) return false;
    const boucles = contour(cases);
    const path = boucles.length ? creerChemin(rec.pageId, boucles, casePx, rec.couleur) : null;
    if (!path) return false;
    const ancien = rec.pathId && getObj('path', rec.pathId);
    if (ancien) ancien.remove();
    rec.pathId = path.id;
    rec.cases = Array.from(cases);
    rec.sig = signature(rec);
    return true;
  }

  // état des tokens dont dépend la zone, au moment du dessin : évite de redessiner
  // deux fois le même état (évènement relancé ou non par Roll20).
  // Émanation : le lanceur ; avec un Viseur : le Viseur ; sinon : lanceur + cible.
  function signature(rec) {
    const pos = (id) => {
      const t = id && getObj('graphic', id);
      return t ? `${t.get('left')},${t.get('top')},${t.get('width')},${t.get('height')},${t.get('rotation')}` : '-';
    };
    if (rec.forme === 'emanation') return pos(rec.lanceurId);
    if (rec.viseurId) return pos(rec.viseurId);
    return pos(rec.lanceurId) + '|' + pos(rec.cibleId);
  }

  // ---------- auras des créatures touchées ----------
  // Recalculées pour TOUS les gabarits de la page : le dernier gabarit posé
  // l'emporte sur une créature touchée par plusieurs zones.
  function rafraichirAuras(pageId) {
    const page = getObj('page', pageId);
    if (!page) return;
    const { casePx } = echelle(page);
    const tokens = findObjs({ _type: 'graphic', _subtype: 'token', _pageid: pageId, layer: 'objects' })
      .filter((t) => !estViseur(t));

    const touche = new Map(); // id du token -> couleur
    Object.keys(state.gabarit.liste).forEach((gid) => {
      const rec = state.gabarit.liste[gid];
      if (rec.pageId !== pageId) return;
      const cases = new Set(rec.cases);
      tokens.forEach((t) => {
        if (rec.forme !== 'burst' && t.id === rec.lanceurId) return;
        const r = rectCases(t, casePx);
        for (let i = r.ci0; i <= r.ci1; i++) {
          for (let j = r.cj0; j <= r.cj1; j++) {
            if (cases.has(cle(i, j))) { touche.set(t.id, rec.couleur); return; }
          }
        }
      });
    });

    // créatures qui ne sont plus touchées : on restaure leur aura d'origine
    Object.keys(state.gabarit.auraOrig).forEach((id) => {
      const t = getObj('graphic', id);
      if (!t) { delete state.gabarit.auraOrig[id]; return; }
      if (t.get('_pageid') === pageId && !touche.has(id)) {
        const o = state.gabarit.auraOrig[id];
        t.set({ aura1_radius: o.r, aura1_color: o.c, aura1_square: o.s });
        delete state.gabarit.auraOrig[id];
      }
    });

    touche.forEach((couleur, id) => {
      const t = getObj('graphic', id);
      if (!t) return;
      if (!state.gabarit.auraOrig[id]) {
        state.gabarit.auraOrig[id] = { r: t.get('aura1_radius'), c: t.get('aura1_color'), s: t.get('aura1_square') };
      }
      t.set({ aura1_radius: '0', aura1_color: couleur, aura1_square: true });
    });
  }

  function effacer(gid) {
    const rec = state.gabarit.liste[gid];
    if (!rec) return;
    delete state.gabarit.liste[gid];
    const path = rec.pathId && getObj('path', rec.pathId);
    if (path) path.remove();
    const v = rec.viseurId && getObj('graphic', rec.viseurId);
    if (v) v.remove();
    rafraichirAuras(rec.pageId);
  }

  // ---------- le Viseur ----------
  // URL d'image utilisable par createObj (bibliothèque perso uniquement)
  const nettoyerImg = (src) => {
    const m = (src || '').match(/(.*\/images\/.*)(thumb|med|original|max)(.*)$/);
    return m ? m[1] + 'thumb' + m[3] : null;
  };

  // direction de départ du Viseur : vers la droite (cône droit, ligne), vers le
  // bas-droite (cône diagonal) ; le cercle n'en a pas besoin
  const rotationInitiale = (forme) => (forme === 'conediag' ? 135 : forme === 'burst' ? 0 : 90);

  // rotation que le Viseur doit afficher pour refléter la direction réellement
  // utilisée par un cône (aimantation) ; null = pas d'aimantation
  function rotationAimantee(rec, v) {
    const mode = MODE_CONE[rec.forme];
    if (!mode) return null;
    return (dirCone(angleDeRotation(v.get('rotation')), mode) * 45 + 90) % 360;
  }
  const ecartAngle = (a, b) => {
    const d = Math.abs((((a - b) % 360) + 360) % 360);
    return Math.min(d, 360 - d);
  };

  function creerViseur(rec, img, taille, secours) {
    try {
      return createObj('graphic', {
        _pageid: rec.pageId,
        _subtype: 'token',
        imgsrc: img,
        name: `Viseur ${rec.id.slice(1)}: ${rec.label}`,
        showname: true,
        showplayers_name: true,
        left: 0,
        top: 0,
        width: taille,
        height: taille,
        rotation: rotationInitiale(rec.forme),
        layer: 'objects',
        tint_color: secours ? '#ff0000' : 'transparent',
        aura1_radius: '0',
        aura1_color: rec.couleur,
        aura1_square: true
      });
    } catch (e) {
      return null;
    }
  }

  // première intersection libre autour du lanceur (sans chevaucher le lanceur
  // ni un autre Viseur) ; renvoie des pixels
  function positionLibre(lanceur, casePx) {
    const r = rectCases(lanceur, casePx);
    const viseurs = findObjs({ _type: 'graphic', _subtype: 'token', _pageid: lanceur.get('_pageid') }).filter(estViseur);
    const vc = viseurs.map((v) => [Math.round(v.get('left') / casePx), Math.round(v.get('top') / casePx)]);
    const base = [r.ci1 + 2, r.cj1 + 2];
    for (let d = 0; d <= 8; d++) {
      for (let dx = -d; dx <= d; dx++) {
        for (let dy = -d; dy <= d; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          const x = base[0] + dx, y = base[1] + dy; // intersection = centre du Viseur 2x2
          if (x - 1 <= r.ci1 && x >= r.ci0 && y - 1 <= r.cj1 && y >= r.cj0) continue;
          if (vc.some((c) => Math.abs(c[0] - x) < 2 && Math.abs(c[1] - y) < 2)) continue;
          return [x * casePx, y * casePx];
        }
      }
    }
    return [base[0] * casePx, base[1] * casePx];
  }

  // crée un NOUVEAU Viseur pour ce gabarit et le place près du lanceur
  function preparerViseur(lanceur, rec) {
    const page = getObj('page', rec.pageId);
    const { casePx } = echelle(page);

    // [image, image de secours ?] : seules les images de secours sont teintées
    const candidats = [
      [state.gabarit.viseurImg, false],
      [VISEUR_IMG, false],
      [state.gabarit.viseurImgAuto, true],
      [lanceur.get('imgsrc'), true]
    ];
    findObjs({ _type: 'graphic', _subtype: 'token', _pageid: rec.pageId }).forEach((t) => {
      if (!estViseur(t)) candidats.push([t.get('imgsrc'), true]);
    });

    let v = null;
    const vus = new Set();
    for (const [src, secours] of candidats) {
      const img = nettoyerImg(src);
      if (!img || vus.has(img)) continue;
      vus.add(img);
      v = creerViseur(rec, img, 2 * casePx, secours);
      if (v) { if (secours) state.gabarit.viseurImgAuto = img; break; }
    }
    if (!v) return null;

    const [x, y] = positionLibre(lanceur, casePx);
    v.set({ controlledby: 'all', left: x, top: y });
    toFront(v);
    return v;
  }

  // ---------- commandes ----------
  on('chat:message', (msg) => {
    if (msg.type !== 'api' || !/^!gabarit\b/i.test(msg.content)) return;

    const qui = msg.who.replace(/ \(GM\)$/, '');
    const args = msg.content.trim().split(/\s+/).slice(1);
    const cmd = (args[0] || '').toLowerCase();
    const estMJ = playerIsGM(msg.playerid);

    if (cmd === 'clear') {
      const cible = (args[1] || '').toLowerCase();
      const ids = Object.keys(state.gabarit.liste);
      if (/^g\d+$/.test(cible)) {
        const rec = state.gabarit.liste[cible];
        if (rec && (rec.playerid === msg.playerid || estMJ)) effacer(cible);
      } else if (cible === 'all' && estMJ) {
        ids.forEach((g) => effacer(g));
      } else {
        ids.filter((g) => state.gabarit.liste[g].playerid === msg.playerid).forEach((g) => effacer(g));
      }
      return;
    }

    if (cmd === 'aimerimg') {
      if (!estMJ) { parler(qui, 'Réservé au MJ.'); return; }
      const t = getObj('graphic', args.find((x) => /^-[\w-]{10,}$/.test(x)));
      const img = t && nettoyerImg(t.get('imgsrc'));
      if (!img) { parler(qui, 'Sélectionne un token dont l\'image vient de ta bibliothèque (pas du Marketplace).'); return; }
      state.gabarit.viseurImg = img;
      parler(qui, 'Image du Viseur enregistrée.');
      return;
    }

    if (cmd !== 'cast' && !FORMES[cmd]) {
      parler(qui, 'Usage : !gabarit cast &lt;id lanceur&gt; &lt;forme&gt; &lt;taille&gt; [color=fire] [duration=60] — ou !gabarit clear');
      return;
    }

    const reste = cmd === 'cast' ? args.slice(1) : args;
    const ids = reste.filter((a) => /^-[\w-]{10,}$/.test(a));
    const opts = {};
    let nomForme, N;
    reste.forEach((a) => {
      const low = a.toLowerCase();
      const m = a.match(/^(\w+)=(.+)$/);
      if (FORMES[low]) nomForme = low;
      else if (tailleEnCases(a)) N = tailleEnCases(a);
      else if (m) opts[m[1].toLowerCase()] = m[2].toLowerCase();
    });
    if (!nomForme || !N) { parler(qui, 'Effet incomplet : il faut une forme et une taille (ex. 4sq, 6m ou 20).'); return; }

    const lanceur = getObj('graphic', ids[0]);
    if (!lanceur) { parler(qui, 'Sélectionne ton token avant de cliquer sur « Gabarit ».'); return; }

    const forme = FORMES[nomForme];
    const num = ++state.gabarit.compteur;
    const rec = {
      id: 'g' + num,
      playerid: msg.playerid,
      qui,
      pageId: lanceur.get('_pageid'),
      lanceurId: lanceur.id,
      cibleId: ids[1] || null,
      viseurId: null,
      pathId: null,
      cases: [],
      forme,
      N,
      coin: opts.corner,
      couleur: COULEURS[opts.color] || PALETTE[(num - 1) % PALETTE.length],
      label: libelle(forme, N)
    };

    // l'émanation n'a pas de Viseur : elle reste attachée au lanceur
    if (forme !== 'emanation' && !rec.cibleId) {
      const viseur = preparerViseur(lanceur, rec);
      if (!viseur) {
        parler(qui, 'Impossible de créer le Viseur : aucune image de la bibliothèque du MJ n\'est utilisable. MJ : sélectionne un token (image de ta bibliothèque) et lance !gabarit aimerimg @{selected|token_id}');
        return;
      }
      rec.viseurId = viseur.id;
    }

    state.gabarit.liste[rec.id] = rec;
    if (!dessiner(rec)) {
      effacer(rec.id);
      parler(qui, 'Impossible de créer le gabarit.');
      return;
    }
    rafraichirAuras(rec.pageId);

    const duree = parseFloat(opts.duration);
    if (duree > 0) setTimeout(() => effacer(rec.id), duree * 1000);

    const aide = forme === 'emanation' ? ' — elle suit ton token' : rec.viseurId ? ' — déplace le Viseur pour ajuster' : '';
    parler(qui, `<b>${rec.label}</b>${aide} · [Effacer](!gabarit clear ${rec.id}) [Tout effacer](!gabarit clear)`);
  });

  const CLES_POSITION = ['left', 'top', 'rotation', 'width', 'height'];

  on('change:graphic', (obj, prev) => {
    if (CLES_POSITION.every((k) => obj.get(k) === prev[k])) return;
    const gid = gidDuViseur(obj.id);

    // le gabarit suit son Viseur quand on le déplace ou qu'on le tourne
    if (gid) {
      const rec = state.gabarit.liste[gid];

      // cône : la flèche du Viseur s'aimante sur la direction utilisée. On ne compte
      // pas sur l'évènement que ce set pourrait relancer : Roll20 ne le relance pas
      // forcément pour une modification faite par un script. On redessine donc tout de
      // suite, et la signature évite un second dessin si l'évènement arrive quand même.
      const cible = rotationAimantee(rec, obj);
      if (cible !== null && ecartAngle(cible, obj.get('rotation')) > 0.5) obj.set({ rotation: cible });

      if (signature(rec) === rec.sig) return; // déjà dessiné dans cet état
      if (dessiner(rec)) rafraichirAuras(rec.pageId);
      return;
    }

    // un autre token : lanceur d'une émanation, lanceur / cible d'un gabarit sans
    // Viseur, ou simple créature qui entre dans une zone ou en sort
    const pageId = obj.get('_pageid');
    const recs = Object.values(state.gabarit.liste).filter((r) => r.pageId === pageId);
    if (!recs.length) return;
    recs.forEach((r) => {
      if ((r.lanceurId === obj.id || r.cibleId === obj.id) && state.gabarit.liste[r.id] && signature(r) !== r.sig) dessiner(r);
    });
    rafraichirAuras(pageId);
  });

  // supprimer le Viseur efface son gabarit ; supprimer le lanceur efface les
  // gabarits sans Viseur qui dépendaient de ce token (émanation, cible = token)
  on('destroy:graphic', (obj) => {
    const gid = gidDuViseur(obj.id);
    if (gid) { effacer(gid); return; }
    Object.keys(state.gabarit.liste).forEach((g) => {
      const r = state.gabarit.liste[g];
      if (!r) return;
      if (!r.viseurId && (r.lanceurId === obj.id || r.cibleId === obj.id)) effacer(g);
    });
  });

  on('ready', () => log('gabarit.js v1.4 chargé'));
})();
