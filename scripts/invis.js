/*
 * invis.js — Tokens invisibles pour l'API Roll20
 * Version 1.0
 * Version 1.1 — un token déjà sur sa 2e face (ancienne macro Invisible) compte comme
 *               invisible : !invis le remet sur sa 1re face au lieu de noter la 2e.
 *
 * Remplace les macros TokenMod « Invisible » / « Visible ». Le token passe sur sa
 * 2e face (une image transparente) et son nom, ses barres et ses auras ne sont plus
 * montrés qu'au MJ et à ceux qui le contrôlent. Les autres joueurs ne voient rien.
 * La lumière du token n'est pas touchée (voulu : le PJ voit la lumière qu'il porte).
 * Les marqueurs d'état ne sont pas touchés non plus (les joueurs s'en servent).
 *
 * Avant de cacher, le script note l'état réel du token (face, image, taille, nom,
 * barres, auras) et le remet tel quel au retour : plus de taille écrite en dur.
 *
 * COMMANDES (options en anglais)
 *   !invis                 bascule les tokens sélectionnés (invisible <-> visible)
 *   !invis on | off        rend invisible / visible
 *   !invis break           termine l'Invisibilité (pas la suprême) : le personnage attaque
 *   !invis list            MJ : les tokens invisibles, avec un bouton pour chacun
 *   !invis help
 *   --ids id1,id2          agit sur ces tokens au lieu de la sélection (boutons)
 *   Un joueur agit sur les tokens qu'il contrôle, le MJ sur tous.
 *
 * AVEC bufftracker.js (version 2.6 ou plus)
 *   Un effet nommé Invisibilité, Invisibilité suprême ou Invisibilité de groupe
 *   (ou Invisibility, Greater Invisibility, Mass Invisibility) rend ses cibles
 *   invisibles, sur toutes les cartes, et visibles à la fin de l'effet. Le
 *   joueur reçoit un bouton « Rompre » (il attaque : l'Invisibilité se termine).
 *   !invis off sur un token caché par un effet termine cet effet pour lui.
 *
 * MISE EN PLACE
 *   Le token doit avoir au moins 2 faces (token à faces multiples) : la 2e est
 *   l'image transparente. Les images doivent venir de la bibliothèque du MJ (pas
 *   du Marketplace) : l'API ne peut pas poser les autres.
 *
 * Données : state.Invis.
 */
