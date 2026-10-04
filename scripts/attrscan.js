// attrscan.js - diagnostic Roll20, LECTURE SEULE, réservé au MJ.
//
//   !attrscan <personnage>             vue d'ensemble
//   !attrscan <personnage> <section>   détail d'une section répétable (ex: ability): champs et valeurs courtes
//   !abilitycheck <personnage>         applique la condition exacte de la feuille (showinmenu vrai + ability_type) et liste les lignes suspectes
//
// Cherche ce qui peut alourdir une fiche (et donc la page à l'ouverture / à l'instanciation):
//   - nombre total d'attributs
//   - sections répétables (repeating_*): nombre de lignes par section, et lignes entièrement vides
//   - attributs dont le nom contient "macro" (liste, avec la longueur de leur valeur)
//   - les valeurs les plus longues (en caractères)
//   - les préfixes de noms les plus fréquents
// Un seul passage sur les attributs (pas de getAttrByName). Ne modifie aucun objet du jeu.

(function () {
  var clean = function (v, max) {
    return String(v === undefined || v === null ? '' : v).replace(/[\[\]{}<>@&"]/g, '').replace(/\s+/g, ' ').slice(0, max || 40);
  };
  var ROW = /^repeating_(.+?)_(-[\w-]{19})_(.+)$/;

  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!attrscan(\s|$)/.test(msg.content)) return;
    if (!playerIsGM(msg.playerid)) return;

    var who = msg.who.replace(/ \(GM\)$/, '');
    var reply = function (t) { sendChat('attrscan', '/w "' + who + '" ' + t); };
    var args = msg.content.replace(/^!attrscan\s*/, '').trim().toLowerCase();
    var section = null;
    var sm = args.match(/\s+(ability|item|weapon|buff2|buff|spell\w*|[a-z0-9]+)$/);
    // le dernier mot est une section seulement si un personnage porte le nom sans ce mot
    var name = args;
    if (sm && !findObjs({ _type: 'character' }).some(function (c) { return (c.get('name') || '').toLowerCase() === args; })) {
      section = sm[1];
      name = args.slice(0, args.length - sm[0].length).trim();
    }
    if (!name) { reply('Usage : !attrscan nom du personnage'); return; }

    var chars = findObjs({ _type: 'character' }).filter(function (c) { return (c.get('name') || '').toLowerCase() === name; });
    if (chars.length !== 1) { reply(chars.length ? 'Plusieurs personnages portent ce nom.' : 'Aucun personnage nommé ' + clean(name) + '.'); return; }
    var c = chars[0];

    var attrs = findObjs({ _type: 'attribute', _characterid: c.id });

    if (section) {
      // détail d'une section: pour chaque champ, répartition des valeurs courtes (<= 15 caractères)
      var fields = {}, rows = {};
      attrs.forEach(function (a) {
        var m = (a.get('name') || '').match(ROW);
        if (!m || m[1] !== section) return;
        rows[m[2]] = true;
        var f = fields[m[3]] = fields[m[3]] || { n: 0, vals: {}, long: 0 };
        f.n++;
        var v = String(a.get('current') === undefined || a.get('current') === null ? '' : a.get('current'));
        if (v.length > 15) f.long++; else f.vals[v] = (f.vals[v] || 0) + 1;
      });
      var o = ['<b>' + clean(c.get('name')) + '</b> : section ' + clean(section) + ', ' + Object.keys(rows).length + ' lignes'];
      Object.keys(fields).sort().forEach(function (k) {
        var f = fields[k];
        var vs = Object.keys(f.vals).sort(function (x, y) { return f.vals[y] - f.vals[x]; }).slice(0, 6)
          .map(function (v) { return '"' + clean(v, 15) + '"x' + f.vals[v]; }).join(' ');
        o.push(clean(k, 40) + ' (' + f.n + ') : ' + (vs || '-') + (f.long ? ' + ' + f.long + ' longues' : ''));
      });
      var chunks = [];
      for (var i = 0; i < o.length; i += 14) chunks.push(o.slice(i, i + 14).join('<br>'));
      chunks.forEach(function (t, n) { setTimeout(function () { reply(t); }, n * 400); });
      return;
    }

    var sections = {};   // section -> { rows: {id: {n, filled}} }
    var macros = [];
    var lengths = [];
    var prefixes = {};

    attrs.forEach(function (a) {
      var n = a.get('name') || '';
      var cur = a.get('current');
      var len = String(cur === undefined || cur === null ? '' : cur).length;
      var m = n.match(ROW);
      if (m) {
        var s = sections[m[1]] = sections[m[1]] || { rows: {} };
        var r = s.rows[m[2]] = s.rows[m[2]] || { n: 0, filled: 0 };
        r.n++;
        if (len > 0 && String(cur) !== '0') r.filled++;
      } else {
        var p = n.split(/[-_]/)[0];
        prefixes[p] = (prefixes[p] || 0) + 1;
      }
      if (/macro/i.test(n)) macros.push({ n: n, len: len });
      lengths.push({ n: n, len: len });
    });

    var out = [];
    out.push('<b>' + clean(c.get('name')) + '</b> : ' + attrs.length + ' attributs');

    var secs = Object.keys(sections).map(function (k) {
      var rows = Object.keys(sections[k].rows);
      var empty = rows.filter(function (id) { return sections[k].rows[id].filled === 0; }).length;
      return { k: k, rows: rows.length, empty: empty };
    }).sort(function (a, b) { return b.rows - a.rows; });
    out.push('<b>Sections répétables</b> (lignes / dont vides) : ' +
      (secs.length ? secs.slice(0, 15).map(function (s) { return clean(s.k, 30) + ' ' + s.rows + '/' + s.empty; }).join(', ') : 'aucune'));

    macros.sort(function (a, b) { return b.len - a.len; });
    out.push('<b>Attributs "macro"</b> : ' + macros.length +
      (macros.length ? ' (plus longs : ' + macros.slice(0, 10).map(function (x) { return clean(x.n, 40) + ' ' + x.len + ' car.'; }).join(', ') + ')' : ''));

    lengths.sort(function (a, b) { return b.len - a.len; });
    out.push('<b>Valeurs les plus longues</b> : ' + lengths.slice(0, 8).map(function (x) { return clean(x.n, 40) + ' ' + x.len; }).join(', '));

    var pf = Object.keys(prefixes).map(function (k) { return { k: k, n: prefixes[k] }; }).sort(function (a, b) { return b.n - a.n; });
    out.push('<b>Préfixes les plus fréquents</b> (hors sections) : ' + pf.slice(0, 10).map(function (x) { return clean(x.k, 20) + ' ' + x.n; }).join(', '));

    reply(out.join('<br>'));
  });

  // --- !abilitycheck: capacités dont le type n'est pas un type valide (candidates au message "could not find top macro for 0")
  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!abilitycheck(\s|$)/.test(msg.content)) return;
    if (!playerIsGM(msg.playerid)) return;
    var who = msg.who.replace(/ \(GM\)$/, '');
    var reply = function (t) { sendChat('abilitycheck', '/w "' + who + '" ' + t); };
    var name = msg.content.replace(/^!abilitycheck\s*/, '').trim().toLowerCase();
    if (!name) { reply('Usage : !abilitycheck nom du personnage'); return; }
    var chars = findObjs({ _type: 'character' }).filter(function (c) { return (c.get('name') || '').toLowerCase() === name; });
    if (chars.length !== 1) { reply(chars.length ? 'Plusieurs personnages portent ce nom.' : 'Aucun personnage nommé ' + clean(name) + '.'); return; }
    var c = chars[0];
    var rows = {};
    findObjs({ _type: 'attribute', _characterid: c.id }).forEach(function (a) {
      var m = (a.get('name') || '').match(ROW);
      if (!m || m[1] !== 'ability') return;
      var r = rows[m[2]] = rows[m[2]] || {};
      r[m[3]] = String(a.get('current') === undefined || a.get('current') === null ? '' : a.get('current'));
    });
    // Condition exacte de la feuille (PFAbility.getTopOfMenu / getAbilityTypes):
    // seules les lignes dont showinmenu est vrai comptent; leur ability_type (en minuscules) donne les "types".
    // Un type non vide autre que ex/sp/su provoque "could not find top macro for <type>".
    var ids = Object.keys(rows);
    var menu = ids.filter(function (id) { return (parseInt(rows[id].showinmenu, 10) || 0) !== 0; });
    var suspects = menu.filter(function (id) {
      var t = rows[id].ability_type;
      if (t === undefined) return true;                    // attribut absent
      t = String(t).toLowerCase();
      return t !== '' && t !== 'ex' && t !== 'sp' && t !== 'su';
    });
    var out = ['<b>' + clean(c.get('name')) + '</b> : ' + ids.length + ' capacités, ' + menu.length + ' avec showinmenu vrai, ' + suspects.length + ' suspectes (type absent ou différent de Ex/Sp/Su)'];
    var perType = {};
    menu.forEach(function (id) { var t = rows[id].ability_type === undefined ? '(absent)' : '"' + clean(rows[id].ability_type, 12) + '"'; perType[t] = (perType[t] || 0) + 1; });
    out.push('types des lignes showinmenu : ' + Object.keys(perType).map(function (k) { return k + ' x' + perType[k]; }).join(', '));
    suspects.forEach(function (id) {
      var r = rows[id];
      out.push(clean(r.name, 40) + ' | showinmenu=' + clean(r.showinmenu, 5) + ' | ability_type=' + (r.ability_type === undefined ? '(absent)' : '"' + clean(r.ability_type, 12) + '"') + ' | id ' + id.slice(0, 9));
    });
    var chunks = [];
    for (var i = 0; i < out.length; i += 12) chunks.push(out.slice(i, i + 12).join('<br>'));
    chunks.forEach(function (t, n) { setTimeout(function () { reply(t); }, n * 400); });
  });
})();
