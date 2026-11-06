// pjinfo.js - Roll20 API script, READ ONLY, GM only.
// Usage in chat: !pjinfo Character Name
// Whispers to the GM: identity, classes, abilities, duplicate attributes,
// and flags any handout with the same name as the character.
// Does not change any game object.

on('chat:message', function (msg) {
  if (msg.type !== 'api' || !/^!pjinfo(\s|$)/.test(msg.content)) return;
  if (!playerIsGM(msg.playerid)) return;

  var who = msg.who.replace(/ \(GM\)$/, '');
  var clean = function (v) {
    // removes anything that could be read as a roll or HTML in chat
    return String(v === undefined || v === null ? '' : v).replace(/[\[\]{}<>@&]/g, '').slice(0, 80);
  };
  var reply = function (t) { sendChat('pjinfo', '/w "' + who + '" ' + t); };

  var name = msg.content.replace(/^!pjinfo\s*/, '').trim().toLowerCase();
  if (!name) { reply('Usage : !pjinfo nom du personnage'); return; }

  var chars = findObjs({ _type: 'character' }).filter(function (c) {
    return (c.get('name') || '').toLowerCase() === name;
  });
  var handouts = findObjs({ _type: 'handout' }).filter(function (h) {
    return (h.get('name') || '').toLowerCase() === name;
  });

  if (!chars.length) {
    reply('Aucun personnage nommé ' + clean(name) + '. Handouts du même nom : ' + handouts.length + '.');
    return;
  }

  chars.forEach(function (c) {
    // a single pass over the attributes (avoids the getAttrByName-in-a-loop trap)
    var attrs = findObjs({ _type: 'attribute', _characterid: c.id });
    var byName = {};
    var counts = {};
    var features = [];
    attrs.forEach(function (a) {
      var n = a.get('name');
      byName[n] = a.get('current');
      counts[n] = (counts[n] || 0) + 1;
      var m = n.match(/^repeating_ability_-[\w-]+_(name|class-name)$/);
      if (m && a.get('current')) features.push(clean(a.get('current')));
    });

    var out = [];
    out.push('Personnage : ' + clean(c.get('name')) + ' (id ' + c.id + '), ' + attrs.length + ' attributs');
    ['race', 'level', 'alignment', 'deity', 'age', 'languages'].forEach(function (k) {
      if (byName[k] !== undefined && byName[k] !== '') out.push(k + ' : ' + clean(byName[k]));
    });
    for (var i = 0; i < 6; i++) {
      var cn = byName['class-' + i + '-name'];
      if (cn) out.push('classe ' + i + ' : ' + clean(cn) + ' niv ' + clean(byName['class-' + i + '-level']));
    }
    if (features.length) out.push('capacités (' + features.length + ') : ' + features.slice(0, 40).join(', '));

    var dups = Object.keys(counts).filter(function (n) { return counts[n] > 1; });
    out.push('attributs en double : ' + dups.length + (dups.length ? ' (' + dups.slice(0, 12).map(clean).join(', ') + ')' : ''));
    out.push('handouts du même nom : ' + handouts.length);

    reply(out.join('<br>'));
  });
});