(() => {
  'use strict';

  const NOM = 'Invisibilité';
  const ETAT = 'Invis';
  const CMD = '!invis';

  // ======================================================= LOGIQUE PURE (testable)
  const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');

  // noms d'effets qui rendent invisible (exacts, après normalize : « Voir l'invisibilité »
  // ou « Purge d'invisibilité » ne comptent pas)
  const BREAKS = ['invisibilite', 'invisibilitedegroupe', 'invisibility', 'massinvisibility'];
  const LASTS = ['invisibilitesupreme', 'invisibilitesuperieure', 'invisibilitemajeure', 'greaterinvisibility', 'improvedinvisibility'];
  const isInvisBuff = (name) => { const n = normalize(name); return BREAKS.includes(n) || LASTS.includes(n); };
  // l'invisibilité simple se termine quand on attaque, pas la suprême
  const breaksOnAttack = (name) => BREAKS.includes(normalize(name));

  // image posable par l'API : bibliothèque du MJ, forme « thumb » (comme TokenMod)
  const cleanImgsrc = (src) => {
    const m = String(src || '').match(/(.*\/images\/.*)(thumb|med|original|max)([^?]*)(\?[^?]+)?$/);
    return m ? `${m[1]}thumb${m[3]}${m[4] || `?${Math.round(Math.random() * 9999999)}`}` : null;
  };
  // n : face 1, 2... ; sides = images séparées par « | », encodées
  const sideImage = (sides, n) => {
    const l = String(sides || '').split('|').filter(Boolean);
    if (l.length < n) return null;
    let src = l[n - 1];
    try { src = decodeURIComponent(src); } catch (e) { /* déjà décodée */ }
    return cleanImgsrc(src);
  };

  const SHOWN = ['showplayers_name', 'showplayers_bar1', 'showplayers_bar2', 'showplayers_bar3', 'showplayers_aura1', 'showplayers_aura2'];
  // ce qu'on note avant de cacher
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

  // token trouvé déjà caché (ancienne macro : 2e face, sans état noté) : ce qu'il faut
  // remettre = sa 1re face, nom et barre 1 visibles (comme l'ancienne macro Visible)
  const visibleFromHidden = (snap, side1) => Object.assign({}, snap,
    { currentside: 0, imgsrc: side1, showplayers_name: true, showplayers_bar1: true });

  // "!invis off --ids a,b" -> {sub:'off', ids:['a','b']} ; autre commande -> null
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
  if (typeof on !== 'function') return; // hors Roll20 : on s'arrête ici

  // ============================================================== PARTIE ROLL20
  const etat = () => {
    const s = state[ETAT] = state[ETAT] || {};
    s.tokens = s.tokens || {}; // id du token -> { saved, reason: 'manual' | 'buff' }
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
  // prévient ceux qui contrôlent le token (le MJ toujours)
  const prevenir = (tok, html) => {
    const pids = [...new Set(controleurs(tok).filter((x) => x !== 'all'))].filter((p) => !playerIsGM(p));
    pids.forEach((p) => dire(p, html));
    dire(null, html);
  };

  // cache le token ; renvoie un texte d'erreur, ou '' si c'est fait
  // token déjà sur sa 2e face sans état noté (ancienne macro) : on le prend en charge
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
  const signales = new Set(); // tokens sans 2e face déjà signalés au MJ
  // tokens que les effets d'invisibilité veulent cacher : id -> nom de l'effet
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
        v.forEach((nomEffet, id) => {
          const tok = getObj('graphic', id);
          if (!tok) return;
          const deja = s.tokens[id];
          if (deja) { deja.reason = 'buff'; return; }
          const err = cacher(tok, 'buff');
          if (err) {
            if (!signales.has(id)) dire(null, boite(`${esc(nomEffet)} : ${esc(err)}`));
            signales.add(id);
            return;
          }
            prevenir(tok, boite(`<b>${esc(nomToken(tok))}</b> est invisible (${esc(nomEffet)}).` +
            (breaksOnAttack(nomEffet) ? ` ${bouton('Rompre', `${CMD} break --ids ${id}`)}` : '')));
        });
        [...signales].forEach((id) => { if (!v.has(id)) signales.delete(id); });
        Object.keys(s.tokens).forEach((id) => {
          if (s.tokens[id].reason !== 'buff' || v.has(id)) return;
          const tok = getObj('graphic', id);
          if (tok) montrer(tok); else delete s.tokens[id];
        });
      } while (encore);
    } finally { enCours = false; }
  };
  // termine les effets d'invisibilité de ce token (il attaque, ou !invis off)
  // seulement : celles qui se terminent en attaquant (bouton « Rompre »)
  const finirEffets = (tok, seulement) => {
    const a = api();
    if (!a) return 0;
    return a.endTargets((b, t) => isInvisBuff(b.name) && (!seulement || breaksOnAttack(b.name)) &&
      a.tokensOf(t).some((x) => x && x.id === tok.id));
  };

  // ---- commandes
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

  // ------------------------------------------------------------------ évènements
  on('ready', () => {
    const s = etat();
    Object.keys(s.tokens).forEach((id) => { if (!getObj('graphic', id)) delete s.tokens[id]; });
    const a = api();
    if (a) { a.observe(synchro); synchro(); }
    log(`${NOM} (invis.js) prêt : ${Object.keys(s.tokens).length} token(s) invisible(s)${a ? ', lié à bufftracker.js' : ''}.`);

    // un token posé (ou relié à sa fiche) d'un personnage invisible devient invisible
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
      log(`${NOM} : erreur ${e && e.stack ? e.stack : e}`);
      dire(msg.playerid, boite(`Erreur du script : ${esc(e && e.message ? e.message : e)}`));
    }
  });

  on('destroy:graphic', (tok) => { delete etat().tokens[tok.id]; });
})();
