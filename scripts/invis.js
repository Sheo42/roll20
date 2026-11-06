/*
 * invis.js — Invisible tokens for the Roll20 API
 * Version 1.0
 * Version 1.1 — a token already on its 2nd side (old Invisible macro) counts as
 *               invisible: !invis puts it back on its 1st side instead of saving the 2nd.
 *               A single "est invisible" message per character, to the player only.
 *
 * Replaces the TokenMod "Invisible" / "Visible" macros. The token switches to its
 * 2nd side (a transparent image) and its name, bars and auras are only
 * shown to the GM and to those who control it. Other players see nothing.
 * The token's light is not touched (on purpose: the PC sees the light they carry).
 * Status markers are not touched either (players use them).
 *
 * Before hiding, the script saves the token's real state (side, image, size, name,
 * bars, auras) and restores it as it was: no more hard-coded size.
 *
 * COMMANDS (options in English)
 *   !invis                 toggles the selected tokens (invisible <-> visible)
 *   !invis on | off        makes invisible / visible
 *   !invis break           ends Invisibilité (not the greater one): the character attacks
 *   !invis list            GM: the invisible tokens, with a button for each
 *   !invis help
 *   --ids id1,id2          acts on these tokens instead of the selection (buttons)
 *   A player acts on the tokens they control, the GM on all.
 *
 * WITH bufftracker.js (version 2.6 or later)
 *   An effect named Invisibilité, Invisibilité suprême or Invisibilité de groupe
 *   (or Invisibility, Greater Invisibility, Mass Invisibility) makes its targets
 *   invisible, on every page, and visible again when the effect ends. The
 *   player gets a "Rompre" button (they attack: Invisibilité ends).
 *   !invis off on a token hidden by an effect ends that effect for it.
 *
 * SETUP
 *   The token must have at least 2 sides (rollable table token): the 2nd is
 *   the transparent image. Images must come from the GM's library (not
 *   the Marketplace): the API cannot place the others.
 *
 * Data: state.Invis.
 */
