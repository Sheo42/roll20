// TokenTool - Roll20 API script (requires a Pro subscription on the game owner's account)
//
// Commands (GM only, replies are whispered to whoever sent the command):
//   !where <name>                    -> position of the matching token(s)
//   !where                           -> position of the selected token(s)
//   !move <name> <direction> [n]     -> move a token n squares (default 1)
//   !move <direction> [n]            -> move the selected token(s)
//   !hpcheck [all]                   -> audit: compares each PC's stored max HP with the
//                                       Pathfinder Community Sheet formula (all = include NPCs)
//   !hplog on|off|status             -> whispers to the GM every change to HP, temp HP,
//                                       Energy Drain and token bars, with timestamps
//
// Directions: left right up down upleft upright downleft downright
// Short forms: l r u d ul ur dl dr
// French:      gauche droite haut bas
//
// Examples:
//   !where Bec-Acier 1
//   !move Bec-Acier 1 left 4
//   !move upright 2          (with a token selected)
//
// Name matching: an exact name wins. Otherwise any token whose name contains the
// text is matched. !move refuses to act if several tokens match, so use the
// full name (e.g. "Bec-Acier 1") when there are numbered copies.

on('ready', () => {
  const API = 'TokenTool';
  const SQUARE = 70; // pixels per grid square in Roll20

  const DIRS = {
    left: [-1, 0], l: [-1, 0], gauche: [-1, 0],
    right: [1, 0], r: [1, 0], droite: [1, 0],
    up: [0, -1], u: [0, -1], haut: [0, -1],
    down: [0, 1], d: [0, 1], bas: [0, 1],
    upleft: [-1, -1], ul: [-1, -1],
    upright: [1, -1], ur: [1, -1],
    downleft: [-1, 1], dl: [-1, 1],
    downright: [1, 1], dr: [1, 1]
  };

  const reply = (msg, text) => {
    const who = (msg.who || 'gm').replace(/ \(GM\)$/, '');
    sendChat(API, `/w "${who}" ${text}`);
  };

  const currentPageTokens = () => {
    const pageId = Campaign().get('playerpageid');
    return findObjs({ _type: 'graphic', _subtype: 'token', _pageid: pageId });
  };

  const selectedTokens = (msg) =>
    (msg.selected || [])
      .map((s) => getObj('graphic', s._id))
      .filter((t) => t && t.get('_subtype') === 'token');

  const findByName = (query) => {
    const q = query.trim().toLowerCase();
    const all = currentPageTokens();
    const exact = all.filter((t) => (t.get('name') || '').toLowerCase() === q);
    if (exact.length) return exact;
    return all.filter((t) => (t.get('name') || '').toLowerCase().includes(q));
  };

  const describe = (t) => {
    const left = t.get('left');
    const top = t.get('top');
    const col = Math.floor(left / SQUARE) + 1;
    const row = Math.floor(top / SQUARE) + 1;
    return `${t.get('name') || '(no name)'}: square col ${col}, row ${row} (x=${Math.round(left)}px, y=${Math.round(top)}px)`;
  };

  const resolveTargets = (msg, nameText) => {
    if (nameText) return findByName(nameText);
    return selectedTokens(msg);
  };

  const handleWhere = (msg, args) => {
    const targets = resolveTargets(msg, args.join(' '));
    if (!targets.length) {
      return reply(msg, 'No matching token on the current player page. Give a name or select a token.');
    }
    const lines = targets.slice(0, 10).map(describe);
    if (targets.length > 10) lines.push(`...and ${targets.length - 10} more`);
    reply(msg, lines.join(' | '));
  };

  const handleMove = (msg, args) => {
    const parts = args.slice();
    let count = 1;
    if (parts.length && /^\d+$/.test(parts[parts.length - 1])) {
      count = parseInt(parts.pop(), 10);
    }
    const dirWord = (parts.pop() || '').toLowerCase();
    const dir = DIRS[dirWord];
    if (!dir) {
      return reply(msg, 'Usage: !move <name> <direction> [squares]. Directions: left right up down upleft upright downleft downright.');
    }

    const targets = resolveTargets(msg, parts.join(' '));
    if (!targets.length) {
      return reply(msg, 'No matching token on the current player page. Give a name or select a token.');
    }
    const named = parts.length > 0;
    if (named && targets.length > 1) {
      const names = targets.slice(0, 10).map((t) => t.get('name') || '(no name)').join(', ');
      return reply(msg, `Several tokens match: ${names}. Use the full name.`);
    }

    const page = getObj('page', targets[0].get('_pageid'));
    const maxX = page ? page.get('width') * SQUARE : Infinity;
    const maxY = page ? page.get('height') * SQUARE : Infinity;

    const lines = targets.map((t) => {
      const newLeft = Math.min(Math.max(t.get('left') + dir[0] * count * SQUARE, 0), maxX);
      const newTop = Math.min(Math.max(t.get('top') + dir[1] * count * SQUARE, 0), maxY);
      t.set({ left: newLeft, top: newTop });
      return describe(t);
    });
    reply(msg, `Moved ${count} ${dirWord}. ${lines.join(' | ')}`);
  };

  // ---- HP diagnostics (Pathfinder Community Sheet) -------------------------

  const num = (v) => parseInt(v, 10) || 0;
  const attr = (cid, name, which) => getAttrByName(cid, name, which);

  // Max HP as the sheet computes it (PFHealth.updateMaxHPLookup):
  //   ability mod x level + class HP + HP formula misc + 5 x Energy Drain (+ mythic HP)
  const handleHpCheck = (msg, args) => {
    const all = args.some((a) => a.toLowerCase() === 'all');
    const chars = findObjs({ _type: 'character' }).filter(
      (c) => all || (c.get('controlledby') || '').length > 0
    );
    if (!chars.length) return reply(msg, 'No player-controlled characters found. Try !hpcheck all.');

    chars.forEach((c) => {
      const id = c.id;
      const cur = num(attr(id, 'HP'));
      const max = num(attr(id, 'HP', 'max'));
      const level = num(attr(id, 'level'));
      const abilityMod = num(attr(id, 'HP-ability-mod'));
      const classHp = num(attr(id, 'total-hp'));
      const formulaMod = num(attr(id, 'HP-formula-mod'));
      const drained = num(attr(id, 'condition-Drained'));
      const mythicHp = num(attr(id, 'mythic-adventures-show')) ? num(attr(id, 'total-mythic-hp')) : 0;
      const temp = num(attr(id, 'HP-temp'));
      const incOn = num(attr(id, 'increase_hp')) ? 'on' : 'off';

      const expected = abilityMod * level + classHp + formulaMod + 5 * drained + mythicHp;
      const diff = max - expected;
      const verdict = diff === 0 ? 'OK' : `MISMATCH (stored max is ${diff > 0 ? '+' : ''}${diff} vs formula)`;

      reply(
        msg,
        `${c.get('name')}: HP ${cur}/${max}, formula gives ${expected} ` +
          `(${abilityMod}x${level} + ${classHp} + ${formulaMod} + 5x${drained}${mythicHp ? ' + ' + mythicHp : ''}), ` +
          `temp ${temp}, HP follows max changes: ${incOn} -> ${verdict}`
      );
    });
  };

  state.TokenTool = state.TokenTool || { hplog: false };

  const stamp = () => new Date().toISOString().slice(17, 23); // SS.mmm
  const gmLog = (text) => sendChat(API, `/w gm HPLOG ${stamp()} ${text}`);
  const charName = (id) => {
    const c = getObj('character', id);
    return c ? c.get('name') : id;
  };
  const WATCHED = /^(hp|hp-temp|condition-drained|non-lethal-damage)$/i;

  const handleHpLog = (msg, args) => {
    const mode = (args[0] || 'status').toLowerCase();
    if (mode === 'on') state.TokenTool.hplog = true;
    else if (mode === 'off') state.TokenTool.hplog = false;
    reply(msg, `HP log is ${state.TokenTool.hplog ? 'ON' : 'OFF'}. Usage: !hplog on|off|status`);
  };

  on('change:attribute', (obj, prev) => {
    if (!state.TokenTool.hplog) return;
    const name = obj.get('name');
    if (!WATCHED.test(name)) return;
    const cur = obj.get('current');
    const max = obj.get('max');
    if (cur === prev.current && max === prev.max) return;
    const maxPart = name.toLowerCase() === 'hp' ? ` (max ${prev.max} -> ${max})` : '';
    gmLog(`${charName(obj.get('characterid'))} attribute ${name}: ${prev.current} -> ${cur}${maxPart}`);
  });

  on('change:graphic', (obj, prev) => {
    if (!state.TokenTool.hplog) return;
    const cid = obj.get('represents');
    if (!cid) return;
    const page = getObj('page', obj.get('_pageid'));
    [1, 2, 3].forEach((n) => {
      const v = `bar${n}_value`;
      const m = `bar${n}_max`;
      if (obj.get(v) !== prev[v] || obj.get(m) !== prev[m]) {
        gmLog(
          `token ${obj.get('name') || charName(cid)} on page ${page ? page.get('name') : '?'} bar${n}: ` +
            `${prev[v]}/${prev[m]} -> ${obj.get(v)}/${obj.get(m)}`
        );
      }
    });
  });

  on('chat:message', (msg) => {
    if (msg.type !== 'api') return;
    if (!playerIsGM(msg.playerid)) return;

    const tokens = msg.content.trim().split(/\s+/);
    const cmd = tokens.shift().toLowerCase();
    if (cmd === '!where') return handleWhere(msg, tokens);
    if (cmd === '!move') return handleMove(msg, tokens);
    if (cmd === '!hpcheck') return handleHpCheck(msg, tokens);
    if (cmd === '!hplog') return handleHpLog(msg, tokens);
  });

  log(`${API} ready: !where, !move, !hpcheck, !hplog`);
});
