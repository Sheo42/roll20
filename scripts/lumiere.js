/*
 * lumiere.js — Light from spells and items tracked by bufftracker.js (Roll20 API)
 * Version 1.0
 *
 * A bufftracker.js effect named after a light source lights its targets (all their
 * tokens, on every page) and turns them off when the effect ends.
 * Pathfinder 1e ranges: bright light, then as much dim light beyond it. In the
 * token settings Roll20 shows the low-light distance as added to the bright one,
 * but the API field low_light_distance is the total radius (TokenMod adds them too).
 *
 *   Lumière, Flamme éternelle, Lumières dansantes   6 m + 6 m
 *   Lumière du jour                                 18 m + 18 m
 *   Torche, Torche éternelle                        6 m + 6 m
 *   Lampe                                           4.5 m + 4.5 m
 *   Lanterne à capote, Bâton éclairant              9 m + 9 m
 *   Lanterne sourde                                 90° cone, 18 m + 18 m
 *   Bougie                                          1.5 m of dim light
 * English names work too (Light, Daylight, Torch, Sunrod...). A note in brackets is
 * ignored: "Torche (Paz)" counts as Torche.
 * Flames get an orange tint, spells white light. Dim light opacity: 30%.
 *
 * Before lighting a token, the script saves its light and restores it when the
 * effect ends. If the light was changed in the meantime (Lumière macro), it is left
 * alone. Several effects on one token: the biggest one shines.
 * Distances follow the page unit (meters or feet).
 *
 * COMMANDS
 *   !lumiere list   GM: tokens lit by an effect
 *   !lumiere help
 *
 * Needs bufftracker.js (version 2.7 or later). Data: state.Lumiere.
 */
