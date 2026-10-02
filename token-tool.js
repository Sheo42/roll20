// TokenTool - Roll20 API script (requires a Pro subscription on the game owner's account)
//
// Commands (GM only, replies are whispered to whoever sent the command):
//   !where <name>                    -> position of the matching token(s)
//   !where                           -> position of the selected token(s)
//   !move <name> <direction> [n]     -> move a token n squares (default 1)
//   !move <direction> [n]            -> move the selected token(s)
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

  on('chat:message', (msg) => {
    if (msg.type !== 'api') return;
    if (!playerIsGM(msg.playerid)) return;

    const tokens = msg.content.trim().split(/\s+/);
    const cmd = tokens.shift().toLowerCase();
    if (cmd === '!where') return handleWhere(msg, tokens);
    if (cmd === '!move') return handleMove(msg, tokens);
  });

  log(`${API} ready: !where, !move`);
});
