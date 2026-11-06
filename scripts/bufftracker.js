/*
 * bufftracker.js — Tracks buffs and spell durations (Pathfinder 1e) for the Roll20 API
 * Version 2.0 — a cast carries a list of targets (a spell cast on several allies =
 *               one line); targets picked by name or with check buttons; direct
 *               link to the "Effets actifs" window.
 * Version 2.1 — no more status marker on tokens (older ones are removed).
 * Version 2.2 — no page needed: targets and caster by sheet or by free name.
 * Version 2.3 — check buttons fixed; minutes written "min"; a player who is only
 *               targeted removes only their own characters.
 * Version 2.4 — a partial name is no longer guessed: buttons to choose; durations in days.
 * Version 2.5 — recasting a spell only replaces the one from the same caster; the same
 *               spell from two casters: one line per character (the longest), and no
 *               end announcement while another cast still covers it.
 * Version 2.6 — common spell "Invisibilité suprême"; BuffTrackerAPI interface for
 *               other scripts (invis.js hides invisible tokens).
 * Version 2.7 — common spells Lumière, Lumière du jour, Lumières dansantes (lumiere.js
 *               lights and turns off the targeted tokens).
 *
 * SETUP (once)
 *   1. Paste this file into a new API script, save.
 *   2. Create the "Buffs" macro (visible to all, in the macro bar): !buff
 *   The script creates the "Effets actifs" handout, visible to all players.
 *
 * WHAT PLAYERS SEE
 *   - The "Effets actifs" window (a handout, sorted by character): keep it open
 *     next to the map; the script rewrites it on every change. The menu's
 *     "Ouvrir la fenêtre" button and the link in announcements open it
 *     directly, without going through the journal. Hidden effects only appear
 *     in the GM part of the handout.
 *   - No status marker on tokens: players use them for something else.
 *   - A chat announcement on an effect's last round, then when it ends.
 *
 * WHAT PLAYERS DO
 *   Click "Buffs": whispered menu, one line per cast with its targets and
 *   buttons (-1, +1, Durée, Effet, Cibles, X). "Ajouter" and "Sorts courants"
 *   ask for the caster (the selected token, otherwise your character) then the targets:
 *     Tout le groupe   the PCs on your page (no page, or no PC on it:
 *                      all PCs in the game)
 *     Moi seul         the caster
 *     Tokens sélectionnés
 *     Choisir...       check buttons, one per PC, then "Valider"
 *   In Roll20 a player can only select their own tokens: for an ally, use
 *   "Tout le groupe" or "Choisir...".
 *
 * COUNTDOWN
 *   Everything is counted in rounds: 1 min = 10 rounds, 1 h = 600 rounds.
 *   - In combat: when the turn tracker moves to the next turn, the effects whose
 *     caster takes their turn lose 1 round (PF1 rule: an effect ends just before
 *     its caster's turn). If the caster is not in the tracker, or there is no
 *     caster, the effect loses 1 round at the start of each round.
 *     Start of round: a custom tracker entry whose text contains the word
 *     "round" or "tour" comes to the top; without one, the initiative goes back up
 *     (tracker sorted in descending order). Filling or sorting the tracker, or moving
 *     someone in it, counts nothing. Going back does not give the round back, but
 *     moving to the same turn again afterwards does not count it a second time.
 *   - Out of combat: the GM advances time with !buff time 10min.
 *   An effect that reaches 0 is removed and announced.
 *
 * COMMANDS (options in English)
 *   !buff                         menu (casts of the selected tokens, otherwise yours)
 *   !buff add --name Bénédiction --dur 5min [--caster Solathia] [--targets group]
 *             [--effect +1 attaque] [--hidden]
 *       --targets: group, me, selected, pick, or token names or ids separated
 *       by commas (Selea, Paz). Without --targets: the selected tokens, otherwise
 *       the check buttons. Durations: 3r, 3 (rounds), 10min, 2h, 1j, perm (until
 *       removed). Recasting an effect with the same name and caster replaces the
 *       old one on the new cast's targets; from another caster, both stay, each
 *       with its own duration.
 *   !buff add --spell bless --cl 5 [--caster Solathia] [--targets group]   common spell
 *   !buff fav                     common spell buttons
 *   !buff edit 3 --dur -1         -1 round (or +2, 4r, 10min, perm); also --name,
 *                                 --effect, --caster, --targets (as for add),
 *                                 --hidden yes|no (GM)
 *   !buff pick toggle|all|none|ok|cancel   check buttons (sent by the script)
 *   !buff choose 2|free|cancel    choice for a partial name (sent by the script)
 *   !buff remove 3 [4 ...]        removes casts: dry run, then ... confirm N
 *   !buff clear                   removes the selected tokens from all their effects
 *                                 (dry run, then confirm N)
 *   !buff clear all               GM: all effects (dry run, then confirm N)
 *   !buff time 10min                GM: passes time (dry run, then confirm N);
 *                                 "Passer le temps" button in the GM menu
 *   !buff show                    updates the handout and gives the link to open it
 *   !buff help
 *   Changes to a single cast (edit) apply at once: they can be undone with
 *   one click. Removals and passing time go through a dry run.
 *
 * PERMISSIONS
 *   Anyone can cast an effect on anyone. A player edits or removes the casts
 *   they created and those whose caster they control. From a cast that only
 *   targets one of their characters, they can only remove their characters
 *   ("Me retirer" button, or !buff clear on their token). The GM manages everything,
 *   and only the GM creates hidden effects (--hidden).
 *
 * TARGETS
 *   A token linked to a sheet (a bar linked to an attribute, like PCs): the effect
 *   follows the CHARACTER, on every page. An unlinked token (numbered monsters):
 *   the effect follows that token only; if the token is deleted, it leaves the effect.
 *   A name (target or caster) must be exact (case and accents ignored): a token on the
 *   page, otherwise a sheet in the game. If it is only part of other names ("Moi"
 *   for "Moine noir"), the script asks which one with buttons, including "Nom libre".
 *   Otherwise it is a free name (an NPC played without a page or sheet), tracked by name.
 *   "=Moi" forces the free name without asking.
 *   "PC" = a character controlled by at least one player.
 *
 * OTHER SCRIPTS
 *   globalThis.BuffTrackerAPI: observe(fn) calls fn(buffs) after every change;
 *   buffs(); tokensOf(target); endTargets(fn(buff, target) -> true) removes these targets
 *   from their effects and announces the end. Used by invis.js and lumiere.js.
 *
 * Data: state.BuffTracker. Does not touch character sheets.
 */