(() => {
  'use strict';

  const NOM = 'Lumière';
  const ETAT = 'Lumiere';
  const CMD = '!lumiere';

  // ========================================================= PURE LOGIC (testable)
  const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '');

  const FLAMME = '#ffb366';
  const BLANC = 'transparent';
  // distances in meters: bright = bright light, low = extra dim light beyond it
  const SOURCES = [
    { name: 'Lumière', keys: ['lumiere', 'light'], bright: 6, low: 6, color: BLANC },
    { name: 'Lumière du jour', keys: ['lumieredujour', 'daylight'], bright: 18, low: 18, color: BLANC },
    { name: 'Lumières dansantes', keys: ['lumieresdansantes', 'dancinglights'], bright: 6, low: 6, color: BLANC },
    { name: 'Flamme éternelle', keys: ['flammeeternelle', 'continualflame'], bright: 6, low: 6, color: FLAMME },
    { name: 'Torche', keys: ['torche', 'torch'], bright: 6, low: 6, color: FLAMME },
    { name: 'Torche éternelle', keys: ['torcheeternelle', 'everburningtorch'], bright: 6, low: 6, color: FLAMME },
    { name: 'Lampe', keys: ['lampe', 'lamp'], bright: 4.5, low: 4.5, color: FLAMME },
    { name: 'Lanterne à capote', keys: ['lanterneacapote', 'hoodedlantern'], bright: 9, low: 9, color: FLAMME },
    { name: 'Lanterne sourde', keys: ['lanternesourde', 'bullseyelantern'], bright: 18, low: 18, angle: 90, color: FLAMME },
    { name: 'Bâton éclairant', keys: ['batoneclairant', 'sunrod'], bright: 9, low: 9, color: BLANC },
    { name: 'Bougie', keys: ['bougie', 'candle'], bright: 0, low: 1.5, color: FLAMME }
  ];
  const sourceOf = (buffName) => {
    const n = normalize(buffName);
    return n ? SOURCES.find((s) => s.keys.includes(n)) || null : null;
  };
  const reach = (s) => s.bright + s.low;
  // the biggest source (null if none)
  const best = (sources) => sources.filter(Boolean).reduce((a, b) => (!a || reach(b) > reach(a) ? b : a), null);

  // pages in feet: 1.5 m = 5 ft
  const toUnits = (m, units) => (/^(ft|feet|pieds?)$/i.test(String(units || '').trim()) ? Math.round(m / 1.5 * 5 * 100) / 100 : m);

  const LIGHT = ['emits_bright_light', 'emits_low_light', 'bright_light_distance', 'low_light_distance', 'light_angle', 'lightColor', 'dim_light_opacity'];
  const lightProps = (s, units) => ({
    emits_bright_light: s.bright > 0,
    emits_low_light: true,
    bright_light_distance: toUnits(s.bright, units),
    low_light_distance: toUnits(s.bright + s.low, units), // API: total radius
    light_angle: s.angle || 360,
    lightColor: s.color,
    dim_light_opacity: 0.3
  });
  const snapshot = (get) => { const o = {}; LIGHT.forEach((k) => { o[k] = get(k); }); return o; };
  // does the token still have the light the script set? (if not, someone changed it)
  const same = (a, b) => (typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : String(a) === String(b));
  const unchanged = (get, applied) => LIGHT.every((k) => {
    const v = get(k), w = applied[k];
    if (typeof w === 'boolean') return !!v === w;
    return same(v, w);
  });

  const parseCommand = (content) => {
    const t = String(content || '').trim();
    if (!/^!lumiere(\s|$)/i.test(t)) return null;
    return { sub: normalize(t.replace(/^!lumiere/i, '')) || 'help' };
  };

  const exportsPurs = { normalize, SOURCES, sourceOf, best, toUnits, lightProps, snapshot, unchanged, parseCommand };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsPurs;
  if (typeof on !== 'function') return; // outside Roll20: stop here

  // ================================================================== ROLL20 PART
  const etat = () => {
    const s = state[ETAT] = state[ETAT] || {};
    s.tokens = s.tokens || {}; // token id -> { saved, applied, source }
    return s;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const boite = (html) => `<div style="border:1px solid #888;background:#f4f4f4;padding:4px;border-radius:4px">${html}</div>`;
  const nomJoueur = (pid) => { const p = getObj('player', pid); return p ? String(p.get('_displayname') || '') : ''; };
  const dire = (pid, html) => {
    if (!pid || pid === 'API' || playerIsGM(pid)) return sendChat(NOM, `/w gm ${html}`, null, { noarchive: true });
    sendChat(NOM, `/w "${nomJoueur(pid)}" ${html}`, null, { noarchive: true });
  };
  const nomToken = (tok) => {
    if (tok.get('name')) return tok.get('name');
    const c = getObj('character', tok.get('represents'));
    return c ? c.get('name') : 'token sans nom';
  };
  const unites = (tok) => { const p = getObj('page', tok.get('_pageid')); return p ? p.get('scale_units') : 'm'; };

  const api = () => (typeof globalThis !== 'undefined' && globalThis.BuffTrackerAPI) || null;
  // tokens to light: id -> source
  const voulus = () => {
    const a = api(), par = new Map();
    if (!a) return new Map();
    a.buffs().forEach((b) => {
      const src = sourceOf(b.name);
      if (!src) return;
      b.targets.forEach((t) => a.tokensOf(t).filter((tok) => tok && tok.get('_subtype') === 'token').forEach((tok) => {
        par.set(tok.id, best([par.get(tok.id), src]));
      }));
    });
    return par;
  };

  let enCours = false, encore = false;
  const synchro = () => {
    if (enCours) { encore = true; return; }
    enCours = true;
    try {
      do {
        encore = false;
        const s = etat(), v = voulus();
        v.forEach((src, id) => {
          const tok = getObj('graphic', id);
          if (!tok) return;
          const e = s.tokens[id];
          if (e && e.source === src.name) return;
          const props = lightProps(src, unites(tok));
          s.tokens[id] = { saved: e ? e.saved : snapshot((k) => tok.get(k)), applied: props, source: src.name };
          tok.set(props);
        });
        Object.keys(s.tokens).forEach((id) => {
          if (v.has(id)) return;
          const tok = getObj('graphic', id);
          const e = s.tokens[id];
          delete s.tokens[id];
          if (tok && unchanged((k) => tok.get(k), e.applied)) tok.set(e.saved);
        });
      } while (encore);
    } finally { enCours = false; }
  };

  const cmdListe = (msg) => {
    if (!playerIsGM(msg.playerid)) return dire(msg.playerid, boite('Commande réservée au MJ.'));
    const s = etat();
    const lignes = Object.keys(s.tokens).map((id) => {
      const tok = getObj('graphic', id);
      return tok ? `<b>${esc(nomToken(tok))}</b> : ${esc(s.tokens[id].source)}` : '';
    }).filter(Boolean);
    dire(msg.playerid, boite(lignes.length ? lignes.join('<br>') : 'Aucun token allumé par un effet.'));
  };
  const cmdAide = (msg) => dire(msg.playerid, boite(
    'Un effet de bufftracker.js nommé comme une source de lumière allume ses cibles et les éteint à la fin : ' +
    esc(SOURCES.map((x) => x.name).join(', ')) + '.<br>' +
    `<b>${CMD} list</b> MJ : tokens allumés par un effet` +
    (api() ? '' : '<br><span style="color:#c62828">bufftracker.js n\'est pas installé.</span>')));

  on('ready', () => {
    const s = etat();
    Object.keys(s.tokens).forEach((id) => { if (!getObj('graphic', id)) delete s.tokens[id]; });
    const a = api();
    if (a) { a.observe(synchro); synchro(); }
    log(`${NOM} (lumiere.js) prêt${a ? ', lié à bufftracker.js' : ' : bufftracker.js absent'}.`);
    on('add:graphic', () => setTimeout(synchro, 500));
    on('change:graphic:represents', () => synchro());
  });

  on('chat:message', (msg) => {
    if (msg.type !== 'api') return;
    const c = parseCommand(msg.content);
    if (!c) return;
    try {
      if (c.sub === 'list') return cmdListe(msg);
      if (c.sub === 'help') return cmdAide(msg);
      dire(msg.playerid, boite(`Commande inconnue. Voir ${CMD} help.`));
    } catch (e) {
      log(`${NOM} : erreur ${e && e.stack ? e.stack : e}`);
      dire(msg.playerid, boite(`Erreur du script : ${esc(e && e.message ? e.message : e)}`));
    }
  });

  on('destroy:graphic', (tok) => { delete etat().tokens[tok.id]; });
})();