(() => {
  'use strict';

  const NOM = 'Invisibilité';
  const ETAT = 'Invis';
  const CMD = '!invis';

  // ======================================================= PURE LOGIC (testable)
  const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');

  // effect names that make invisible (exact, after normalize: "Voir l'invisibilité"
  // or "Purge d'invisibilité" do not count)
  const BREAKS = ['invisibilite', 'invisibilitedegroupe', 'invisibility', 'massinvisibility'];
  const LASTS = ['invisibilitesupreme', 'invisibilitesuperieure', 'invisibilitemajeure', 'greaterinvisibility', 'improvedinvisibility'];
  const isInvisBuff = (name) => { const n = normalize(name); return BREAKS.includes(n) || LASTS.includes(n); };
  // plain invisibility ends when you attack, the greater one does not
  const breaksOnAttack = (name) => BREAKS.includes(normalize(name));

  // image the API can place: GM's library, "thumb" form (like TokenMod)
  const cleanImgsrc = (src) => {
    const m = String(src || '').match(/(.*\/images\/.*)(thumb|med|original|max)([^?]*)(\?[^?]+)?$/);
    return m ? `${m[1]}thumb${m[3]}${m[4] || `?${Math.round(Math.random() * 9999999)}`}` : null;
  };
  // n: side 1, 2...; sides = images separated by "|", encoded
  const sideImage = (sides, n) => {
    const l = String(sides || '').split('|').filter(Boolean);
    if (l.length < n) return null;
    let src = l[n - 1];
    try { src = decodeURIComponent(src); } catch (e) { /* already decoded */ }
    return cleanImgsrc(src);
  };

  const SHOWN = ['showplayers_name', 'showplayers_bar1', 'showplayers_bar2', 'showplayers_bar3', 'showplayers_aura1', 'showplayers_aura2'];
  // what we save before hiding
  const snapshot = (get) => {
    const o = { currentside: get('currentside') || 0, imgsrc: get('imgsrc'), width: get('width'), height: get('height') };
    SHOWN.forEach((k) => { o[k] = !!get(k); });
    return o;
  };
  const hiddenProps = (img) => {
    const o = { currentside: 1, imgsrc: img };
    SHOWN.forEach((k) => { o[k] = false; });
    return o;
  };
  const restoreProps = (saved) => {
    const o = { currentside: saved.currentside, imgsrc: saved.imgsrc, width: saved.width, height: saved.height };
    SHOWN.forEach((k) => { o[k] = !!saved[k]; });
    return o;
  };

  // token found already hidden (old macro: 2nd side, no saved state): what to
  // restore = its 1st side, name and bar 1 visible (like the old Visible macro)
  const visibleFromHidden = (snap, side1) => Object.assign({}, snap,
    { currentside: 0, imgsrc: side1, showplayers_name: true, showplayers_bar1: true });

  // "!invis off --ids a,b" -> {sub:'off', ids:['a','b']}; other command -> null
  const parseCommand = (content) => {
    const t = String(content || '').trim();
    if (!/^!invis(\s|$)/i.test(t)) return null;
    const parts = t.split(/\s+--/);
    const sub = normalize(parts[0].replace(/^!invis/i, '')) || 'toggle';
    let ids = null;
    parts.slice(1).forEach((p) => {
      const m = p.match(/^ids\s+(.+)$/i);
      if (m) ids = m[1].split(/[,\s]+/).filter(Boolean);
    });
    return { sub, ids };
  };

  const exportsPurs = { normalize, isInvisBuff, breaksOnAttack, cleanImgsrc, sideImage, snapshot, hiddenProps, restoreProps, visibleFromHidden, parseCommand };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsPurs;
  if (typeof on !== 'function') return; // outside Roll20: stop here

  // ============================================================== ROLL20 PART
  const etat = () => {
    const s = state[ETAT] = state[ETAT] || {};
    s.tokens = s.tokens || {}; // token id -> { saved, reason: 'manual' | 'buff' }
    return s;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const STYLE_BOITE = 'border:1px solid #888;background:#f4f4f4;padding:4px;border-radius:4px';
  const boite = (html) => `<div style="${STYLE_BOITE}">${html}</div>`;
  const bouton = (txt, cmd) => `<a style="background:#555;color:#fff;padding:1px 5px;border-radius:3px;margin:1px" href="${cmd}">${esc(txt)}</a>`;
  const liste = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
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
  const controleurs = (tok) => {
    const c = getObj('character', tok.get('represents'));
    return liste(tok.get('controlledby')).concat(c ? liste(c.get('controlledby')) : []);
  };
  const controle = (pid, tok) => playerIsGM(pid) || controleurs(tok).some((x) => x === pid || x === 'all');
  // notifies those who control the token (the GM always)
  // notifies the players who control the token; the GM only if no player does
  // (the GM already sees bufftracker's announcement)
  const prevenir = (tok, html) => {
    const pids = [...new Set(controleurs(tok).filter((x) => x !== 'all'))].filter((p) => !playerIsGM(p));
    if (!pids.length) return dire(null, html);
    pids.forEach((p) => dire(p, html));
  };

  // hides the token; returns an error text, or '' if done
  // token already on its 2nd side without a saved state (old macro): we take it over
  const adopter = (tok) => {
    const s = etat();
    if (s.tokens[tok.id] || Number(tok.get('currentside')) !== 1) return;
    const side1 = sideImage(tok.get('sides'), 1);
    if (!side1) return;
    s.tokens[tok.id] = { saved: visibleFromHidden(snapshot((k) => tok.get(k)), side1), reason: 'manual' };
  };
  const cacher = (tok, reason) => {
    const s = etat();
    adopter(tok);
    const deja = s.tokens[tok.id];
    if (deja) { if (reason === 'buff') deja.reason = 'buff'; return ''; }
    const img = sideImage(tok.get('sides'), 2);
    if (!img) return `${nomToken(tok)} n'a pas de 2e face utilisable (token à faces multiples, image de ta bibliothèque).`;
    const saved = snapshot((k) => tok.get(k));
    saved.imgsrc = cleanImgsrc(saved.imgsrc) || sideImage(tok.get('sides'), saved.currentside + 1);
    if (!saved.imgsrc) return `${nomToken(tok)} : son image vient du Marketplace, l'API ne pourrait pas la remettre.`;
    s.tokens[tok.id] = { saved, reason };
    tok.set(hiddenProps(img));
    return '';
  };
  const montrer = (tok) => {
    const s = etat();
    const e = s.tokens[tok.id];
    if (!e) return false;
    tok.set(restoreProps(e.saved));
    delete s.tokens[tok.id];
    return true;
  };

  // ---- bufftracker.js
  const api = () => (typeof globalThis !== 'undefined' && globalThis.BuffTrackerAPI) || null;
  const signales = new Set(); // tokens without a 2nd side already reported to the GM
  // tokens that invisibility effects want to hide: id -> effect name
  const voulus = () => {
    const a = api(), out = new Map();
    if (!a) return out;
    a.buffs().filter((b) => isInvisBuff(b.name)).forEach((b) => b.targets.forEach((t) => {
      a.tokensOf(t).filter((tok) => tok && tok.get('_subtype') === 'token').forEach((tok) => {
        if (!out.has(tok.id) || !breaksOnAttack(b.name)) out.set(tok.id, b.name);
      });
    }));
    return out;
  };
  let enCours = false, encore = false;
  const synchro = () => {
    if (enCours) { encore = true; return; }
    enCours = true;
    try {
      do {
        encore = false;
        const s = etat(), v = voulus();
        const nouveaux = new Map(), avertis = new Set();
        v.forEach((nomEffet, id) => {
          const tok = getObj('graphic', id);
          if (!tok) return;
          const deja = s.tokens[id];
          if (deja) { deja.reason = 'buff'; return; }
          const err = cacher(tok, 'buff');
          if (err) {
            const cleErr = tok.get('represents') || id;
            if (!signales.has(id) && !avertis.has(cleErr)) dire(null, boite(`${esc(nomEffet)} : ${esc(err)}`));
            signales.add(id);
            avertis.add(cleErr);
            return;
          }
          // a single message per character, even if they have tokens on several pages
          const cle = tok.get('represents') || id;
          if (!nouveaux.has(cle)) nouveaux.set(cle, { tok, nomEffet });
        });
        nouveaux.forEach(({ tok, nomEffet }) => prevenir(tok, boite(`<b>${esc(nomToken(tok))}</b> est invisible (${esc(nomEffet)}).` +
          (breaksOnAttack(nomEffet) ? ` ${bouton('Rompre', `${CMD} break --ids ${tok.id}`)}` : ''))));
        [...signales].forEach((id) => { if (!v.has(id)) signales.delete(id); });
        Object.keys(s.tokens).forEach((id) => {
          if (s.tokens[id].reason !== 'buff' || v.has(id)) return;
          const tok = getObj('graphic', id);
          if (tok) montrer(tok); else delete s.tokens[id];
        });
      } while (encore);
    } finally { enCours = false; }
  };
  // ends the invisibility effects of this token (it attacks, or !invis off)
  // only: those that end on attacking ("Rompre" button)
  const finirEffets = (tok, seulement) => {
    const a = api();
    if (!a) return 0;
    return a.endTargets((b, t) => isInvisBuff(b.name) && (!seulement || breaksOnAttack(b.name)) &&
      a.tokensOf(t).some((x) => x && x.id === tok.id));
  };

  // ---- commands
  const tokensDuMessage = (msg, c) => (c.ids ? c.ids.map((id) => getObj('graphic', id)) : (msg.selected || []).map((x) => getObj('graphic', x._id)))
    .filter((t) => t && t.get('_subtype') === 'token');

  const cmdBascule = (msg, c) => {
    const pid = msg.playerid;
    const toks = tokensDuMessage(msg, c);
    if (!toks.length) return dire(pid, boite('Sélectionne un token (ou !invis help).'));
    const faits = [], erreurs = [];
    toks.forEach((tok) => {
      if (!controle(pid, tok)) return erreurs.push(`Tu ne contrôles pas ${nomToken(tok)}.`);
      adopter(tok);
      const cache = !!etat().tokens[tok.id];
      const veut = c.sub === 'on' ? true : c.sub === 'off' ? false : !cache;
      if (c.sub === 'break') {
        const n = finirEffets(tok, true);
        if (!n) return erreurs.push(`${nomToken(tok)} n'a pas d'invisibilité qui se rompt en attaquant.`);
        return faits.push(`${nomToken(tok)} : invisibilité rompue${etat().tokens[tok.id] ? ' (reste invisible : Invisibilité suprême)' : ''}`);
      }
      if (veut === cache) return faits.push(`${nomToken(tok)} est déjà ${cache ? 'invisible' : 'visible'}`);
      if (veut) {
        const err = cacher(tok, 'manual');
        return err ? erreurs.push(err) : faits.push(`${nomToken(tok)} est invisible`);
      }
      const n = etat().tokens[tok.id].reason === 'buff' ? finirEffets(tok) : 0;
      montrer(tok);
      faits.push(`${nomToken(tok)} est visible${n ? ' (fin de son invisibilité)' : ''}`);
    });
    dire(pid, boite(faits.map(esc).concat(erreurs.map((e) => `<span style="color:#c62828">${esc(e)}</span>`)).join('<br>')));
  };

  const cmdListe = (msg) => {
    if (!playerIsGM(msg.playerid)) return dire(msg.playerid, boite('Commande réservée au MJ.'));
    const s = etat();
    const lignes = Object.keys(s.tokens).map((id) => {
      const tok = getObj('graphic', id);
      if (!tok) return '';
      const p = getObj('page', tok.get('_pageid'));
      return `<b>${esc(nomToken(tok))}</b> (${esc(p ? p.get('name') : '?')}${s.tokens[id].reason === 'buff' ? ', effet' : ''}) ` +
        bouton('Visible', `${CMD} off --ids ${id}`);
    }).filter(Boolean);
    dire(msg.playerid, boite(lignes.length ? lignes.join('<br>') : 'Aucun token invisible.'));
  };

  const cmdAide = (msg) => dire(msg.playerid, boite(
    `<b>${CMD}</b> bascule les tokens sélectionnés (invisible / visible)<br>` +
    `<b>${CMD} on</b> | <b>off</b> rend invisible / visible<br>` +
    `<b>${CMD} break</b> rompt l'Invisibilité (attaque)<br>` +
    `<b>${CMD} list</b> MJ : tokens invisibles<br>` +
    'Le token doit avoir une 2e face transparente. Avec bufftracker.js, les effets Invisibilité et Invisibilité suprême sont appliqués tout seuls.'));

  // ------------------------------------------------------------------ events
  on('ready', () => {
    const s = etat();
    Object.keys(s.tokens).forEach((id) => { if (!getObj('graphic', id)) delete s.tokens[id]; });
    const a = api();
    if (a) { a.observe(synchro); synchro(); }
    log(`${NOM} (invis.js) ready: ${Object.keys(s.tokens).length} invisible token(s)${a ? ', linked to bufftracker.js' : ''}.`);

    // a token placed (or linked to its sheet) of an invisible character becomes invisible
    on('add:graphic', () => setTimeout(synchro, 500));
    on('change:graphic:represents', () => synchro());
  });

  on('chat:message', (msg) => {
    if (msg.type !== 'api') return;
    const c = parseCommand(msg.content);
    if (!c) return;
    try {
      switch (c.sub) {
        case 'toggle': case 'on': case 'off': case 'break': return cmdBascule(msg, c);
        case 'list': return cmdListe(msg);
        case 'help': return cmdAide(msg);
        default: return dire(msg.playerid, boite(`Commande inconnue : ${esc(c.sub)}. Voir ${CMD} help.`));
      }
    } catch (e) {
      log(`${NOM}: error ${e && e.stack ? e.stack : e}`);
      dire(msg.playerid, boite(`Erreur du script : ${esc(e && e.message ? e.message : e)}`));
    }
  });

  on('destroy:graphic', (tok) => { delete etat().tokens[tok.id]; });
})();
