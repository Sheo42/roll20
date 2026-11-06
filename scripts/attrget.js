// attrget.js - Roll20 diagnostic, READ ONLY, GM only.
//
//   !attrget <character> <attribute> [attribute...]
//
// Whispers the value (current, and max if there is one) of each requested attribute.
// A name can end with * to list all attributes starting that way (e.g. migrated*).
// Case is ignored. A missing attribute is reported as such.
// The character name can contain spaces: it is the longest start of the command
// that matches a character. A single pass over the attributes. Does not change any game object.

var AttrGet = (function () {
  'use strict';
  var MAX_SHOWN = 40;

  var clean = function (v, max) {
    return String(v === undefined || v === null ? '' : v).replace(/[\[\]{}<>@&"]/g, '').replace(/\s+/g, ' ').slice(0, max || 80);
  };

  // words: words of the command; charNames: names of the game's characters
  // -> { name, patterns } or null if no start of the command matches a character
  function parseArgs(words, charNames) {
    var known = {};
    charNames.forEach(function (n) { known[String(n || '').toLowerCase()] = n; });
    for (var i = words.length - 1; i >= 1; i--) {
      var candidate = words.slice(0, i).join(' ').toLowerCase();
      if (known[candidate] !== undefined) {
        return { name: known[candidate], patterns: words.slice(i) };
      }
    }
    return null;
  }

  function matcher(pattern) {
    var p = String(pattern).toLowerCase();
    if (p.slice(-1) === '*') {
      var prefix = p.slice(0, -1);
      return function (n) { return n.toLowerCase().indexOf(prefix) === 0; };
    }
    return function (n) { return n.toLowerCase() === p; };
  }

  // attrs: [{ name, current, max }] -> lines to whisper
  function report(charName, attrs, patterns) {
    var out = ['<b>' + clean(charName) + '</b> : ' + attrs.length + ' attributs'];
    patterns.forEach(function (p) {
      var test = matcher(p);
      var hits = attrs.filter(function (a) { return test(a.name || ''); });
      if (!hits.length) { out.push(clean(p) + ' : absent'); return; }
      hits.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
      hits.slice(0, MAX_SHOWN).forEach(function (a) {
        var max = a.max === undefined || a.max === null || a.max === '' ? '' : ' (max ' + clean(a.max, 40) + ')';
        out.push(clean(a.name, 60) + ' = "' + clean(a.current) + '"' + max);
      });
      if (hits.length > MAX_SHOWN) out.push('... et ' + (hits.length - MAX_SHOWN) + ' autres pour ' + clean(p));
    });
    return out;
  }

  return { parseArgs: parseArgs, report: report, clean: clean, MAX_SHOWN: MAX_SHOWN };
})();

if (typeof module !== 'undefined') module.exports = AttrGet;

(function () {
  'use strict';
  if (typeof on !== 'function') return;

  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!attrget(\s|$)/.test(msg.content)) return;
    if (!playerIsGM(msg.playerid)) return;
    var who = msg.who.replace(/ \(GM\)$/, '');
    var reply = function (t) { sendChat('attrget', '/w "' + who + '" ' + t); };

    var words = msg.content.replace(/^!attrget\s*/, '').trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) { reply('Usage : !attrget nom du personnage attribut [attribut...] (préfixe* accepté)'); return; }

    var chars = findObjs({ _type: 'character' });
    var args = AttrGet.parseArgs(words, chars.map(function (c) { return c.get('name'); }));
    if (!args) { reply('Aucun personnage ne correspond au début de : ' + AttrGet.clean(words.join(' '))); return; }

    chars.filter(function (c) { return c.get('name') === args.name; }).forEach(function (c) {
      var attrs = findObjs({ _type: 'attribute', _characterid: c.id }).map(function (a) {
        return { name: a.get('name'), current: a.get('current'), max: a.get('max') };
      });
      var lines = AttrGet.report(c.get('name'), attrs, args.patterns);
      for (var i = 0, n = 0; i < lines.length; i += 15, n++) {
        (function (chunk, delay) { setTimeout(function () { reply(chunk); }, delay); })(lines.slice(i, i + 15).join('<br>'), n * 400);
      }
    });
  });
})();
