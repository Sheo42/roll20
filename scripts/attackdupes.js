// attackdupes.js - script API Roll20, LECTURE SEULE, réservé au MJ.
// Usage dans le chat :
//   !attackdupes Nom du Personnage        -> attaques (repeating_weapon) en double, avec date et origine
//   !attackdupes Nom du Personnage all    -> idem + liste de toutes les lignes d'attaque
//   !attackdupes *                        -> résumé : personnages qui ont des attaques en double
//
// Deux lignes d'attaque sont « en double » si elles ont le même nom (casse et espaces ignorés) ET la
// même source : liées au même objet / sort / capacité (source-item, source-spell, source-ability), ou
// toutes deux sans lien. Une attaque renommée liée au même objet est une variante, pas une copie.
// Même définition que attackclean.js.
// Pour chaque ligne : date d'apparition dans le jeu (la plus ancienne des dates encodées
// dans les ids Firebase de ses attributs, heure UTC ; Paris = UTC+2 en octobre), origine
// (objet, sort, capacité, ambidextrie, ou saisie manuelle) et si la source existe encore.
// Ces deux indices disent quel code de la feuille Pathfinder a créé la copie.
// Ne modifie, ne supprime et ne crée aucun objet du jeu.

var AttackDupes = (function () {
  'use strict';
  var PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  var ROW_RE = /^repeating_([^_]+)_(-[^_]+)_(.+)$/;
  var SOURCES = [
    { field: 'source-item', section: 'item', label: 'objet' },
    { field: 'source-spell', section: 'spells', label: 'sort' },
    { field: 'source-ability', section: 'ability', label: 'capacité' }
  ];

  // date de création encodée dans un id Firebase (ms depuis 1970), ou null
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
    if (ms === null || ms === undefined) return '?';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '?';
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }
  // retire ce qui pourrait être interprété comme un jet de dés ou du HTML dans le chat
  function clean(v, max) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[\[\]{}<>@&"]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 40);
  }

  // attrs : [{id, name, current}] -> { weapons: {rowKey: row}, rows: {section: {rowKey: name}} }
  // rowKey = id de ligne en minuscules (Roll20 ne respecte pas toujours la casse des ids de ligne)
  function indexRows(attrs) {
    var weapons = {}, rows = {};
    attrs.forEach(function (a) {
      var m = ROW_RE.exec(a.name || '');
      if (!m) return;
      var section = m[1], key = m[2].toLowerCase(), field = m[3];
      rows[section] = rows[section] || {};
      if (!(key in rows[section])) rows[section][key] = '';
      if (field === 'name') rows[section][key] = a.current;
      if (section !== 'weapon') return;
      var w = weapons[key] = weapons[key] || { key: key, rowId: m[2], fields: {}, count: 0, born: null };
      w.count++;
      w.fields[field] = a.current;
      var t = idTime(a.id);
      if (t !== null && (w.born === null || t < w.born)) w.born = t;
    });
    return { weapons: weapons, rows: rows };
  }

  // origine d'une ligne d'attaque : {label, target, exists}
  function origin(w, rows) {
    for (var i = 0; i < SOURCES.length; i++) {
      var s = SOURCES[i], v = w.fields[s.field];
      if (!v) continue;
      if (v === 'DELETED') return { label: s.label + ' supprimé', target: null, exists: false };
      var k = String(v).toLowerCase(), sec = rows[s.section] || {};
      var exists = k in sec;
      return {
        label: s.label + ' « ' + clean(exists ? sec[k] : (w.fields[s.field + '-name'] || v), 30) + ' »' + (exists ? '' : ' (introuvable)'),
        target: s.section + ':' + k,
        exists: exists
      };
    }
    if (String(w.fields.dualwield) === '1' || w.fields['source-main']) return { label: 'ambidextrie', target: null, exists: true };
    return { label: 'manuelle', target: null, exists: true };
  }

  function byBirth(a, b) {
    var x = a.born === null ? Infinity : a.born, y = b.born === null ? Infinity : b.born;
    return x - y || (a.key < b.key ? -1 : 1);
  }

  // groupes de lignes en double : même nom (casse et espaces ignorés) ET même source.
  // C'est la définition d'une copie qu'utilise aussi attackclean.js : une attaque renommée liée au même
  // objet est une variante faite à la main, pas une copie.
  function findDuplicates(index) {
    var list = Object.keys(index.weapons).map(function (k) {
      var w = index.weapons[k];
      w.name = clean(w.fields.name, 60);
      w.origin = origin(w, index.rows);
      return w;
    });
    var byKey = {};
    list.forEach(function (w) {
      var n = clean(w.fields.name, 200).toLowerCase();
      if (!n) return;
      var k = n + '|' + (w.origin.target || 'sans lien');
      (byKey[k] = byKey[k] || []).push(w);
    });
    var groups = Object.keys(byKey).sort().filter(function (k) { return byKey[k].length > 1; }).map(function (k) {
      var rows = byKey[k].slice().sort(byBirth);
      return { label: rows[0].name, source: rows[0].origin.label, rows: rows };
    });
    return { rows: list.sort(byBirth), groups: groups };
  }

  function rowLine(w, i) {
    return (i === 0 ? 'ANCIEN ' : 'copie ') + fmt(w.born).slice(0, 16) + ', ' + w.count + ' champs';
  }

  // lignes de compte rendu pour un personnage
  function report(charName, attrs, showAll) {
    var d = findDuplicates(indexRows(attrs));
    var out = [], extra = {}, tMin = null, tMax = null;
    d.groups.forEach(function (g) {
      g.rows.slice(1).forEach(function (w) {
        extra[w.key] = true;
        if (w.born !== null) {
          tMin = tMin === null || w.born < tMin ? w.born : tMin;
          tMax = tMax === null || w.born > tMax ? w.born : tMax;
        }
      });
    });
    out.push('<b>' + clean(charName, 50) + '</b> : ' + d.rows.length + ' lignes d\'attaque, ' +
      d.groups.length + ' groupes en double (' + Object.keys(extra).length + ' copies)');
    if (tMin !== null) out.push('copies apparues entre ' + fmt(tMin) + ' et ' + fmt(tMax));
    if (!d.groups.length) out.push('Aucune attaque en double.');
    d.groups.forEach(function (g) {
      out.push('<b>' + clean(g.label, 40) + '</b> (' + g.source + ', ' + g.rows.length + ' lignes)');
      g.rows.forEach(function (w, i) { out.push('· ' + rowLine(w, i)); });
    });
    if (showAll) {
      out.push('<b>Toutes les lignes</b> (par date)');
      d.rows.forEach(function (w) {
        out.push('· ' + (w.name || '(sans nom)') + ' : ' + fmt(w.born).slice(0, 16) + ', ' + w.origin.label);
      });
    }
    return out;
  }

  // résumé sur plusieurs personnages : [{name, attrs}] -> lignes
  function summary(chars) {
    var hits = [];
    chars.forEach(function (c) {
      var d = findDuplicates(indexRows(c.attrs));
      if (!d.groups.length) return;
      var last = null;
      d.groups.forEach(function (g) {
        g.rows.slice(1).forEach(function (w) { if (w.born !== null && (last === null || w.born > last)) last = w.born; });
      });
      hits.push({ name: c.name, n: d.groups.length, last: last });
    });
    if (!hits.length) return ['Aucun personnage n\'a d\'attaque en double (' + chars.length + ' personnages lus).'];
    hits.sort(function (a, b) { return (b.last || 0) - (a.last || 0); });
    return ['<b>Attaques en double</b> (' + hits.length + ' personnages sur ' + chars.length + ', copie la plus récente d\'abord)']
      .concat(hits.map(function (h) { return clean(h.name, 40) + ' : ' + h.n + ' groupes, dernière copie ' + fmt(h.last).slice(0, 16); }));
  }

  function parseArgs(s) {
    var a = String(s || '').trim(), all = false;
    if (/\s+all$/i.test(a)) { all = true; a = a.replace(/\s+all$/i, '').trim(); }
    return { name: a, all: all };
  }

  return { idTime: idTime, fmt: fmt, clean: clean, indexRows: indexRows, findDuplicates: findDuplicates,
    report: report, summary: summary, parseArgs: parseArgs };
})();

