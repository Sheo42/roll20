// dedup.js - Roll20 API script, GM only. DELETES duplicate attributes, with safeguards.
//
// Usage in chat:
//   !dedup Character Name                 -> DRY RUN: deletes nothing, reports what would be deleted
//   !dedup Character Name confirm 703   -> deletes, ONLY if the number (703) is still exact
//
// For each attribute name present several times on the character:
//   - the OLDEST copy is always kept (id order = creation order);
//   - only recent copies that meet ALL these conditions are deleted:
//       * created in the WINDOW_FROM -> WINDOW_TO window (see below, UTC time);
//       * same current value AND same max as the kept copy;
//       * the kept copy was created BEFORE the window;
//       * the name does not start with "repeating_" (repeating sections are never touched).
//   - everything else is left as is and listed as "ignored".
// Deletion is done in batches, with a pause, so as not to trigger the loop detection.
//
// ADJUST if needed: the window below matches the copies created on 2026-10-03
// between 09:05 and 14:21 UTC (!dupes report), with a margin.

(function () {
  var WINDOW_FROM = Date.UTC(2026, 9, 3, 9, 0);    // 2026-10-03 09:00 UTC (months start at 0)
  var WINDOW_TO   = Date.UTC(2026, 9, 3, 14, 30);  // 2026-10-03 14:30 UTC
  var BATCH = 40;      // deletions per batch
  var PAUSE = 400;     // ms between two batches

  var PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  var idTime = function (id) {
    if (!id || id.length < 8) return null;
    var t = 0;
    for (var i = 0; i < 8; i++) {
      var k = PUSH_CHARS.indexOf(id.charAt(i));
      if (k < 0) return null;
      t = t * 64 + k;
    }
    return t;
  };
  var fmt = function (ms) { return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; };
  var clean = function (v, max) {
    return String(v === undefined || v === null ? '' : v).replace(/[\[\]{}<>@&"]/g, '').replace(/\s+/g, ' ').slice(0, max || 40);
  };

  // computes a character's cleanup plan, without changing anything
  var buildPlan = function (charId) {
    var attrs = findObjs({ _type: 'attribute', _characterid: charId });
    var groups = {};
    attrs.forEach(function (a) { (groups[a.get('name')] = groups[a.get('name')] || []).push(a); });

    var plan = { total: attrs.length, dupNames: 0, remove: [], skipped: { repeating: [], keepNotOld: [], other: [] } };
    Object.keys(groups).forEach(function (name) {
      var g = groups[name];
      if (g.length < 2) return;
      plan.dupNames++;
      if (/^repeating_/.test(name)) { plan.skipped.repeating.push(name); return; }

      g = g.slice().sort(function (x, y) { return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0); });
      var keep = g[0];
      var kt = idTime(keep.id);
      if (kt === null || kt >= WINDOW_FROM) { plan.skipped.keepNotOld.push(name); return; }

      var leftover = false;
      g.slice(1).forEach(function (x) {
        var t = idTime(x.id);
        var same = String(x.get('current')) === String(keep.get('current')) &&
                   String(x.get('max')) === String(keep.get('max'));
        if (t !== null && t >= WINDOW_FROM && t <= WINDOW_TO && same) plan.remove.push(x);
        else leftover = true;
      });
      if (leftover) plan.skipped.other.push(name);
    });
    return plan;
  };

  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!dedup(\s|$)/.test(msg.content)) return;
    if (!playerIsGM(msg.playerid)) return;

    var who = msg.who.replace(/ \(GM\)$/, '');
    var reply = function (t) { sendChat('dedup', '/w "' + who + '" ' + t); };

    var args = msg.content.replace(/^!dedup\s*/, '').trim();
    var confirmCount = null;
    var m = args.match(/\s+confirm\s+(\d+)$/i);
    if (m) { confirmCount = parseInt(m[1], 10); args = args.replace(/\s+confirm\s+\d+$/i, '').trim(); }
    var name = args.toLowerCase();
    if (!name) { reply('Usage : !dedup nom du personnage [confirm N]'); return; }

    var chars = findObjs({ _type: 'character' }).filter(function (c) { return (c.get('name') || '').toLowerCase() === name; });
    if (chars.length !== 1) { reply(chars.length ? 'Plusieurs personnages portent ce nom, abandon.' : 'Aucun personnage nommé ' + clean(name) + '.'); return; }
    var c = chars[0];

    var plan = buildPlan(c.id);
    var n = plan.remove.length;
    var info = [];
    info.push('<b>' + clean(c.get('name')) + '</b> : ' + plan.total + ' attributs, ' + plan.dupNames + ' noms en double');
    info.push('fenêtre de nettoyage : ' + fmt(WINDOW_FROM) + ' -> ' + fmt(WINDOW_TO));
    info.push('exemplaires supprimables : <b>' + n + '</b>');
    info.push('ignorés : ' + plan.skipped.repeating.length + ' sections répétées, ' +
              plan.skipped.keepNotOld.length + ' sans original antérieur à la fenêtre, ' +
              plan.skipped.other.length + ' avec une copie différente ou hors fenêtre');
    if (plan.skipped.other.length) info.push('à vérifier : ' + plan.skipped.other.slice(0, 10).map(function (s) { return clean(s, 40); }).join(', '));

    if (confirmCount === null) {
      info.push(n ? 'ESSAI À BLANC : rien n\'a été supprimé. Pour supprimer : <b>!dedup ' + clean(c.get('name')) + ' confirm ' + n + '</b>' : 'Rien à supprimer.');
      reply(info.join('<br>'));
      return;
    }

    if (confirmCount !== n) {
      info.push('ABANDON : tu as confirmé ' + confirmCount + ' mais il y en a ' + n + ' maintenant. Relance l\'essai à blanc.');
      reply(info.join('<br>'));
      return;
    }
    if (!n) { reply(info.join('<br>')); return; }

    reply(info.join('<br>') + '<br>Suppression de ' + n + ' exemplaires en cours...');
    var queue = plan.remove.slice();
    var removed = 0;
    var step = function () {
      queue.splice(0, BATCH).forEach(function (a) { a.remove(); removed++; });
      if (queue.length) setTimeout(step, PAUSE);
      else reply('Terminé : ' + removed + ' exemplaires supprimés. Relance !dupes ' + clean(c.get('name')) + ' pour vérifier.');
    };
    step();
  });
})();
