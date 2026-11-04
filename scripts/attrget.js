// attrget.js - diagnostic Roll20, LECTURE SEULE, réservé au MJ.
//
//   !attrget <personnage> <attribut> [attribut...]
//
// Chuchote la valeur (current, et max s'il y en a un) de chaque attribut demandé.
// Un nom peut finir par * pour lister tous les attributs qui commencent ainsi (ex: migrated*).
// La casse est ignorée. Un attribut absent est signalé comme tel.
// Le nom du personnage peut contenir des espaces : c'est le plus long début de la commande
// qui correspond à un personnage. Un seul passage sur les attributs. Ne modifie aucun objet du jeu.

var AttrGet = (function () {
  'use strict';
  var MAX_SHOWN = 40;

  var clean = function (v, max) {
    return String(v === undefined || v === null ? '' : v).replace(/[\[\]{}<>@&"]/g, '').replace(/\s+/g, ' ').slice(0, max || 80);
  };

  // words: mots de la commande ; charNames: noms des personnages du jeu
  // -> { name, patterns } ou null si aucun début de commande ne correspond à un personnage
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

  // attrs: [{ name, current, max }] -> lignes à chuchoter
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
