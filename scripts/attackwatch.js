// attackwatch.js - Roll20 API script, READ ONLY, GM only.
// Watches all the time (even when the GM is away) what creates attack rows:
//   - every change to the "create attack" field (create-attack-entry) of an item, spell or ability,
//     with the old and the new value;
//   - every new attack row (repeating_weapon) of characters controlled by a player,
//     found by re-reading their attacks every 10 seconds: it is seen even if Roll20
//     sends no event (the case of changes made by an API script, which the API does not see);
//     with what it is linked to and the CONTEXT: API commands and object changes
//     on these characters during the 3 minutes before;
//   - every creation, BY AN API SCRIPT, of a "create attack" field or an attack row
//     (createObj), with the functions that called it. Changes (set, setWithWorker) cannot
//     be seen: Roll20 does not let a script change its objects (tried on 10/19);
//   - every restart of the API sandbox;
//   - for every event: the time (UTC) and the players connected at that moment.
// The log is kept in state (the last 60 events) and every event is whispered to the GM.
//
// Usage in chat:
//   !attackwatch          -> status (active or not) and number of recorded events
//   !attackwatch log      -> shows the log
//   !attackwatch on|off   -> turns watching on or off (on by default)
//   !attackwatch clear    -> empties the log
//   !attackwatch context  -> API commands and object changes of the last 3 minutes
//
// Why: the Pathfinder Community sheet creates a new attack linked to an item on EVERY
// change to its create-attack-entry field, without looking at the value. This script tells when that
// field changes, on which character, and who was connected.
// Does not change, delete or create any game object (only its own state is written).

