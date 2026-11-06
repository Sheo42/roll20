// dupes.js - Roll20 API script, READ ONLY, GM only.
// Usage in chat:
//   !dupes Character Name          -> summary + list of duplicates whose values DIFFER
//   !dupes Character Name all      -> same + names of identical duplicates
//
// For each attribute name present several times on the character, compares the
// copies (current value and max). Roll20 ids are Firebase "push ids":
// their first 8 characters encode the creation date, which tells
// which copy is the oldest and when each one was created (UTC time;
// Paris = UTC+2 in October).
// Does not change, delete or create any game object.

(function () {
  var PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

  // creation date encoded in a Firebase id (ms since 1970), or null
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
  var fmt = function (ms) {
    if (ms === null) return '?';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '?';
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  };
  // removes anything that could be read as a dice roll or HTML in chat
  var clean = function (v, max) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[\[\]{}<>@&"]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, max || 40);
  };

  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!dupes(\s|$)/.test(msg.content)) return;
    if (!playerIsGM(msg.playerid)) return;

    var who = msg.who.replace(/ \(GM\)$/, '');
    var reply = function (t) { sendChat('dupes', '/w "' + who + '" ' + t); };
    // sends several spaced-out messages (avoids flooding the chat)
    var replyLines = function (lines, perMsg) {
      var chunks = [];
      for (var i = 0; i < lines.length; i += perMsg) chunks.push(lines.slice(i, i + perMsg).join('<br>'));
      chunks.forEach(function (c, n) { setTimeout(function () { reply(c); }, n * 400); });
    };

    var args = msg.content.replace(/^!dupes\s*/, '').trim();
    var showAll = false;
    if (/\s+all$/i.test(args)) { showAll = true; args = args.replace(/\s+all$/i, '').trim(); }
    var name = args.toLowerCase();
    if (!name) { reply('Usage : !dupes nom du personnage [all]'); return; }

    var chars = findObjs({ _type: 'character' }).filter(function (c) {
      return (c.get('name') || '').toLowerCase() === name;
    });
    if (!chars.length) { reply('Aucun personnage nommé ' + clean(name) + '.'); return; }

    chars.forEach(function (c) {
      // a single pass over the attributes
      var attrs = findObjs({ _type: 'attribute', _characterid: c.id });
      var groups = {};
      attrs.forEach(function (a) {
        var n = a.get('name');
        (groups[n] = groups[n] || []).push({
          id: a.id,
          cur: a.get('current'),
          max: a.get('max'),
          t: idTime(a.id)
        });
      });

      var dupNames = Object.keys(groups).filter(function (n) { return groups[n].length > 1; });
      var identical = [];
      var different = [];
      var extraObjects = 0;
      var tMin = null, tMax = null;     // creation window of the EXTRA copies (not the oldest ones)

      dupNames.forEach(function (n) {
        var g = groups[n].slice().sort(function (x, y) { return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0); });
        extraObjects += g.length - 1;
        for (var i = 1; i < g.length; i++) {
          if (g[i].t !== null) {
            tMin = (tMin === null || g[i].t < tMin) ? g[i].t : tMin;
            tMax = (tMax === null || g[i].t > tMax) ? g[i].t : tMax;
          }
        }
        var same = g.every(function (x) {
          return String(x.cur) === String(g[0].cur) && String(x.max) === String(g[0].max);
        });
        (same ? identical : different).push({ name: n, items: g });
      });

      var out = [];
      out.push('<b>' + clean(c.get('name')) + '</b> : ' + attrs.length + ' attributs, ' + dupNames.length + ' noms en double (' + extraObjects + ' exemplaires en trop)');
      out.push('identiques : ' + identical.length + ' / valeurs différentes : ' + different.length);
      if (tMin !== null) {
        out.push('exemplaires en trop créés entre ' + fmt(tMin) + ' et ' + fmt(tMax));
      }
      if (!dupNames.length) out.push('Aucun doublon.');
      reply(out.join('<br>'));

      var lines = [];
      if (different.length) {
        lines.push('<b>Doublons aux valeurs différentes</b> (ancien -> récent, par date de création)');
        different.forEach(function (d) {
          var parts = d.items.map(function (x, i) {
            return (i === 0 ? 'ANCIEN ' : 'récent ') + clean(x.cur, 30) + (x.max !== '' && x.max !== undefined ? '/' + clean(x.max, 15) : '') + ' (' + fmt(x.t).slice(0, 16) + ')';
          });
          lines.push(clean(d.name, 50) + ' : ' + parts.join(' | '));
        });
      }
      if (showAll && identical.length) {
        lines.push('<b>Doublons identiques</b>');
        lines.push(identical.map(function (d) { return clean(d.name, 40); }).join(', '));
      }
      if (lines.length) setTimeout(function () { replyLines(lines, 12); }, 500);
    });
  });
})();