(() => {
  'use strict';

  const NOM = 'Buffs';
  const ETAT = 'BuffTracker';
  const HANDOUT = 'Effets actifs';
  const CMD = '!buff';

  // ======================================================= PURE LOGIC (testable)

  // ---- durations (always in rounds)
  const UNITE = { r: 1, m: 10, h: 600, d: 14400 };
  const ALIAS_UNITE = {
    r: 'r', rd: 'r', rds: 'r', round: 'r', rounds: 'r', tour: 'r', tours: 'r',
    m: 'm', mn: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm',
    h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h', heure: 'h', heures: 'h',
    d: 'd', day: 'd', days: 'd', j: 'd', jour: 'd', jours: 'd'
  };
  const PERMANENT = ['perm', 'permanent', 'inf', 'infinite', 'none', '-'];

  // "3r" -> {rounds:3, sign:0} ; "-1" -> {rounds:1, sign:-1} ; "perm" -> {rounds:null} ;
  // invalid -> null
  const parseDuration = (txt) => {
    if (txt === undefined || txt === null || txt === true) return null;
    const t = String(txt).trim().toLowerCase();
    if (!t) return null;
    if (PERMANENT.includes(t)) return { rounds: null, sign: 0 };
    const m = t.match(/^([+-])?\s*(\d+(?:[.,]\d+)?)\s*([a-z]*)$/);
    if (!m) return parseCompound(t);
    const u = m[3] ? ALIAS_UNITE[m[3]] : 'r';
    if (!u) return null;
    const rounds = Math.round(parseFloat(m[2].replace(',', '.')) * UNITE[u]);
    return { rounds, sign: m[1] === '-' ? -1 : (m[1] === '+' ? 1 : 0) };
  };
  // duration in several parts: "13h50" (13 h 50 min), "1j2h", "2h 30min",
  // "1min 5r". A number without a unit at the end takes the next unit (after h: min,
  // after j: h, after min: rounds).
  const UNITE_SUIVANTE = { d: 'h', h: 'm', m: 'r' };
  const parseCompound = (t) => {
    const g = t.match(/^([+-])?\s*(.+)$/);
    const parts = [...g[2].matchAll(/(\d+)\s*([a-z]*)\s*/g)];
    if (!parts.length || parts.map((p) => p[0]).join('') !== g[2]) return null;
    let rounds = 0, prec = null;
    for (let i = 0; i < parts.length; i++) {
      let u = parts[i][2] ? ALIAS_UNITE[parts[i][2]] : null;
      if (!u) {
        if (parts[i][2] || i !== parts.length - 1 || !prec || !UNITE_SUIVANTE[prec]) return null;
        u = UNITE_SUIVANTE[prec];
      }
      if (prec && UNITE[u] >= UNITE[prec]) return null; // units in order: j, h, min, r
      rounds += parseInt(parts[i][1], 10) * UNITE[u];
      prec = u;
    }
    return { rounds, sign: g[1] === '-' ? -1 : (g[1] === '+' ? 1 : 0) };
  };

  // 4 -> "4 rd" ; 95 -> "9 min 5 rd" ; 630 -> "1 h 3 min" ; null -> "permanent"
  const formatDuration = (r) => {
    if (r === null || r === undefined) return 'permanent';
    if (r < 10) return `${r} rd`;
    if (r < 600) {
      const min = Math.floor(r / 10), rd = r % 10;
      return rd ? `${min} min ${rd} rd` : `${min} min`;
    }
    if (r < 14400) {
      const h = Math.floor(r / 600), min = Math.floor((r % 600) / 10);
      return min ? `${h} h ${min} min` : `${h} h`;
    }
    const j = Math.floor(r / 14400), h = Math.floor((r % 14400) / 600);
    return h ? `${j} j ${h} h` : `${j} j`;
  };

  // short form, readable again by parseDuration (default value of the buttons)
  const compactDuration = (r) => {
    if (r === null || r === undefined) return 'perm';
    if (r && r % 14400 === 0) return `${r / 14400}j`;
    if (r && r % 600 === 0) return `${r / 600}h`;
    if (r && r % 10 === 0) return `${r / 10}min`;
    return `${r}r`;
  };

  const normalize = (s) => String(s === undefined || s === null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  // HTML-safe for chat and handouts; [ ] { } escaped so that Roll20 sees
  // neither an inline roll nor a query in them
  const escapeHtml = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/\[/g, '&#91;').replace(/\]/g, '&#93;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
    .replace(/\r?\n/g, ' ');

  // default value of a ?{...|default} query: without the characters that would
  // break it (the browser decodes HTML entities in href before Roll20 does)
  const pourRequete = (s) => String(s || '').replace(/[{}|[\]"<>@&,]/g, ' ').replace(/\s+/g, ' ').trim();

  // ---- command
  // "!buff edit 3 --dur -1 confirm 2" -> {sub:'edit', args:['3'], opts:{dur:'-1'}, confirm:2}
  const parseCommand = (content) => {
    let s = String(content || '').trim();
    if (!/^!buff(\s|$)/i.test(s)) return null;
    s = s.replace(/^!buff/i, '').trim();
    let confirm = null;
    const cm = s.match(/(?:^|\s)confirm\s+(\d+)\s*$/i);
    if (cm) { confirm = parseInt(cm[1], 10); s = s.slice(0, cm.index).trim(); }
    const parts = (' ' + s).split(/\s--(?=\S)/);
    const head = parts.shift().trim();
    const words = head ? head.split(/\s+/) : [];
    const opts = {};
    parts.forEach((p) => {
      const m = p.match(/^(\S+)(?:\s+([\s\S]*))?$/);
      if (!m) return;
      opts[m[1].toLowerCase()] = m[2] === undefined ? true : m[2].trim();
    });
    if (opts.target !== undefined && opts.targets === undefined) opts.targets = opts.target;
    delete opts.target;
    return { sub: (words.shift() || 'menu').toLowerCase(), args: words, opts, confirm };
  };

  // text value of an option; a query left empty at the end of the command arrives
  // as an option without a value (true): it is an empty string
  const texte = (v) => (v === true ? '' : (typeof v === 'string' ? v.trim() : undefined));

  // "yes"/"no" for --hidden; true (option without a value) = yes
  const parseBool = (v) => {
    if (v === true) return true;
    const t = normalize(v);
    if (['yes', 'y', 'on', 'true', '1', ''].includes(t)) return true;
    if (['no', 'n', 'off', 'false', '0'].includes(t)) return false;
    return null;
  };

  // --targets: one of the reserved words, or a list of names / ids
  const TARGET_MODES = ['group', 'me', 'selected', 'pick'];
  const parseTargets = (v) => {
    const t = texte(v);
    if (t === undefined || t === '') return { mode: 'default' };
    if (TARGET_MODES.includes(normalize(t))) return { mode: normalize(t) };
    const names = t.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    return names.length ? { mode: 'names', names } : { mode: 'default' };
  };

  // ---- entities: {kind:'char'|'token', id}
  // key "char.-Mabc": no ":", Roll20 strips links that look like an address
  // (char:...) from chat buttons, and the button stops working
  const entityKey = (e) => `${e.kind}.${e.id}`;
  const lireCle = (k) => String(k || '').replace(/^(char|token|name):/, '$1.');
  const sameEntity = (a, b) => !!(a && b && a.kind === b.kind && a.id === b.id);

  // ---- countdown
  // Removes n rounds from the chosen effects. Returns those that expire (0) and those
  // that reach their last round (1). Permanent effects do not change.
  const tick = (buffs, pred, n) => {
    const expired = [], warned = [];
    buffs.forEach((b) => {
      if (b.remaining === null || b.remaining === undefined) return;
      if (!pred(b)) return;
      const old = b.remaining;
      b.remaining = Math.max(0, old - n);
      if (b.remaining === 0) expired.push(b);
      else if (old > 1 && b.remaining === 1) warned.push(b);
    });
    return { expired, warned };
  };

  // Did the tracker move forward one turn (first one moved to the end), back, or something else?
  const cleEntree = (e) => String(e && e.id) + '|' + String((e && e.custom) || '');
  const memesCles = (a, b) => a.length === b.length && a.every((e, i) => cleEntree(e) === cleEntree(b[i]));
  const detectAdvance = (prev, next) => {
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length < 2 || prev.length !== next.length) return 'other';
    if (memesCles(prev.slice(1).concat([prev[0]]), next)) return 'forward';
    if (memesCles([prev[prev.length - 1]].concat(prev.slice(0, -1)), next)) return 'backward';
    return 'other';
  };

  // Custom entry that marks the start of the round: its text contains the word
  // "round" or "tour" ("Round", "Tour 3", "-- Début du round --"...)
  const estPerso = (e) => String(e && e.id) === '-1';
  const isRoundEntry = (e) => estPerso(e) && /(^|[^a-z])(round|tour)s?([^a-z]|$)/.test(normalize(e.custom));
  // Start of a new round (call only after a forward move): the round entry
  // comes to the top, or, without one, the initiative goes back up (descending order:
  // we are back at the highest). Other custom entries (torch...) are ignored.
  const isNewRound = (prev, next) => {
    if (!next || !next.length) return false;
    const idx = next.findIndex(isRoundEntry);
    if (idx >= 0) return idx === 0;
    if (estPerso(next[0])) return false;
    let j = next.length - 1; // the token that just played
    while (j > 0 && estPerso(next[j])) j--;
    if (j <= 0) return false;
    const a = parseFloat(next[j].pr), b = parseFloat(next[0].pr);
    return !isNaN(a) && !isNaN(b) && b > a;
  };

  // ---- status markers: the script no longer sets any (players use them for
  // something else). Removes from a statusmarkers string those an older version
  // set (owned); the token's other markers do not change.
  const stripMarkers = (current, owned) => {
    const mine = new Set(owned || []);
    return String(current || '').split(',').filter((m) => m && !mine.has(m.split('@')[0])).join(',');
  };

  // ---- search by name (accents and case ignored): equal, then starts with, then contains
  const resolveByName = (query, candidates) => {
    const q = normalize(query);
    if (!q) return [];
    for (const test of [(n) => n === q, (n) => n.startsWith(q), (n) => n.includes(q)]) {
      const found = candidates.filter((c) => test(normalize(c.name)));
      if (found.length) return found;
    }
    return [];
  };

  // ---- recast: the new cast replaces the old one on its targets (no stacking).
  // Removes these targets from casts with the same name and caster (and same
  // visibility); the same spell from another caster keeps its own duration. Returns the
  // recast targets and the list without the casts that became empty.
  const memeLanceur = (a, b) => {
    if (!a || !b) return !a && !b;
    if (a.id && b.id && a.kind && b.kind) return sameEntity(a, b);
    return normalize(a.name) === normalize(b.name);
  };
  const replaceTargets = (buffs, name, hidden, targets, caster) => {
    const keys = new Set(targets.map(entityKey));
    const relaunched = [];
    buffs.forEach((b) => {
      if (normalize(b.name) !== normalize(name) || !!b.hidden !== !!hidden || !memeLanceur(b.caster, caster)) return;
      b.targets = b.targets.filter((t) => {
        if (!keys.has(entityKey(t))) return true;
        if (!relaunched.some((r) => sameEntity(r, t))) relaunched.push(t);
        return false;
      });
    });
    return { buffs: buffs.filter((b) => b.targets.length), relaunched };
  };

  // ---- common spells: duration = caster level x unit (or fixed duration)
  const FAVORITES = [
    { key: 'bless', name: 'Bénédiction', per: 'm', mult: 1, effect: '+1 moral attaque et JS contre la terreur' },
    { key: 'prayer', name: 'Prière', per: 'r', mult: 1, effect: '+1 chance alliés, -1 ennemis (attaque, dégâts, JS, compétences)' },
    { key: 'divinefavor', name: 'Faveur divine', fixed: 10, effect: '+1 chance attaque et dégâts par 3 niveaux (max +3)' },
    { key: 'shieldoffaith', name: 'Bouclier de la foi', per: 'm', mult: 1, effect: '+2 parade CA (+1 par 6 niveaux, max +5)' },
    { key: 'protectionfromevil', name: 'Protection contre le Mal', per: 'm', mult: 1, effect: '+2 parade CA et +2 résistance JS contre le Mal' },
    { key: 'shield', name: 'Bouclier', per: 'm', mult: 1, effect: '+4 bouclier CA, immunité aux projectiles magiques' },
    { key: 'magearmor', name: 'Armure de mage', per: 'h', mult: 1, effect: '+4 armure CA' },
    { key: 'haste', name: 'Rapidité', per: 'r', mult: 1, effect: '+1 attaque, +1 esquive CA et Réflexes, +9 m, 1 attaque en plus' },
    { key: 'enlarge', name: 'Agrandissement', per: 'm', mult: 1, effect: 'taille +1 : +2 For, -2 Dex, -1 attaque et CA' },
    { key: 'bullsstrength', name: 'Force de taureau', per: 'm', mult: 1, effect: '+4 altération For' },
    { key: 'catsgrace', name: 'Grâce féline', per: 'm', mult: 1, effect: '+4 altération Dex' },
    { key: 'bearsendurance', name: "Endurance de l'ours", per: 'm', mult: 1, effect: '+4 altération Con' },
    { key: 'blur', name: 'Flou', per: 'm', mult: 1, effect: '20 % de camouflage' },
    { key: 'mirrorimage', name: 'Image miroir', per: 'm', mult: 1, effect: '1d4 images +1 par 3 niveaux (max 8)' },
    { key: 'invisibility', name: 'Invisibilité', per: 'm', mult: 1, effect: "invisible jusqu'à une attaque" },
    { key: 'greaterinvisibility', name: 'Invisibilité suprême', per: 'r', mult: 1, effect: 'invisible, même en attaquant' },
    { key: 'fly', name: 'Vol', per: 'm', mult: 1, effect: 'vol 18 m (bonne manœuvrabilité)' },
    { key: 'heroism', name: 'Héroïsme', per: 'm', mult: 10, effect: '+2 moral attaque, JS et compétences' },
    { key: 'resistenergy', name: 'Résistance aux énergies', per: 'm', mult: 10, effect: 'résistance 10 (20 au niv 7, 30 au niv 11)' },
    { key: 'light', name: 'Lumière', per: 'm', mult: 10, effect: 'lumière 6 m (+6 m faible)' },
    { key: 'daylight', name: 'Lumière du jour', per: 'm', mult: 10, effect: 'lumière vive 18 m (+18 m faible)' },
    { key: 'dancinglights', name: 'Lumières dansantes', per: 'm', mult: 1, effect: 'lumière 6 m (+6 m faible)' },
    { key: 'darkvision', name: 'Vision dans le noir', per: 'h', mult: 1, effect: 'vision dans le noir 18 m' }
  ];
  const findFavorite = (q) => {
    const n = normalize(q).replace(/[^a-z0-9]/g, '');
    if (!n) return null;
    return FAVORITES.find((f) => f.key === n) ||
      FAVORITES.find((f) => normalize(f.name).replace(/[^a-z0-9]/g, '') === n) || null;
  };
  const spellDuration = (fav, cl) => (fav.fixed ? fav.fixed : UNITE[fav.per] * (fav.mult || 1) * cl);

  const val = (r) => (r === null || r === undefined ? Infinity : r);
  const parDuree = (a, b) => val(a.remaining) - val(b.remaining) || normalize(a.name).localeCompare(normalize(b.name));

  // ---- view by character (window): one line per effect and per target
  // nameOf(entity) -> name ; casterNameOf(buff) -> name
  const buildView = (buffs, nameOf, casterNameOf, includeHidden) => {
    const groups = new Map();
    buffs.forEach((b) => {
      if (b.hidden && !includeHidden) return;
      b.targets.forEach((t) => {
        const key = entityKey(t);
        if (!groups.has(key)) groups.set(key, { target: nameOf(t) || t.name || '?', rows: [] });
        groups.get(key).rows.push({
          id: b.id, name: b.name, remaining: b.remaining, effect: b.effect || '', hidden: !!b.hidden,
          caster: casterNameOf(b) || ''
        });
      });
    });
    const out = [...groups.values()];
    // the same spell from two casters does not stack: one line, the longest
    out.forEach((g) => {
      g.rows.sort(parDuree);
      const vus = new Map();
      g.rows.forEach((r) => {
        const k = (r.hidden ? 'h:' : '') + normalize(r.name);
        const d = vus.get(k);
        if (!d || val(r.remaining) > val(d.remaining)) vus.set(k, r);
      });
      g.rows = g.rows.filter((r) => vus.get((r.hidden ? 'h:' : '') + normalize(r.name)) === r);
    });
    out.sort((a, b) => normalize(a.target).localeCompare(normalize(b.target)));
    return out;
  };

  // Targets to announce (last round, end): without those that another cast of the same
  // spell still covers for at least min rounds. Returns non-empty [{b, targets}].
  const aAnnoncer = (liste, buffs, min) => liste.map((b) => ({
    b,
    targets: b.targets.filter((t) => !buffs.some((o) => o !== b && !liste.includes(o) &&
      normalize(o.name) === normalize(b.name) && !!o.hidden === !!b.hidden &&
      val(o.remaining) >= min && o.targets.some((x) => sameEntity(x, t))))
  })).filter((x) => x.targets.length);

  // ---- view by cast (menu): one line per effect with the list of its targets
  // editable(b): full buttons; selfOnly(b): only "Me retirer" (a player
  // targeted by someone else's cast)
  const buildCastView = (buffs, nameOf, casterNameOf, editable, includeHidden, selfOnly = () => false) => buffs
    .filter((b) => includeHidden || !b.hidden)
    .map((b) => {
      const ed = !!editable(b);
      return {
        id: b.id, name: b.name, remaining: b.remaining, effect: b.effect || '', hidden: !!b.hidden,
        caster: casterNameOf(b) || '', targets: b.targets.map((t) => nameOf(t) || t.name || '?'),
        editable: ed, selfOnly: !ed && !!selfOnly(b)
      };
    })
    .sort(parDuree);

  const couleurDuree = (r) => {
    if (r === null || r === undefined) return '#555555';
    if (r <= 1) return '#c62828';
    if (r <= 3) return '#e65100';
    return '#2e7d32';
  };

  // ---- handout ("Effets actifs" window)
  const renderHandout = (view, opts = {}) => {
    const n = view.reduce((s, g) => s + g.rows.length, 0);
    let h = `<h3>${escapeHtml(opts.title || HANDOUT)}</h3>`;
    if (!n) return h + `<p><i>${escapeHtml(opts.empty || 'Aucun effet actif.')}</i></p>`;
    h += '<p style="color:#666666"><i>Mise à jour par le script, ne pas modifier à la main.</i></p>';
    view.forEach((g) => {
      h += `<h4 style="margin:8px 0 2px 0">${escapeHtml(g.target)}</h4>`;
      h += '<table style="width:100%;border-collapse:collapse">';
      g.rows.forEach((r) => {
        h += '<tr style="border-top:1px solid #dddddd">' +
          `<td style="padding:2px 4px"><b>${escapeHtml(r.name)}</b>${r.hidden ? ' <i style="color:#888888">(caché)</i>' : ''}` +
          (r.effect ? `<br><span style="color:#666666;font-size:0.9em">${escapeHtml(r.effect)}</span>` : '') + '</td>' +
          `<td style="padding:2px 4px;text-align:right;white-space:nowrap;color:${couleurDuree(r.remaining)}"><b>${escapeHtml(formatDuration(r.remaining))}</b></td>` +
          `<td style="padding:2px 4px;color:#666666;white-space:nowrap">${escapeHtml(r.caster)}</td>` +
          '</tr>';
      });
      h += '</table>';
    });
    return h;
  };

  // ---- chat (a single line: no line break in sendChat)
  const STYLE_BOITE = 'border:1px solid #888888;border-radius:4px;padding:4px 6px;background:#ffffff;color:#222222';
  const STYLE_BTN = 'display:inline-block;background:#4a4a4a;color:#ffffff;border:none;border-radius:3px;padding:0 5px;margin:1px;font-size:11px;text-decoration:none';
  const STYLE_BTN_ON = 'display:inline-block;background:#2e7d32;color:#ffffff;border:none;border-radius:3px;padding:0 5px;margin:1px;font-size:11px;text-decoration:none';
  const STYLE_BTN_OFF = 'display:inline-block;background:#e0e0e0;color:#222222;border:1px solid #9e9e9e;border-radius:3px;padding:0 5px;margin:1px;font-size:11px;text-decoration:none';
  const bouton = (label, href, style) => `<a style="${style || STYLE_BTN}" href="${href}">${escapeHtml(label)}</a>`;
  const handoutUrl = (id) => `http://journal.roll20.net/handout/${id}`;
  const lienFenetre = (id, label) => bouton(label || 'Ouvrir la fenêtre', handoutUrl(id));

  const Q_DUREE = 'Durée : 3r 10min 2h 1j ou perm';
  // Durée button of a running effect: new duration, or a calculation on the remaining duration
  const Q_DUREE_EDIT = 'Nouvelle durée (10min 2h perm) ou en plus/moins : -25r +1h';
  const Q_LANCEUR = 'Lanceur';
  const Q_CIBLES = '?{Cibles|Tout le groupe,group|Moi seul,me|Tokens sélectionnés,selected|Choisir...,pick}';
  const boutonsLancement = (r) => [
    bouton('-1', `${CMD} edit ${r.id} --dur -1`),
    bouton('+1', `${CMD} edit ${r.id} --dur +1`),
    bouton('Durée', `${CMD} edit ${r.id} --dur ?{${Q_DUREE_EDIT}|${compactDuration(r.remaining)}}`),
    bouton('Effet', `${CMD} edit ${r.id} --effect ?{Effet|${escapeHtml(pourRequete(r.effect))}}`),
    bouton('Cibles', `${CMD} edit ${r.id} --targets pick`),
    bouton('X', `${CMD} remove ${r.id}`)
  ].join('');
  const renderMenu = (rows, opts = {}) => {
    let h = `<div style="${STYLE_BOITE}"><div style="font-weight:bold;margin-bottom:2px">${escapeHtml(opts.title || 'Effets actifs')}</div>`;
    if (!rows.length) h += `<div style="color:#666666"><i>${escapeHtml(opts.empty || 'Aucun effet.')}</i></div>`;
    rows.forEach((r) => {
      h += '<div style="padding:3px 0;border-top:1px solid #dddddd">' +
        `<b>${escapeHtml(r.name)}</b>${r.hidden ? ' <i>(caché)</i>' : ''} ` +
        `<span style="color:${couleurDuree(r.remaining)};font-weight:bold">${escapeHtml(formatDuration(r.remaining))}</span>` +
        (r.caster ? ` <span style="color:#666666">par ${escapeHtml(r.caster)}</span>` : '') +
        ` <span style="color:#888888;font-size:10px">#${escapeHtml(r.id)}</span>` +
        `<br><span style="font-size:11px">→ ${escapeHtml(r.targets.join(', '))}</span>` +
        (r.effect ? `<br><span style="color:#666666;font-size:11px">${escapeHtml(r.effect)}</span>` : '') +
        (r.editable ? `<br>${boutonsLancement(r)}` : (r.selfOnly ? `<br>${bouton('Me retirer', `${CMD} remove ${r.id}`)}` : '')) +
        '</div>';
    });
    if (opts.footer) h += `<div style="margin-top:2px;border-top:1px solid #cccccc;padding-top:2px">${opts.footer}</div>`;
    return h + '</div>';
  };

  // check buttons: candidates = [{key, name, on}]
  const renderPicker = (title, candidates) => {
    const n = candidates.filter((c) => c.on).length;
    return `<div style="${STYLE_BOITE}"><div style="font-weight:bold">${escapeHtml(title)}</div>` +
      '<div style="margin-top:2px">Cibles :</div><div>' +
      (candidates.length
        ? candidates.map((c) => bouton((c.on ? '✔ ' : '') + c.name, `${CMD} pick toggle ${c.key}`, c.on ? STYLE_BTN_ON : STYLE_BTN_OFF)).join('')
        : '<i style="color:#666666">Aucun PJ sur la carte.</i>') +
      '</div><div style="margin-top:2px">' +
      bouton('Tout le groupe', `${CMD} pick all`) + bouton('Aucun', `${CMD} pick none`) +
      '</div><div style="margin-top:2px">' +
      bouton(`Valider (${n})`, `${CMD} pick ok`) + bouton('Annuler', `${CMD} pick cancel`) +
      '</div></div>';
  };

  // choosing a name: one button per possibility, the free name, Annuler
  const renderChoix = (nom, role, labels) => `<div style="${STYLE_BOITE}">` +
    `<div style="font-weight:bold">« ${escapeHtml(nom)} » (${escapeHtml(role)}) : lequel ?</div><div>` +
    labels.map((l, i) => bouton(labels.indexOf(l) !== i || labels.lastIndexOf(l) !== i ? `${l} (${i + 1})` : l, `${CMD} choose ${i + 1}`)).join('') +
    '</div><div style="margin-top:2px">' +
    bouton(`Nom libre « ${nom} »`, `${CMD} choose free`) + bouton('Annuler', `${CMD} choose cancel`) +
    '</div></div>';

  const boutonAjouter = (lanceur) => bouton('Ajouter',
    `${CMD} add --name ?{Nom du buff} --dur ?{${Q_DUREE}|1min} --caster ?{${Q_LANCEUR}|${escapeHtml(pourRequete(lanceur))}} --targets ${Q_CIBLES} --effect ?{Effet|}`);
  const boutonFavori = (f, lanceur) => bouton(f.name,
    `${CMD} add --spell ${f.key} --cl ?{Niveau de lanceur|1} --caster ?{${Q_LANCEUR}|${escapeHtml(pourRequete(lanceur))}} --targets ${Q_CIBLES}`);

  const exportsPurs = {
    parseDuration, formatDuration, compactDuration, normalize, escapeHtml, pourRequete, parseCommand, parseBool,
    texte, parseTargets, entityKey, tick, detectAdvance, isRoundEntry, isNewRound, stripMarkers,
    resolveByName, replaceTargets, aAnnoncer, FAVORITES, findFavorite, spellDuration, buildView,
    buildCastView, renderHandout, renderMenu, renderPicker, renderChoix
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsPurs;
  if (typeof on !== 'function') return; // outside Roll20: stop here

  // ============================================================== ROLL20 PART

  const etat = () => {
    const s = state[ETAT] = state[ETAT] || {};
    s.nextId = s.nextId || 1;
    s.buffs = s.buffs || [];
    s.drafts = s.drafts || {};   // player id -> target choice in progress
    if (s.version !== 2) {       // v1: one target per effect
      s.buffs.forEach((b) => {
        if (b.targets) return;
        b.targets = b.target ? [{ kind: b.target.kind, id: b.target.id, name: b.targetName || '' }] : [];
        delete b.target; delete b.targetName;
      });
      s.buffs = s.buffs.filter((b) => b.targets.length);
      s.version = 2;
    }
    return s;
  };

  // ---- entities: a character (token linked to its sheet) or a lone token
  // token linked to its sheet, or a PC's token even without a linked bar: it is the character
  // (otherwise a PC placed with an unlinked token appeared twice in the window)
  const entiteDuToken = (tok) => {
    const cid = tok.get('represents');
    const c = cid && getObj('character', cid);
    const lie = c && (tok.get('bar1_link') || tok.get('bar2_link') || tok.get('bar3_link') || liste(c.get('controlledby')).length > 0);
    return lie ? { kind: 'char', id: cid } : { kind: 'token', id: tok.id };
  };
  const nomToken = (tok) => {
    if (!tok) return '';
    const n = tok.get('name');
    if (n) return n;
    const c = getObj('character', tok.get('represents'));
    return c ? c.get('name') : '';
  };
  // free name: an NPC without a token or sheet (scene played without a page)
  // (id without spaces: it is used as an argument of the check buttons)
  const entiteNom = (nom) => ({ kind: 'name', id: normalize(nom).replace(/[^a-z0-9]+/g, '-'), name: String(nom || '').trim() });
  const entiteDuPerso = (c) => ({ kind: 'char', id: c.id, name: c.get('name') });
  const nomEntite = (e) => {
    if (!e || !e.id || e.kind === 'name') return (e && e.name) || '';
    if (e.kind === 'char') { const c = getObj('character', e.id); return c ? c.get('name') : (e.name || ''); }
    return nomToken(getObj('graphic', e.id)) || e.name || '';
  };
  const tokensDe = (e) => {
    if (e.kind === 'name') return [];
    if (e.kind === 'token') { const t = getObj('graphic', e.id); return t ? [t] : []; }
    return findObjs({ _type: 'graphic', represents: e.id });
  };
  const tokenEst = (e, tok) => !!(e && e.id && e.kind !== 'name' && tok && (e.kind === 'token' ? tok.id === e.id : tok.get('represents') === e.id));
  const entitesUniques = (toks) => {
    const out = [];
    toks.forEach((t) => {
      const e = entiteDuToken(t);
      if (!out.some((o) => sameEntity(o, e))) out.push(Object.assign(e, { name: nomEntite(e) || nomToken(t) }));
    });
    return out;
  };
  const tokensPage = (pageid) => (pageid ? findObjs({ _type: 'graphic', _subtype: 'token', _pageid: pageid }) : []);

  // ---- players and permissions
  const liste = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const controleurs = (e) => {
    if (!e || !e.id || e.kind === 'name') return [];
    if (e.kind === 'char') { const c = getObj('character', e.id); return c ? liste(c.get('controlledby')) : []; }
    const t = getObj('graphic', e.id);
    if (!t) return [];
    const c = getObj('character', t.get('represents'));
    return liste(t.get('controlledby')).concat(c ? liste(c.get('controlledby')) : []);
  };
  const controle = (pid, e) => {
    if (playerIsGM(pid)) return true;
    const l = controleurs(e);
    return l.includes('all') || l.includes(pid);
  };
  // manage a cast (duration, targets, removal for all): the GM, its creator, or whoever
  // controls its caster. A player who is only targeted can just remove their characters from it.
  const peutGerer = (pid, b) => playerIsGM(pid) ||
    (!b.hidden && (b.owner === pid || (!!b.caster && controle(pid, b.caster))));
  const mesCibles = (pid, b) => (b.hidden ? [] : b.targets.filter((t) => controle(pid, t)));

  // PC = character controlled by at least one player, present on the page
  const pjsDeLaPage = (pageid) => entitesUniques(tokensPage(pageid).filter((t) => {
    const c = getObj('character', t.get('represents'));
    return !!c && liste(c.get('controlledby')).length > 0;
  })).sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  const fiches = () => findObjs({ _type: 'character' }).filter((c) => !c.get('archived'));
  const pjsDeLaPartie = () => fiches().filter((c) => liste(c.get('controlledby')).length > 0).map(entiteDuPerso)
    .sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  // PCs on the page, otherwise (scene without a page, or PCs absent) all PCs in the game
  const pjsDuGroupe = (pageid) => { const l = pjsDeLaPage(pageid); return l.length ? l : pjsDeLaPartie(); };
  // this player's characters (controlled by name, not through "all"): on the page, otherwise in the game
  const persosDuJoueur = (pid, pageid) => {
    const siens = (e) => controleurs(e).includes(pid);
    const l = pjsDeLaPage(pageid).filter(siens);
    return l.length ? l : pjsDeLaPartie().filter(siens);
  };

  // name -> entity, without guessing. Key (char.<id>, token.<id>) or token id; "=Name"
  // forces a free name; exact name (case and accents ignored) of a token on the page,
  // otherwise of a sheet. A name that is only part of existing names ("Moi" for
  // "Moine noir") returns {choices}: the player chooses, or keeps the free name.
  // Returns {entity} or {choices: [entities]}.
  const MAX_CHOIX = 6;
  const trouverEntite = (nom, pageid) => {
    const brut = String(nom || '').trim();
    if (brut.startsWith('=')) return { entity: entiteNom(brut.slice(1)) };
    const direct = getObj('graphic', brut);
    if (direct) return { entity: entitesUniques([direct])[0] };
    const cle = lireCle(brut).match(/^(char|token)\.(\S+)$/);
    if (cle && getObj(cle[1] === 'char' ? 'character' : 'graphic', cle[2])) {
      const e = { kind: cle[1], id: cle[2] };
      return { entity: Object.assign(e, { name: nomEntite(e) }) };
    }
    const q = normalize(brut);
    const toks = tokensPage(pageid).map((t) => ({ tok: t, name: nomToken(t) })).filter((c) => c.name);
    const exactCarte = entitesUniques(toks.filter((c) => normalize(c.name) === q).map((c) => c.tok));
    if (exactCarte.length === 1) return { entity: exactCarte[0] };
    if (exactCarte.length > 1) return { choices: exactCarte.slice(0, MAX_CHOIX) };
    const toutes = fiches();
    const exactes = toutes.filter((c) => normalize(c.get('name')) === q).map(entiteDuPerso);
    if (exactes.length === 1) return { entity: exactes[0] };
    if (exactes.length > 1) return { choices: exactes.slice(0, MAX_CHOIX) };
    // close matches: tokens on the page that contain the name, sheets with a word starting with it
    const proches = entitesUniques(toks.filter((c) => normalize(c.name).includes(q)).map((c) => c.tok));
    toutes.forEach((c) => {
      const n = normalize(c.get('name'));
      if (!(n.startsWith(q) || n.includes(' ' + q))) return;
      const e = entiteDuPerso(c);
      if (!proches.some((o) => sameEntity(o, e))) proches.push(e);
    });
    return proches.length ? { choices: proches.slice(0, MAX_CHOIX) } : { entity: entiteNom(brut) };
  };

  const selection = (msg) => (msg.selected || []).map((x) => getObj('graphic', x._id)).filter(Boolean);
  // the player's page: the one of the selected tokens, otherwise the one they are on
  // (for the GM, the last page they opened, not necessarily the players' one)
  const pageDu = (msg) => {
    const sel = selection(msg);
    if (sel.length) return sel[0].get('_pageid');
    const c = Campaign();
    if (playerIsGM(msg.playerid)) {
      const pl = getObj('player', msg.playerid);
      const last = pl && pl.get('_lastpage');
      if (last && getObj('page', last)) return last;
    } else {
      const psp = c.get('playerspecificpages');
      if (psp && psp[msg.playerid]) return psp[msg.playerid];
    }
    return c.get('playerpageid');
  };

  const nomLanceur = (b) => (b.caster ? nomEntite(b.caster) : '');
  const nomsCibles = (b) => b.targets.map((t) => nomEntite(t) || '?').join(', ');
  const libelle = (b) => `${b.name} (${nomsCibles(b)})`;

  // ---- chat
  const nomJoueur = (pid) => { const p = getObj('player', pid); return p ? String(p.get('_displayname') || '') : ''; };
  const dire = (pid, html) => {
    if (playerIsGM(pid)) return sendChat(NOM, `/w gm ${html}`);
    const n = nomJoueur(pid).replace(/"/g, '');
    return sendChat(NOM, n ? `/w "${n}" ${html}` : `/w gm ${html}`);
  };
  const boite = (html) => `<div style="${STYLE_BOITE}">${html}</div>`;
  const erreur = (pid, txt) => dire(pid, boite(`<span style="color:#c62828">${escapeHtml(txt)}</span>`));

  // ---- handout, announcements
  let dernierHandout = { id: null, notes: null, gmnotes: null };
  const handout = () => {
    const s = etat();
    let h = s.handoutId && getObj('handout', s.handoutId);
    if (!h) h = findObjs({ _type: 'handout', name: HANDOUT })[0];
    if (!h) h = createObj('handout', { name: HANDOUT, inplayerjournals: 'all', archived: false });
    if (h.id !== dernierHandout.id) dernierHandout = { id: h.id, notes: null, gmnotes: null };
    s.handoutId = h.id;
    return h;
  };
  // items: [{b, targets}] (aAnnoncer)
  const annoncer = (items, texteAnnonce) => {
    const pub = items.filter((x) => !x.b.hidden), mj = items.filter((x) => x.b.hidden);
    const noms = (x) => x.targets.map((t) => nomEntite(t) || '?').join(', ');
    const ligne = (l, lien) => boite(`${escapeHtml(texteAnnonce)} : ${l.map((x) => `<b>${escapeHtml(x.b.name)}</b> (${escapeHtml(noms(x))})`).join(', ')}` +
      (lien ? ` ${lienFenetre(handout().id, 'Voir les effets')}` : ''));
    if (pub.length) sendChat(NOM, ligne(pub, true));
    if (mj.length) sendChat(NOM, `/w gm ${ligne(mj, false)}`);
  };
  const majHandout = () => {
    const s = etat();
    const h = handout();
    const notes = renderHandout(buildView(s.buffs, nomEntite, nomLanceur, false));
    const gmnotes = renderHandout(buildView(s.buffs.filter((b) => b.hidden), nomEntite, nomLanceur, true),
      { title: 'Effets cachés (MJ)', empty: 'Aucun effet caché.' });
    if (notes !== dernierHandout.notes) h.set({ notes });
    if (gmnotes !== dernierHandout.gmnotes) h.set({ gmnotes });
    dernierHandout.notes = notes;
    dernierHandout.gmnotes = gmnotes;
  };
  // markers set by a previous version: removed once at startup
  const nettoyerMarqueurs = () => {
    const s = etat();
    if (!s.markers) return;
    Object.keys(s.markers).forEach((id) => {
      const t = getObj('graphic', id);
      if (!t) return;
      const cur = t.get('statusmarkers') || '';
      const nv = stripMarkers(cur, s.markers[id]);
      if (nv !== cur) t.set({ statusmarkers: nv });
    });
    delete s.markers;
  };
  // ---- other scripts (invis.js): notified after every change to the effects
  const ecouteurs = [];
  const prevenir = () => ecouteurs.forEach((fn) => {
    try { fn(etat().buffs); } catch (e) { log(`${NOM}: error in a listening script ${e && e.stack ? e.stack : e}`); }
  });
  const rafraichir = () => { majHandout(); prevenir(); };
  // removes targets from their effects (fn(buff, target) -> true) and announces the end
  const finirCibles = (fn) => {
    const s = etat();
    const items = [];
    s.buffs.forEach((b) => {
      const fin = b.targets.filter((t) => fn(b, t));
      if (!fin.length) return;
      items.push({ b, targets: fin });
      b.targets = b.targets.filter((t) => !fin.includes(t));
    });
    if (!items.length) return 0;
    s.buffs = s.buffs.filter((b) => b.targets.length);
    annoncer(items, 'Fin');
    rafraichir();
    return items.reduce((n, x) => n + x.targets.length, 0);
  };
  globalThis.BuffTrackerAPI = {
    observe: (fn) => { if (typeof fn === 'function' && !ecouteurs.includes(fn)) ecouteurs.push(fn); },
    buffs: () => etat().buffs,
    tokensOf: (e) => tokensDe(e),
    endTargets: finirCibles
  };

  // removes expired effects, announces them, and updates everything
  const traiter = (res, { avertir = true } = {}) => {
    const s = etat();
    // a target still covered by the same spell from another caster is not announced
    if (avertir && res.warned.length) annoncer(aAnnoncer(res.warned, s.buffs, 2), 'Dernier round');
    if (res.expired.length) {
      const fin = new Set(res.expired);
      s.buffs = s.buffs.filter((b) => !fin.has(b));
      annoncer(aAnnoncer(res.expired, s.buffs, 1), 'Fin');
    }
    rafraichir();
  };

  const trouver = (id) => etat().buffs.find((b) => b.id === String(id || '').replace(/^#/, ''));

  // ---- caster given by name: token on the page, sheet, otherwise free name (tracked
  // by name in the tracker). Returns {caster} (null without a name) or {choices}.
  const trouverLanceur = (nom, pageid) => {
    const q = String(nom || '').trim();
    if (!q) return { caster: null };
    const r = trouverEntite(q, pageid);
    return r.choices ? r : { caster: copieEntite(r.entity) };
  };
  // caster suggested by Ajouter and Sorts courants: the selected token (the first one),
  // otherwise the player's character if they have only one
  const lanceurParDefaut = (pid, pageid, msg) => {
    const sel = msg ? entitesUniques(selection(msg)) : [];
    if (sel.length) return sel[0].name || '';
    const l = persosDuJoueur(pid, pageid);
    return l.length === 1 ? l[0].name : '';
  };

  // ---- targets: returns {targets}, {pick: preselection}, {choose: {index, nom, choices}} or {error}
  const resoudreCibles = (spec, msg, caster, pageid) => {
    const pid = msg.playerid;
    const sel = entitesUniques(selection(msg));
    switch (spec.mode) {
      case 'default': return sel.length ? { targets: sel } : { pick: [] };
      case 'pick': return { pick: sel };
      case 'selected': return sel.length ? { targets: sel } : { error: 'Aucun token sélectionné. Tu ne peux sélectionner que tes propres tokens : pour un allié, choisis « Tout le groupe » ou « Choisir... ».' };
      case 'group': {
        const l = pjsDuGroupe(pageid);
        return l.length ? { targets: l } : { error: 'Aucun PJ dans la partie.' };
      }
      case 'me': {
        if (caster) return { targets: [copieEntite(caster.kind ? caster : entiteNom(caster.name))] };
        const l = persosDuJoueur(pid, pageid);
        return l.length ? { targets: l } : { error: 'Moi seul : indique le lanceur (--caster).' };
      }
      default: {
        const out = [];
        for (let i = 0; i < spec.names.length; i++) {
          const r = trouverEntite(spec.names[i], pageid);
          if (r.choices) return { choose: { index: i, nom: spec.names[i], choices: r.choices } };
          if (!out.some((o) => sameEntity(o, r.entity))) out.push(r.entity);
        }
        return { targets: out };
      }
    }
  };
  const copieEntite = (e) => ({ kind: e.kind, id: e.id, name: e.name || nomEntite(e) });

  // ---- check buttons
  const montrerChoix = (pid) => {
    const d = etat().drafts[pid];
    if (!d) return;
    const titre = d.editId
      ? `Cibles de ${d.name} (#${d.editId})`
      : `${d.name} · ${formatDuration(d.rounds)}${d.caster ? ' · par ' + (nomEntite(d.caster) || d.caster.name) : ''}`;
    const cands = d.candidates.map((c) => ({ key: entityKey(c), name: nomEntite(c) || c.name || '?', on: d.targets.some((t) => sameEntity(t, c)) }));
    dire(pid, renderPicker(titre, cands));
  };
  const ouvrirChoix = (pid, pageid, d, preselection) => {
    const cands = pjsDuGroupe(pageid);
    preselection.forEach((e) => { if (!cands.some((c) => sameEntity(c, e))) cands.push(e); });
    d.candidates = cands.map(copieEntite);
    d.targets = preselection.map(copieEntite);
    d.pageid = pageid;
    etat().drafts[pid] = d;
    montrerChoix(pid);
  };

  // ---- creating a cast (recast: replaces the old one on these targets)
  const lancer = (pid, d) => {
    const s = etat();
    // same spell spelled differently (case, accents): keep the one already in play
    const existant = s.buffs.find((b) => normalize(b.name) === normalize(d.name));
    if (existant) d.name = existant.name;
    const res = replaceTargets(s.buffs, d.name, d.hidden, d.targets, d.caster);
    s.buffs = res.buffs;
    const b = {
      id: String(s.nextId++), name: d.name, targets: d.targets.map(copieEntite), caster: d.caster || null,
      remaining: d.rounds, effect: d.effect || '', hidden: !!d.hidden, owner: pid
    };
    s.buffs.push(b);
    rafraichir();
    const relance = res.relaunched.length ? ` <i>(relancé pour ${escapeHtml(res.relaunched.map(nomEntite).join(', '))})</i>` : '';
    dire(pid, boite(`<b>${escapeHtml(b.name)}</b> (${escapeHtml(formatDuration(b.remaining))}) → ${escapeHtml(nomsCibles(b))}${relance} ` +
      lienFenetre(handout().id, 'Voir les effets')));
    return b;
  };

  // ---------------------------------------------------------------- commands
  const cmdMenu = (msg) => {
    const pid = msg.playerid, gm = playerIsGM(pid), s = etat();
    const pageid = pageDu(msg);
    const sel = entitesUniques(selection(msg));
    let buffs, titre;
    if (sel.length) {
      buffs = s.buffs.filter((b) => b.targets.some((t) => sel.some((e) => sameEntity(e, t))) && (!b.hidden || gm));
      titre = 'Effets : ' + sel.map((e) => e.name || nomEntite(e)).join(', ');
    } else {
      buffs = s.buffs.filter((b) => peutGerer(pid, b) || mesCibles(pid, b).length);
      titre = gm ? 'Tous les effets' : 'Tes effets';
    }
    const rows = buildCastView(buffs, nomEntite, nomLanceur, (b) => peutGerer(pid, b), gm, (b) => mesCibles(pid, b).length > 0);
    const footer = [boutonAjouter(lanceurParDefaut(pid, pageid, msg)), bouton('Sorts courants', `${CMD} fav`), lienFenetre(handout().id)]
      .concat(gm ? [bouton('Passer le temps', `${CMD} time ?{Temps qui passe pour tous les effets : 10min 1h 13h50 1j|10min}`)] : []).join('');
    dire(pid, renderMenu(rows, {
      title: titre,
      empty: sel.length ? 'Aucun effet sur la sélection.' : 'Aucun effet en cours.',
      footer
    }));
  };

  const cmdAdd = (msg, c) => {
    const pid = msg.playerid, gm = playerIsGM(pid), o = c.opts;
    const fav = o.spell ? findFavorite(o.spell) : null;
    if (o.spell && !fav) return erreur(pid, `Sort courant inconnu : ${o.spell}. Voir !buff fav.`);
    const name = texte(o.name) || (fav ? fav.name : '');
    if (!name) return erreur(pid, 'Il manque le nom de l\'effet (--name).');
    let rounds;
    if (texte(o.dur)) {
      const d = parseDuration(o.dur);
      if (!d || d.sign < 0 || d.rounds === 0) return erreur(pid, `Durée illisible : ${o.dur}. Exemples : 3r, 10min, 2h, perm.`);
      rounds = d.rounds;
    } else if (fav) {
      const cl = parseInt(o.cl, 10);
      if (!(cl >= 1 && cl <= 40)) return erreur(pid, 'Il manque le niveau de lanceur (--cl).');
      rounds = spellDuration(fav, cl);
    } else return erreur(pid, 'Il manque la durée (--dur).');
    const hidden = o.hidden !== undefined ? parseBool(o.hidden) === true : false;
    if (hidden && !gm) return erreur(pid, 'Seul le MJ peut créer un effet caché.');
    const pageid = pageDu(msg);
    const rl = trouverLanceur(texte(o.caster), pageid);
    if (rl.choices) return demanderChoix(msg, c, 'caster', 0, texte(o.caster), rl.choices);
    const caster = rl.caster;
    const d = {
      name, rounds, caster, hidden,
      effect: texte(o.effect) || (fav ? fav.effect : '')
    };
    const r = resoudreCibles(parseTargets(o.targets), msg, caster, pageid);
    if (r.error) return erreur(pid, r.error);
    if (r.choose) return demanderChoix(msg, c, 'targets', r.choose.index, r.choose.nom, r.choose.choices);
    if (r.pick) return ouvrirChoix(pid, pageid, d, r.pick);
    d.targets = r.targets;
    lancer(pid, d);
  };

  // ---- choosing a name that is not exact: keep the command, ask which one,
  // then run it again with the chosen key (or "=Name" for the free name)
  const demanderChoix = (msg, c, champ, index, nom, choices) => {
    const pid = msg.playerid, s = etat();
    s.choix = s.choix || {};
    s.choix[pid] = {
      sub: c.sub, args: c.args, opts: c.opts, selected: (msg.selected || []).map((x) => x._id),
      champ, index, nom, options: choices.map(copieEntite)
    };
    dire(pid, renderChoix(nom, champ === 'caster' ? 'lanceur' : 'cible', s.choix[pid].options.map((e) => e.name || '?')));
  };
  const cmdChoose = (msg, c) => {
    const pid = msg.playerid, s = etat();
    const d = s.choix && s.choix[pid];
    if (!d) return erreur(pid, 'Aucun choix de nom en cours.');
    const a = normalize(c.args[0]);
    if (a === 'cancel') { delete s.choix[pid]; return dire(pid, boite('Annulé.')); }
    let val;
    if (a === 'free') val = '=' + d.nom;
    else {
      const e = d.options[parseInt(a, 10) - 1];
      if (!e) return erreur(pid, 'Choix inconnu.');
      val = entityKey(e);
    }
    delete s.choix[pid];
    const opts = Object.assign({}, d.opts);
    if (d.champ === 'caster') opts.caster = val;
    else {
      const noms = String(opts.targets).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      noms[d.index] = val;
      opts.targets = noms.join(', ');
    }
    const m2 = { type: 'api', playerid: pid, who: msg.who, content: '', selected: d.selected.map((id) => ({ _id: id, _type: 'graphic' })) };
    const c2 = { sub: d.sub, args: d.args, opts, confirm: null };
    return d.sub === 'edit' ? cmdEdit(m2, c2) : cmdAdd(m2, c2);
  };

  const cmdPick = (msg, c) => {
    const pid = msg.playerid, s = etat();
    const d = s.drafts[pid];
    if (!d) return erreur(pid, 'Aucun choix de cibles en cours.');
    const action = normalize(c.args[0]);
    if (action === 'toggle') {
      const key = c.args[1];
      const cand = d.candidates.find((x) => entityKey(x) === lireCle(key));
      if (!cand) return erreur(pid, 'Cible inconnue.');
      if (d.targets.some((t) => sameEntity(t, cand))) d.targets = d.targets.filter((t) => !sameEntity(t, cand));
      else d.targets.push(copieEntite(cand));
      return montrerChoix(pid);
    }
    if (action === 'all') {
      const pjs = pjsDuGroupe(d.pageid);
      pjs.forEach((e) => {
        if (!d.candidates.some((x) => sameEntity(x, e))) d.candidates.push(copieEntite(e));
        if (!d.targets.some((t) => sameEntity(t, e))) d.targets.push(copieEntite(e));
      });
      return montrerChoix(pid);
    }
    if (action === 'none') { d.targets = []; return montrerChoix(pid); }
    if (action === 'cancel') { delete s.drafts[pid]; return dire(pid, boite('Annulé.')); }
    if (action === 'ok') {
      if (!d.targets.length) return erreur(pid, 'Aucune cible cochée. Pour retirer l\'effet, utilise le bouton X du menu.');
      delete s.drafts[pid];
      if (d.editId) {
        const b = trouver(d.editId);
        if (!b || !peutGerer(pid, b)) return erreur(pid, `Effet introuvable : ${d.editId}.`);
        b.targets = d.targets.map(copieEntite);
        rafraichir();
        return dire(pid, boite(`<b>${escapeHtml(b.name)}</b> → ${escapeHtml(nomsCibles(b))}`));
      }
      return lancer(pid, d);
    }
    return erreur(pid, 'Action inconnue : toggle, all, none, ok ou cancel.');
  };

  const cmdEdit = (msg, c) => {
    const pid = msg.playerid, gm = playerIsGM(pid), o = c.opts;
    const b = trouver(c.args[0]);
    if (!b || (b.hidden && !gm)) return erreur(pid, `Effet introuvable : ${c.args[0] || '(aucun numéro)'}.`);
    if (!peutGerer(pid, b)) return erreur(pid, `Tu ne peux pas modifier ${libelle(b)}.`);
    const faits = [];
    let dur = null;
    if (o.dur !== undefined) {
      dur = parseDuration(o.dur);
      if (!dur) return erreur(pid, `Durée illisible : ${o.dur}. Exemples : -1, +2, 4r, 10min, perm.`);
      if (dur.sign && (b.remaining === null || dur.rounds === null)) return erreur(pid, 'Effet permanent : donne une durée (4r, 10min...) plutôt qu\'un ajout.');
    }
    if (o.hidden !== undefined) {
      if (!gm) return erreur(pid, 'Seul le MJ peut cacher un effet.');
      if (parseBool(o.hidden) === null) return erreur(pid, '--hidden attend yes ou no.');
    }
    // the page of the person editing (not that of a target's token: a PC has tokens
    // on several pages, and "Cibles" then offered the PCs of another page)
    const pageid = pageDu(msg);
    let nouveauLanceur;
    if (texte(o.caster) !== undefined) {
      const rl = trouverLanceur(texte(o.caster), pageid);
      if (rl.choices) return demanderChoix(msg, c, 'caster', 0, texte(o.caster), rl.choices);
      nouveauLanceur = rl.caster;
    }
    let cibles = null;
    if (o.targets !== undefined) {
      const caster = nouveauLanceur !== undefined ? nouveauLanceur : b.caster;
      const r = resoudreCibles(parseTargets(o.targets), msg, caster, pageid);
      if (r.error) return erreur(pid, r.error);
      if (r.choose) return demanderChoix(msg, c, 'targets', r.choose.index, r.choose.nom, r.choose.choices);
      if (r.pick) {
        const pre = parseTargets(o.targets).mode === 'pick' ? b.targets : r.pick;
        return ouvrirChoix(pid, pageid, { name: b.name, editId: b.id }, pre.length ? pre : b.targets);
      }
      cibles = r.targets;
    }
    if (dur) { b.remaining = dur.sign ? Math.max(0, b.remaining + dur.sign * dur.rounds) : dur.rounds; faits.push(formatDuration(b.remaining)); }
    if (texte(o.name)) { b.name = texte(o.name); faits.push('renommé'); }
    if (texte(o.effect) !== undefined) { b.effect = texte(o.effect); faits.push(b.effect ? 'effet modifié' : 'effet effacé'); }
    if (nouveauLanceur !== undefined) {
      b.caster = nouveauLanceur;
      faits.push('lanceur ' + (nomLanceur(b) || 'aucun'));
    }
    if (o.hidden !== undefined) { b.hidden = parseBool(o.hidden); faits.push(b.hidden ? 'caché' : 'visible'); }
    if (cibles) { b.targets = cibles.map(copieEntite); faits.push('cibles : ' + nomsCibles(b)); }
    if (!faits.length) return erreur(pid, 'Rien à modifier : --dur, --name, --effect, --caster, --targets ou --hidden.');
    if (b.remaining === 0) {
      traiter({ expired: [b], warned: [] });
      return dire(pid, boite(`<b>${escapeHtml(libelle(b))}</b> retiré.`));
    }
    rafraichir();
    dire(pid, boite(`<b>${escapeHtml(libelle(b))}</b> : ${escapeHtml(faits.join(', '))}.`));
  };

  // removal of whole casts, with a dry run then "confirm N"
  const cmdRemove = (msg, c) => {
    const pid = msg.playerid, s = etat(), gm = playerIsGM(pid);
    const ids = c.args.join(' ').split(/[,\s]+/).filter(Boolean);
    if (!ids.length) return erreur(pid, 'Donne le numéro de l\'effet : !buff remove 3');
    // {b, seul}: seul = null (the whole cast) or only the player's characters
    const cibles = [];
    for (const id of ids) {
      const b = trouver(id);
      if (!b || (b.hidden && !gm)) return erreur(pid, `Effet introuvable : ${id}.`);
      if (cibles.some((x) => x.b === b)) continue;
      if (peutGerer(pid, b)) { cibles.push({ b, seul: null }); continue; }
      const miens = mesCibles(pid, b);
      if (!miens.length) return erreur(pid, `Tu ne peux pas retirer ${libelle(b)}.`);
      // all their characters and nobody else: it is the whole cast
      cibles.push({ b, seul: miens.length === b.targets.length ? null : miens });
    }
    const noms = cibles.map(({ b, seul }) => `<b>${escapeHtml(b.name)}</b> (${escapeHtml(seul ? seul.map(nomEntite).join(', ') + ' seulement' : nomsCibles(b))})`).join(', ');
    const n = cibles.length;
    if (c.confirm === null) {
      return dire(pid, boite(`Retirerait ${n} effet${n > 1 ? 's' : ''} : ${noms}<br>` +
        bouton('Confirmer', `${CMD} remove ${cibles.map((x) => x.b.id).join(' ')} confirm ${n}`)));
    }
    if (c.confirm !== n) return erreur(pid, `Le nombre ne correspond pas (${n} effet(s), pas ${c.confirm}) : rien n'a été retiré.`);
    cibles.forEach(({ b, seul }) => { b.targets = seul ? b.targets.filter((t) => !seul.includes(t)) : []; });
    s.buffs = s.buffs.filter((b) => b.targets.length);
    rafraichir();
    dire(pid, boite(`Retiré : ${noms}`));
  };

  // !buff clear: removes characters (selection, or --keys) from all their effects
  const cmdClear = (msg, c) => {
    const pid = msg.playerid, s = etat();
    if (normalize(c.args[0]) === 'all') {
      if (!playerIsGM(pid)) return erreur(pid, 'Seul le MJ peut tout effacer.');
      const n = s.buffs.length;
      if (!n) return erreur(pid, 'Aucun effet à effacer.');
      if (c.confirm === null) {
        return dire(pid, boite(`Effacerait les ${n} effets de la partie.<br>${bouton('Confirmer', `${CMD} clear all confirm ${n}`)}`));
      }
      if (c.confirm !== n) return erreur(pid, `Le nombre ne correspond pas (${n} effet(s), pas ${c.confirm}) : rien n'a été effacé.`);
      s.buffs = [];
      rafraichir();
      return dire(pid, boite(`${n} effet${n > 1 ? 's' : ''} effacé${n > 1 ? 's' : ''}.`));
    }
    const keys = typeof c.opts.keys === 'string'
      ? c.opts.keys.split(/[,\s]+/).filter(Boolean).map(lireCle)
      : entitesUniques(selection(msg)).map(entityKey);
    if (!keys.length) return erreur(pid, 'Sélectionne des tokens (ou !buff clear all pour le MJ).');
    const paires = [];
    // their own characters leave everything; others, only the casts they manage
    s.buffs.forEach((b) => {
      if (b.hidden && !playerIsGM(pid)) return;
      const gere = peutGerer(pid, b);
      b.targets.forEach((t) => { if (keys.includes(entityKey(t)) && (gere || controle(pid, t))) paires.push({ b, t }); });
    });
    const n = paires.length;
    if (!n) return erreur(pid, 'Aucun effet que tu peux retirer sur la sélection.');
    const noms = paires.map((p) => `<b>${escapeHtml(p.b.name)}</b> (${escapeHtml(nomEntite(p.t))})`).join(', ');
    if (c.confirm === null) {
      return dire(pid, boite(`Retirerait ${n} effet${n > 1 ? 's' : ''} : ${noms}<br>` +
        bouton('Confirmer', `${CMD} clear --keys ${keys.join(',')} confirm ${n}`)));
    }
    if (c.confirm !== n) return erreur(pid, `Le nombre ne correspond pas (${n} effet(s), pas ${c.confirm}) : rien n'a été retiré.`);
    paires.forEach((p) => { p.b.targets = p.b.targets.filter((t) => t !== p.t); });
    s.buffs = s.buffs.filter((b) => b.targets.length);
    rafraichir();
    dire(pid, boite(`Retiré : ${noms}`));
  };

  const cmdTime = (msg, c) => {
    const pid = msg.playerid, s = etat();
    if (!playerIsGM(pid)) return erreur(pid, 'Seul le MJ fait passer le temps.');
    const d = parseDuration(c.args.join(' '));
    if (!d || d.sign < 0 || !d.rounds) return erreur(pid, 'Durée à faire passer : !buff time 10min (ou 3r, 1h).');
    const concernes = s.buffs.filter((b) => b.remaining !== null && b.remaining !== undefined);
    const n = concernes.length;
    if (!n) return erreur(pid, 'Aucun effet avec une durée.');
    const fini = concernes.filter((b) => b.remaining <= d.rounds);
    if (c.confirm === null) {
      return dire(pid, boite(`Faire passer ${escapeHtml(formatDuration(d.rounds))} : ${n} effet${n > 1 ? 's' : ''} raccourci${n > 1 ? 's' : ''}` +
        (fini.length ? `, dont ${fini.length} se terminerai${fini.length > 1 ? 'ent' : 't'} : ${fini.map((b) => escapeHtml(libelle(b))).join(', ')}` : '') +
        `.<br>${bouton('Confirmer', `${CMD} time ${compactDuration(d.rounds)} confirm ${n}`)}`));
    }
    if (c.confirm !== n) return erreur(pid, `Le nombre ne correspond pas (${n} effet(s), pas ${c.confirm}) : le temps n'a pas passé.`);
    traiter(tick(s.buffs, () => true, d.rounds), { avertir: false });
    dire(pid, boite(`${escapeHtml(formatDuration(d.rounds))} passées.`));
  };

  const cmdFav = (msg) => {
    const lanceur = lanceurParDefaut(msg.playerid, pageDu(msg), msg);
    dire(msg.playerid, boite('<b>Sorts courants</b><br>' + FAVORITES.map((f) => boutonFavori(f, lanceur)).join('')));
  };

  const cmdShow = (msg) => {
    rafraichir();
    dire(msg.playerid, boite(lienFenetre(handout().id, `Ouvrir la fenêtre « ${HANDOUT} »`)));
  };

  const cmdHelp = (msg) => {
    dire(msg.playerid, boite('<b>!buff</b> : menu des effets<br>' +
      '<b>!buff add --name X --dur 5min</b> [--caster Nom] [--targets group|me|selected|pick|Selea,Paz] [--effect texte] [--hidden]<br>' +
      '<b>!buff add --spell bless --cl 5</b> · <b>!buff fav</b> : sorts courants<br>' +
      '<b>!buff edit 3 --dur -1</b> (ou +2, 4r, 10min, perm), --name, --effect, --caster, --targets, --hidden yes|no<br>' +
      '<b>!buff remove 3</b> · <b>!buff clear</b> (sélection) · <b>!buff clear all</b> (MJ)<br>' +
      '<b>!buff time 10min</b> (MJ) · <b>!buff show</b> : lien vers la fenêtre<br>' +
      'Durées : 3r ou 3 (rounds), 10min, 2h, 13h50, 1j, perm. Nom libre forcé : =Nom.'));
  };

  // ------------------------------------------------------- turn tracker
  const lireOrdre = (v) => { try { const o = JSON.parse(v || '[]'); return Array.isArray(o) ? o : []; } catch (e) { return []; } };

  const tourSuivant = (prev, next) => {
    const s = etat();
    if (!next.length) { s.dernierTour = null; return; } // tracker emptied: end of combat
    if (detectAdvance(prev, next) !== 'forward') return;
    // going back then moving to the same turn again does not count twice
    const signature = next.map(cleEntree).join(';');
    if (signature === s.dernierTour) return;
    s.dernierTour = signature;
    if (!s.buffs.length) return;
    const toks = next.map((e) => (e && e.id && !estPerso(e) ? getObj('graphic', e.id) : null));
    // the caster's position in the tracker, or -1 (no caster, or absent)
    const ancre = (b) => {
      if (!b.caster) return -1;
      let i = b.caster.id ? toks.findIndex((t) => tokenEst(b.caster, t)) : -1;
      if (i < 0 && b.caster.name) i = toks.findIndex((t) => t && normalize(nomToken(t)) === normalize(b.caster.name));
      return i;
    };
    const ancres = new Map(s.buffs.map((b) => [b, ancre(b)]));
    const r1 = tick(s.buffs, (b) => ancres.get(b) === 0, 1);
    const r2 = isNewRound(prev, next) ? tick(s.buffs, (b) => ancres.get(b) === -1, 1) : { expired: [], warned: [] };
    traiter({ expired: r1.expired.concat(r2.expired), warned: r1.warned.concat(r2.warned) });
  };

  // ------------------------------------------------------------------ events
  on('ready', () => {
    etat();
    nettoyerMarqueurs();
    rafraichir();
    log(`${NOM} (bufftracker.js) ready: ${etat().buffs.length} effect(s) tracked.`);
  });

  on('chat:message', (msg) => {
    if (msg.type !== 'api') return;
    const c = parseCommand(msg.content);
    if (!c) return;
    try {
      switch (c.sub) {
        case 'menu': case 'list': return cmdMenu(msg);
        case 'add': return cmdAdd(msg, c);
        case 'pick': return cmdPick(msg, c);
        case 'choose': return cmdChoose(msg, c);
        case 'edit': return cmdEdit(msg, c);
        case 'remove': return cmdRemove(msg, c);
        case 'clear': return cmdClear(msg, c);
        case 'time': return cmdTime(msg, c);
        case 'fav': return cmdFav(msg);
        case 'show': case 'handout': return cmdShow(msg);
        case 'help': return cmdHelp(msg);
        default: return erreur(msg.playerid, `Commande inconnue : ${c.sub}. Voir !buff help.`);
      }
    } catch (e) {
      log(`${NOM}: error ${e && e.stack ? e.stack : e}`);
      erreur(msg.playerid, `Erreur du script : ${e && e.message ? e.message : e}`);
    }
  });

  on('change:campaign:turnorder', (obj, prev) => {
    try {
      tourSuivant(lireOrdre(prev && prev.turnorder), lireOrdre(obj.get('turnorder')));
    } catch (e) { log(`${NOM}: tracker error ${e && e.stack ? e.stack : e}`); }
  });

  on('destroy:graphic', (tok) => {
    const s = etat();
    let change = false;
    s.buffs.forEach((b) => {
      const avant = b.targets.length;
      b.targets = b.targets.filter((t) => !(t.kind === 'token' && t.id === tok.id));
      if (b.targets.length !== avant) change = true;
      if (b.caster && b.caster.kind === 'token' && b.caster.id === tok.id) b.caster = { kind: null, id: null, name: nomToken(tok) || b.caster.name };
    });
    s.buffs = s.buffs.filter((b) => b.targets.length);
    if (change) rafraichir();
  });
})();