if (typeof module !== 'undefined') module.exports = AttackDupes;

(function () {
  'use strict';
  if (typeof on !== 'function') return;

  function attrsOf(c) {
    return findObjs({ _type: 'attribute', _characterid: c.id }).map(function (a) {
      return { id: a.id, name: a.get('name'), current: a.get('current') };
    });
  }

  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!attackdupes(\s|$)/.test(msg.content)) return;
    if (!playerIsGM(msg.playerid)) return;
    var who = msg.who.replace(/ \(GM\)$/, '');
    var reply = function (t) { sendChat('attackdupes', '/w "' + who + '" ' + t); };
    var replyLines = function (lines, perMsg) {
      for (var i = 0, n = 0; i < lines.length; i += perMsg, n++) {
        (function (chunk, delay) { setTimeout(function () { reply(chunk); }, delay); })(lines.slice(i, i + perMsg).join('<br>'), n * 400);
      }
    };

    var args = AttackDupes.parseArgs(msg.content.replace(/^!attackdupes\s*/, ''));
    if (!args.name) { reply('Usage : !attackdupes nom du personnage [all], ou !attackdupes *'); return; }

    var all = findObjs({ _type: 'character' });
    if (args.name === '*') {
      replyLines(AttackDupes.summary(all.map(function (c) { return { name: c.get('name'), attrs: attrsOf(c) }; })), 15);
      return;
    }
    var wanted = args.name.toLowerCase();
    var chars = all.filter(function (c) { return (c.get('name') || '').toLowerCase() === wanted; });
    if (!chars.length) { reply('Aucun personnage nommé ' + AttackDupes.clean(args.name) + '.'); return; }
    chars.forEach(function (c) { replyLines(AttackDupes.report(c.get('name'), attrsOf(c), args.all), 12); });
  });
})();