var AttackWatch = (function () {
  'use strict';
  var MAX_LOG = 60;
  var BUTTON_RE = /^repeating_(item|spells|ability)_(-[^_]+)_create-attack-entry$/;
  var WEAPON_RE = /^repeating_weapon_(-[^_]+)_(.+)$/;
  var PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  var SECTION_LABEL = { item: 'objet', spells: 'sort', ability: 'capacité' };
  var SOURCE_FIELDS = [['source-item', 'item'], ['source-spell', 'spells'], ['source-ability', 'ability']];

  function idTime(id) {
    if (!id || id.length < 8) return null;
    var t = 0;
    for (var i = 0; i < 8; i++) {
      var k = PUSH_CHARS.indexOf(id.charAt(i));
      if (k < 0) return null;
      t = t * 64 + k;
    }
    return t;
  }
  function fmt(ms) {
    var d = new Date(ms);
    if (ms === null || ms === undefined || isNaN(d.getTime())) return '?';
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }
  function clean(v, max) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[\[\]{}<>@&"]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 40);
  }
  // "create attack" field: {section, rowId} or null
  function parseButton(name) {
    var m = BUTTON_RE.exec(name || '');
    return m ? { section: m[1], rowId: m[2] } : null;
  }
  // attribute of an attack row: {rowId, field} or null
  function parseWeapon(name) {
    var m = WEAPON_RE.exec(name || '');
    return m ? { rowId: m[1], field: m[2] } : null;
  }
  // a row is new if none of its attributes was created more than `age` ms before `ref`
  function isNewRow(attrIds, ref, age) {
    if (!attrIds.length) return false;
    return attrIds.every(function (id) {
      var t = idTime(id);
      return t !== null && t >= ref - age;
    });
  }
  // origin of an attack row from its fields and the names of the source rows
  function linkOf(fields, sourceNames) {
    for (var i = 0; i < SOURCE_FIELDS.length; i++) {
      var v = fields[SOURCE_FIELDS[i][0]];
      if (!v) continue;
      var sec = SOURCE_FIELDS[i][1];
      var n = (sourceNames[sec] || {})[String(v).toLowerCase()];
      return SECTION_LABEL[sec] + ' « ' + clean(n !== undefined ? n : v, 30) + ' »';
    }
    return 'sans lien';
  }
  function line(e) {
    var who = e.online && e.online.length ? ' · connectés : ' + e.online.join(', ') : ' · personne de connecté';
    if (e.kind === 'restart') return fmt(e.t) + ' · redémarrage du sandbox API' + (e.spy ? ' (écritures des scripts surveillées : ' + (e.spy.length ? e.spy.join(', ') : 'aucune, non disponible') + ')' : '') + who;
    if (e.kind === 'button') {
      return fmt(e.t) + ' · <b>' + clean(e.char, 30) + '</b> : bouton « create attack » de ' + SECTION_LABEL[e.section] +
        ' « ' + clean(e.source, 30) + ' » ' + (e.prev === null ? '(nouveau champ)' : clean(e.prev, 5) + ' -> ' + clean(e.value, 5)) + who;
    }
    if (e.kind === 'apiwrite') {
      return fmt(e.t) + ' · <b>' + clean(e.char, 30) + '</b> : écriture par un script API, ' + e.method + ' ' + clean(e.field, 40) +
        ' = ' + clean(e.value, 12) + (e.callers && e.callers.length ? ' (appelée par : ' + e.callers.map(function (c) { return clean(c, 30); }).join(' ← ') + ')' : '') + who;
    }
    if (e.kind === 'row') {
      var seen = e.seen ? ' (vue ' + (e.atStart ? 'au redémarrage, ' : '') + 'à ' + fmt(e.seen).slice(11, 19) + ')' : '';
      var ctx = e.context === undefined ? '' : (e.context.length ? '<br>&nbsp;&nbsp;avant : ' + e.context.map(function (c) { return clean(c, 160); }).join('<br>&nbsp;&nbsp;') : '<br>&nbsp;&nbsp;avant : rien (aucune commande API ni modification d\'objet)');
      return fmt(e.t) + ' · <b>' + clean(e.char, 30) + '</b> : nouvelle attaque « ' + clean(e.name, 30) + ' », ' + e.link + seen + who + ctx;
    }
    return fmt(e.t) + ' · ?';
  }
  function push(log, e, max) {
    log.push(e);
    while (log.length > (max || MAX_LOG)) log.shift();
    return log;
  }
  // keys (lower case) present in `now` and missing from `before`
  function newKeys(before, now) {
    return Object.keys(now).filter(function (k) { return !before[k]; }).sort();
  }
  // context of an event: entries {t, txt} between t - windowMs and t, the `max` most recent
  function contextFor(ring, t, windowMs, max) {
    var c = ring.filter(function (x) { return x.t <= t && x.t >= t - windowMs; });
    return c.slice(-(max || 8)).map(function (x) { return fmt(x.t).slice(11, 19) + ' ' + x.txt; });
  }
  // field of an item row: {rowId, field} or null
  var ITEM_RE = /^repeating_item_(-[^_]+)_(.+)$/;
  function parseItem(name) {
    var m = ITEM_RE.exec(name || '');
    return m ? { rowId: m[1], field: m[2] } : null;
  }

  // names of the calling functions taken from a call stack (V8), without this script's frames
  function callers(stack, skip, max) {
    return String(stack || '').split('\n').slice(1).map(function (l) {
      var m = /^\s*at\s+(?:async\s+)?([^\s(]+)(?:\s+\[as [^\]]+\])?\s*\(/.exec(l);
      return m ? m[1] : (/^\s*at\s/.test(l) ? '(anonyme)' : null);
    }).filter(function (n) { return n && !skip.test(n); }).slice(0, max || 4);
  }
  // attribute name we want to see written by scripts
  function watchedName(name) {
    return !!(parseButton(name) || parseWeapon(name));
  }

  return { idTime: idTime, fmt: fmt, clean: clean, callers: callers, watchedName: watchedName, parseButton: parseButton, parseWeapon: parseWeapon, parseItem: parseItem,
    isNewRow: isNewRow, linkOf: linkOf, line: line, push: push, newKeys: newKeys, contextFor: contextFor, MAX_LOG: MAX_LOG };
})();

if (typeof module !== 'undefined') module.exports = AttackWatch;

(function () {
  'use strict';
  if (typeof on !== 'function') return;
  var W = AttackWatch;
  var POLL = 5000;           // ms: one re-read round
  var PER_TICK = 12;         // characters re-read per round (each one is re-read every ~40 s with 96 characters)
  var cursor = 0;
  var REPORT_DELAY = 2000;   // ms: gives the sheet time to write the name and the link
  var CONTEXT_MS = 180000;   // ms: context kept before a new attack
  var ring = [];             // recent context (memory only): {t, txt}
  var polls = 0;

  function st() {
    state.AttackWatch = state.AttackWatch || { on: true, log: [] };
    state.AttackWatch.known = state.AttackWatch.known || {};
    return state.AttackWatch;
  }
  function online() {
    return findObjs({ _type: 'player', _online: true }).map(function (p) { return W.clean(p.get('_displayname'), 25); });
  }
  function record(e) {
    var s = st();
    if (!s.on) return;
    e.online = online();
    W.push(s.log, e);
    sendChat('attackwatch', '/w gm ' + W.line(e), null, { noarchive: true });
  }
  function note(txt) { W.push(ring, { t: Date.now(), txt: txt }, 80); }
  function attrsOf(charId) {
    return findObjs({ _type: 'attribute', _characterid: charId });
  }
  function sourceName(charId, section, rowId) {
    var a = findObjs({ _type: 'attribute', _characterid: charId, name: 'repeating_' + section + '_' + rowId + '_name' })[0];
    return a ? a.get('current') : rowId;
  }
  function charName(charId) {
    var c = getObj('character', charId);
    return c ? c.get('name') : charId;
  }
  function played() {
    return findObjs({ _type: 'character' }).filter(function (c) { return !!c.get('controlledby'); });
  }

  // ids (lower case) of a character's attack rows
  function weaponRows(cid) {
    var keys = {};
    attrsOf(cid).forEach(function (a) {
      var w = W.parseWeapon(a.get('name'));
      if (w) keys[w.rowId.toLowerCase()] = 1;
    });
    return keys;
  }
  function reportRow(cid, key, seen, atStart, context) {
    var prefix = 'repeating_weapon_' + key + '_', fields = {}, names = { item: {}, spells: {}, ability: {} }, born = null;
    attrsOf(cid).forEach(function (a) {
      var n = a.get('name'), low = n.toLowerCase(), m;
      if (low.indexOf(prefix) === 0) {
        fields[n.slice(prefix.length)] = a.get('current');
        var t = W.idTime(a.id);
        if (t !== null && (born === null || t < born)) born = t;
      } else if ((m = /^repeating_(item|spells|ability)_(-[^_]+)_name$/.exec(n))) {
        names[m[1]][m[2].toLowerCase()] = a.get('current');
      }
    });
    record({ kind: 'row', t: born || seen, seen: seen, atStart: atStart, char: charName(cid), name: fields.name || '',
      link: W.linkOf(fields, names), context: context });
  }
  // re-reads the attacks of played characters and announces the new rows
  function poll() {
    var s = st(), now = Date.now(), atStart = polls === 0;
    polls++;
    if (!s.on) return;
    var all = played();
    // at startup, everyone at once; then, a few characters per round
    var batch = atStart ? all : [];
    for (var i = 0; !atStart && i < Math.min(PER_TICK, all.length); i++) batch.push(all[(cursor + i) % all.length]);
    cursor = all.length ? (cursor + PER_TICK) % all.length : 0;
    batch.forEach(function (c) {
      var cid = c.id, rows = weaponRows(cid);
      var before = s.known[cid];
      s.known[cid] = rows;
      if (!before) return; // first time we see this character: baseline
      var fresh = W.newKeys(before, rows);
      if (!fresh.length) return;
      var context = W.contextFor(ring, now, CONTEXT_MS, 8);
      fresh.forEach(function (k) {
        setTimeout(function () { reportRow(cid, k, now, atStart, context); }, REPORT_DELAY);
      });
    });
  }

  // API scripts share the same sandbox: we wrap the attribute write methods
  // (shared prototype) and createObj to see the writes of OTHER scripts. Read only: the original
  // call is always made, unchanged.
  var SKIP = /(spyWrap|spyCreate|logWrite)/;
  function logWrite(method, obj, field, value) {
    var cid = obj && obj.get ? obj.get('_characterid') : '';
    var e = { kind: 'apiwrite', t: Date.now(), method: method, char: charName(cid), field: field, value: value,
      callers: W.callers(new Error().stack, SKIP, 4) };
    record(e);
    note(W.clean(e.char, 25) + ' : écriture API ' + method + ' ' + W.clean(field, 40) + ' = ' + W.clean(value, 12) +
      (e.callers.length ? ' par ' + e.callers.join(' ← ') : ''));
  }
  // wraps method m (set / setWithWorker) of the `owner` object (prototype or the attribute itself)
  function wrapMethod(owner, m) {
    if (!owner || typeof owner[m] !== 'function' || owner[m].__attackwatch) return false;
    var orig = owner[m];
    var spyWrap = function (a, b) {
      try {
        if (this && this.get && this.get('_type') === 'attribute' && W.watchedName(this.get('name'))) {
          var v = typeof a === 'object' && a ? (a.current !== undefined ? a.current : JSON.stringify(a)) : (a === 'current' ? b : a + '=' + b);
          logWrite(m, this, this.get('name'), v);
        }
      } catch (err) { /* never get in the way of the original call */ }
      return orig.apply(this, arguments);
    };
    spyWrap.__attackwatch = true;
    owner[m] = spyWrap;
    return owner[m] === spyWrap;
  }
  function installSpy() {
    var done = [];
    var sample = null;
    try {
      // one attribute of a played character is enough (do not load all the game's attributes)
      var c0 = played()[0];
      sample = c0 ? findObjs({ _type: 'attribute', _characterid: c0.id })[0] : null;
    } catch (err) { sample = null; }
    ['set', 'setWithWorker'].forEach(function (m) {
      try {
        // first object in the prototype chain that has the method
        var p = sample;
        while (p && !Object.prototype.hasOwnProperty.call(p, m)) p = Object.getPrototypeOf(p);
        if (p && p !== sample && p !== Object.prototype && wrapMethod(p, m)) done.push(m);
      } catch (err) { /* prototype not writable */ }
    });
    try {
      if (typeof createObj === 'function' && !createObj.__attackwatch) {
        var origCreate = createObj;
        var spyCreate = function (type, props) {
          var o = origCreate.apply(this, arguments);
          try {
            if (type === 'attribute' && props && W.watchedName(props.name)) logWrite('createObj', o, props.name, props.current);
          } catch (err) { /* same */ }
          return o;
        };
        spyCreate.__attackwatch = true;
        createObj = spyCreate; // eslint-disable-line no-global-assign
        if (createObj === spyCreate) done.push('createObj');
      }
    } catch (err) { /* createObj not writable */ }
    return done;
  }

  function onChange(obj, prev) {
    var name = obj.get('name'), cid = obj.get('_characterid');
    var b = W.parseButton(name);
    if (b) {
      record({ kind: 'button', t: Date.now(), char: charName(cid), section: b.section,
        source: sourceName(cid, b.section, b.rowId),
        prev: prev ? prev.current : null, value: obj.get('current') });
      note(charName(cid) + ' : bouton create attack de « ' + W.clean(sourceName(cid, b.section, b.rowId), 40) + ' »');
      return;
    }
    var it = W.parseItem(name);
    if (!it || !st().known[cid]) return; // objects of played characters only
    note(charName(cid) + ' : objet « ' + W.clean(sourceName(cid, 'item', it.rowId), 40) + ' » ' + W.clean(it.field, 25) + ' ' +
      W.clean(prev ? prev.current : '', 12) + ' → ' + W.clean(obj.get('current'), 12));
  }

  on('ready', function () {
    record({ kind: 'restart', t: Date.now(), spy: installSpy() });
    on('change:attribute', onChange);
    on('add:attribute', function (obj) { onChange(obj, null); });
    on('chat:message', function (msg) {
      if (msg.type === 'api' && !/^!attackwatch/.test(msg.content)) note(W.clean(msg.who, 20) + ' : ' + W.clean(msg.content, 50));
    });
    poll();
    setInterval(poll, POLL);
  });

  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!attackwatch(\s|$)/.test(msg.content)) return;
    if (!playerIsGM(msg.playerid)) return;
    var who = msg.who.replace(/ \(GM\)$/, '');
    var reply = function (t) { sendChat('attackwatch', '/w "' + who + '" ' + t, null, { noarchive: true }); };
    var arg = msg.content.replace(/^!attackwatch\s*/, '').trim().toLowerCase();
    var s = st();
    if (arg === 'on' || arg === 'off') { s.on = arg === 'on'; reply('Surveillance ' + (s.on ? 'activée.' : 'coupée.')); return; }
    if (arg === 'clear') { s.log = []; reply('Journal vidé.'); return; }
    if (arg === 'context') {
      var c = W.contextFor(ring, Date.now(), CONTEXT_MS, 15);
      reply(c.length ? 'Contexte des 3 dernières minutes :<br>' + c.map(function (x) { return W.clean(x, 160); }).join('<br>') : 'Contexte vide.');
      return;
    }
    if (arg === 'log') {
      if (!s.log.length) { reply('Journal vide.'); return; }
      for (var i = 0, n = 0; i < s.log.length; i += 10, n++) {
        (function (chunk, delay) { setTimeout(function () { reply(chunk); }, delay); })(s.log.slice(i, i + 10).map(W.line).join('<br>'), n * 400);
      }
      return;
    }
    if (arg) { reply('Usage : !attackwatch [log|context|on|off|clear]'); return; }
    reply('Surveillance ' + (s.on ? 'active' : 'coupée') + ', ' + s.log.length + ' évènements dans le journal (!attackwatch log), ' +
      Object.keys(s.known).length + ' personnages joués surveillés.');
  });
})();
