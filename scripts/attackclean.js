// attackclean.js - script API Roll20, réservé au MJ. SUPPRIME des lignes d'attaque en double, avec garde-fous.
//
// Usage dans le chat :
//   !attackclean Nom du Personnage             -> ESSAI À BLANC : ne supprime rien, liste ce qui serait supprimé
//   !attackclean Nom du Personnage confirm 3   -> supprime, SEULEMENT si le nombre (3) est encore exact
//   !attackclean all                           -> ESSAI À BLANC sur TOUS les personnages (résumé par personnage)
//   !attackclean all confirm 12                -> supprime les copies identiques de tous les personnages,
//                                                 SEULEMENT si le total (12) est encore exact
//   !attackclean Nom du Personnage delete <id>          -> montre UNE copie « à vérifier » et ses différences
//   !attackclean Nom du Personnage delete <id> confirm  -> supprime cette copie (après vérification par le MJ)
//
// Une ligne d'attaque n'est supprimée que si TOUT ceci est vrai :
//   - elle est liée à un objet, un sort ou une capacité (source-item / source-spell / source-ability) ;
//   - une ligne PLUS ANCIENNE porte le même nom (casse et espaces ignorés) et est liée à la même source :
//     la plus ancienne est toujours gardée ;
//   - ses réglages modifiables à la main (bonus, dégâts, critique, notes, type d'attaque...) sont identiques
//     à ceux de la ligne gardée, et elle n'a pas plus de champs qu'elle.
// Sinon la ligne est listée « à vérifier », avec les valeurs qui diffèrent et un bouton pour la supprimer
// à la main (delete). Seule une copie (même nom, même source, plus récente) peut être supprimée ainsi :
// jamais la ligne gardée ni une variante. Les attaques renommées (variantes
// faites à la main) et les attaques sans lien ne sont jamais touchées.
// La suppression retire tous les attributs de la ligne, par lots, avec une pause.
// Conseil : dupliquer le personnage avant (la duplication ne crée pas de copie d'attaque, testé).

var AttackClean = (function () {
  'use strict';
  var PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  var ROW_RE = /^repeating_([^_]+)_(-[^_]+)_(.+)$/;
  var SOURCES = [['source-item', 'item', 'objet'], ['source-spell', 'spells', 'sort'], ['source-ability', 'ability', 'capacité']];
  // réglages qu'un joueur modifie à la main sur une ligne d'attaque
  var EDITABLE = ['attack-mod', 'damage-mod', 'attack-type', 'damage-ability', 'crit-target', 'crit-multiplier',
    'crit_conf_mod', 'enhance', 'masterwork', 'proficiency', 'damage-dice-num', 'damage-die', 'type', 'notes',
    'group', 'range', 'isranged', 'vs', 'precision_dmg_macro', 'critical_dmg_macro'];

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
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }
  function clean(v, max) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[\[\]{}<>@&"]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 40);
  }
  // valeur comparable : absent, vide et 0 se valent (la feuille ne crée pas toujours les champs à 0)
  function norm(v) {
    var s = String(v === undefined || v === null ? '' : v).trim();
    return s === '0' ? '' : s;
  }

  // attrs : [{id, name, current}] -> lignes d'attaque {key, fields, ids, born} et noms des sources
  function indexRows(attrs) {
    var rows = {}, names = { item: {}, spells: {}, ability: {} };
    attrs.forEach(function (a) {
      var m = ROW_RE.exec(a.name || '');
      if (!m) return;
      var sec = m[1], key = m[2].toLowerCase(), field = m[3];
      if (field === 'name' && names[sec]) names[sec][key] = a.current;
      if (sec !== 'weapon') return;
      var r = rows[key] = rows[key] || { key: key, fields: {}, ids: [], born: null };
      r.fields[field] = a.current;
      r.ids.push(a.id);
      var t = idTime(a.id);
      if (t !== null && (r.born === null || t < r.born)) r.born = t;
    });
    return { rows: rows, names: names };
  }
  function sourceOf(fields) {
    for (var i = 0; i < SOURCES.length; i++) {
      var v = fields[SOURCES[i][0]];
      if (v && v !== 'DELETED') return { key: SOURCES[i][1] + ':' + String(v).toLowerCase(), section: SOURCES[i][1], id: String(v).toLowerCase(), label: SOURCES[i][2] };
    }
    return null;
  }
  // différences de réglages entre la copie et la ligne gardée (liste de noms de champs)
  function diffs(copy, keep) {
    return EDITABLE.filter(function (f) { return norm(copy.fields[f]) !== norm(keep.fields[f]); });
  }
  function shown(v) { var n = norm(v); return n === '' ? '0' : clean(n, 20); }
  function byBirth(a, b) {
    var x = a.born === null ? Infinity : a.born, y = b.born === null ? Infinity : b.born;
    return x - y || (a.key < b.key ? -1 : 1);
  }

  // plan de nettoyage : {groups: [{label, keep, remove: [], check: [{row, why}]}], remove: [rows]}
  function buildPlan(attrs) {
    var idx = indexRows(attrs), groups = {};
    Object.keys(idx.rows).forEach(function (k) {
      var r = idx.rows[k], src = sourceOf(r.fields), name = clean(r.fields.name, 200).toLowerCase();
      if (!src || !name) return;
      var g = src.key + '|' + name;
      (groups[g] = groups[g] || { src: src, name: clean(r.fields.name, 40), rows: [] }).rows.push(r);
    });
    var plan = { groups: [], remove: [] };
    Object.keys(groups).sort().forEach(function (g) {
      var G = groups[g];
      if (G.rows.length < 2) return;
      var rows = G.rows.sort(byBirth), keep = rows[0];
      var srcName = idx.names[G.src.section][G.src.id];
      var out = { label: G.name, source: G.src.label + ' « ' + clean(srcName !== undefined ? srcName : G.src.id, 30) + ' »' +
        (srcName === undefined ? ' (introuvable)' : ''), keep: keep, remove: [], check: [] };
      rows.slice(1).forEach(function (r) {
        var d = diffs(r, keep), more = r.ids.length > keep.ids.length;
        if (!d.length && !more) { out.remove.push(r); plan.remove.push(r); }
        else out.check.push({ row: r, why: more ? r.ids.length + ' champs contre ' + keep.ids.length : 'réglages différents : ' +
          d.slice(0, 4).map(function (f) { return f + ' ' + shown(keep.fields[f]) + ' (gardée) / ' + shown(r.fields[f]) + ' (copie)'; }).join(', ') });
      });
      plan.groups.push(out);
    });
    return plan;
  }

  function rowText(r) {
    return fmt(r.born).slice(0, 16) + ', ' + r.ids.length + ' champs';
  }
  function report(charName, plan) {
    var out = ['<b>' + clean(charName, 50) + '</b> : ' + plan.groups.length + ' groupes d\'attaques identiques liées à la même source, <b>' +
      plan.remove.length + '</b> copies à supprimer'];
    plan.groups.forEach(function (g) {
      out.push('<b>' + clean(g.label, 40) + '</b> (' + g.source + ') : gardée ' + rowText(g.keep));
      g.remove.forEach(function (r) { out.push('· à supprimer : ' + rowText(r)); });
      g.check.forEach(function (c) {
        out.push('· à vérifier, gardée : ' + rowText(c.row) + ' (' + c.why + ') [Supprimer cette copie](!attackclean ' +
          clean(charName, 50) + ' delete ' + c.row.key + ')');
      });
    });
    return out;
  }
  // résumé sur plusieurs personnages : chars = [{name, plan}] -> lignes, avec le total à confirmer
  function summaryAll(chars) {
    var hit = chars.filter(function (c) { return c.plan.groups.length; });
    var total = 0, check = 0;
    hit.forEach(function (c) {
      total += c.plan.remove.length;
      c.plan.groups.forEach(function (g) { check += g.check.length; });
    });
    var out = ['<b>Tous les personnages</b> : ' + hit.length + ' sur ' + chars.length + ' ont des attaques en double, <b>' +
      total + '</b> copies identiques à supprimer, ' + check + ' à vérifier (jamais supprimées par all)'];
    hit.forEach(function (c) {
      var k = 0;
      c.plan.groups.forEach(function (g) { k += g.check.length; });
      out.push(clean(c.name, 40) + ' : ' + c.plan.remove.length + ' à supprimer' + (k ? ', ' + k + ' à vérifier' : ''));
    });
    return { lines: out, total: total };
  }
  // copie supprimable à la main : ligne plus récente d'un groupe (supprimable ou à vérifier), ou null
  function findCopy(plan, key) {
    key = String(key || '').toLowerCase();
    for (var i = 0; i < plan.groups.length; i++) {
      var g = plan.groups[i];
      var rows = g.remove.concat(g.check.map(function (c) { return c.row; }));
      for (var j = 0; j < rows.length; j++) if (rows[j].key === key) return { group: g, row: rows[j] };
    }
    return null;
  }
  function parseArgs(s) {
    var a = String(s || '').trim(), n = null, del = null, sure = false, m;
    if ((m = /\s+delete\s+(-\S+)(\s+confirm)?$/i.exec(a))) { del = m[1]; sure = !!m[2]; a = a.slice(0, m.index).trim(); }
    else if ((m = /\s+confirm\s+(\d+)$/i.exec(a))) { n = parseInt(m[1], 10); a = a.slice(0, m.index).trim(); }
    return { name: a, confirm: n, del: del, sure: sure };
  }

  return { idTime: idTime, fmt: fmt, clean: clean, norm: norm, indexRows: indexRows, buildPlan: buildPlan,
    report: report, summaryAll: summaryAll, parseArgs: parseArgs, findCopy: findCopy, EDITABLE: EDITABLE };
})();

if (typeof module !== 'undefined') module.exports = AttackClean;

(function () {
  'use strict';
  if (typeof on !== 'function') return;
  var C = AttackClean;
  var BATCH = 40;   // attributs supprimés par lot
  var PAUSE = 400;  // ms entre deux lots

  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!attackclean(\s|$)/.test(msg.content)) return;
    if (!playerIsGM(msg.playerid)) return;
    var who = msg.who.replace(/ \(GM\)$/, '');
    var reply = function (t) { sendChat('attackclean', '/w "' + who + '" ' + t); };

    var args = C.parseArgs(msg.content.replace(/^!attackclean\s*/, ''));
    if (!args.name) { reply('Usage : !attackclean nom du personnage [confirm N | delete id [confirm]], ou !attackclean all [confirm N]'); return; }
    var sendLines = function (lines) {
      for (var i = 0, k = 0; i < lines.length; i += 12, k++) {
        (function (chunk, delay) { setTimeout(function () { reply(chunk); }, delay); })(lines.slice(i, i + 12).join('<br>'), k * 400);
      }
    };
    var planFor = function (ch) {
      var list = findObjs({ _type: 'attribute', _characterid: ch.id });
      return { name: ch.get('name'), objs: list, plan: C.buildPlan(list.map(function (a) { return { id: a.id, name: a.get('name'), current: a.get('current') }; })) };
    };
    if (args.name.toLowerCase() === 'all' && !args.del) {
      var every = findObjs({ _type: 'character' }).map(planFor);
      var sum = C.summaryAll(every);
      if (args.confirm === null) {
        sum.lines.push(sum.total ? 'ESSAI À BLANC : rien n\'a été supprimé. Détail d\'un personnage : !attackclean nom. Pour tout supprimer : <b>!attackclean all confirm ' + sum.total + '</b>' : 'Rien à supprimer.');
        sendLines(sum.lines);
        return;
      }
      if (args.confirm !== sum.total) { reply('ABANDON : tu as confirmé ' + args.confirm + ' mais il y a ' + sum.total + ' copies maintenant. Relance l\'essai à blanc.'); return; }
      if (!sum.total) { reply('Rien à supprimer.'); return; }
      var doomedAll = {};
      every.forEach(function (e) { e.plan.remove.forEach(function (r) { r.ids.forEach(function (id) { doomedAll[id] = true; }); }); });
      var queueAll = [];
      every.forEach(function (e) { e.objs.forEach(function (a) { if (doomedAll[a.id]) queueAll.push(a); }); });
      reply('Suppression de ' + sum.total + ' lignes d\'attaque sur ' + every.filter(function (e) { return e.plan.remove.length; }).length + ' personnages en cours...');
      var countAll = 0;
      var stepAll = function () {
        queueAll.splice(0, BATCH).forEach(function (a) { a.remove(); countAll++; });
        if (queueAll.length) setTimeout(stepAll, PAUSE);
        else reply('Terminé : ' + sum.total + ' lignes supprimées (' + countAll + ' attributs). Vérifie avec !attackdupes *.');
      };
      stepAll();
      return;
    }
    var wanted = args.name.toLowerCase();
    var chars = findObjs({ _type: 'character' }).filter(function (c) { return (c.get('name') || '').toLowerCase() === wanted; });
    if (chars.length !== 1) { reply(chars.length ? 'Plusieurs personnages portent ce nom, abandon.' : 'Aucun personnage nommé ' + C.clean(args.name) + '.'); return; }
    var c = chars[0];

    var objs = findObjs({ _type: 'attribute', _characterid: c.id });
    var plan = C.buildPlan(objs.map(function (a) { return { id: a.id, name: a.get('name'), current: a.get('current') }; }));
    var n = plan.remove.length;
    var lines = C.report(c.get('name'), plan);
    var removeRows = function (rows, done) {
      var doomed = {};
      rows.forEach(function (r) { r.ids.forEach(function (id) { doomed[id] = true; }); });
      var queue = objs.filter(function (a) { return doomed[a.id]; }), count = 0;
      var step = function () {
        queue.splice(0, BATCH).forEach(function (a) { a.remove(); count++; });
        if (queue.length) setTimeout(step, PAUSE); else done(count);
      };
      step();
    };

    if (args.del) {
      var found = C.findCopy(plan, args.del);
      if (!found) { reply('Ligne ' + C.clean(args.del, 25) + ' introuvable parmi les copies. Relance !attackclean ' + C.clean(c.get('name')) + '.'); return; }
      var what = C.clean(found.group.label, 40) + ' (' + found.group.source + '), copie du ' + C.fmt(found.row.born).slice(0, 16) + ', ' + found.row.ids.length + ' champs';
      if (!args.sure) {
        reply('À supprimer : ' + what + '. La ligne gardée du ' + C.fmt(found.group.keep.born).slice(0, 16) + ' n\'est pas touchée. ' +
          '[Confirmer la suppression](!attackclean ' + C.clean(c.get('name')) + ' delete ' + found.row.key + ' confirm)');
        return;
      }
      removeRows([found.row], function (count) { reply('Supprimée : ' + what + ' (' + count + ' attributs).'); });
      return;
    }

    if (args.confirm === null) {
      lines.push(n ? 'ESSAI À BLANC : rien n\'a été supprimé. Pour supprimer : <b>!attackclean ' + C.clean(c.get('name')) + ' confirm ' + n + '</b>' : 'Rien à supprimer.');
      for (var i = 0, k = 0; i < lines.length; i += 12, k++) {
        (function (chunk, delay) { setTimeout(function () { reply(chunk); }, delay); })(lines.slice(i, i + 12).join('<br>'), k * 400);
      }
      return;
    }
    if (args.confirm !== n) { reply('ABANDON : tu as confirmé ' + args.confirm + ' mais il y a ' + n + ' copies maintenant. Relance l\'essai à blanc.'); return; }
    if (!n) { reply('Rien à supprimer.'); return; }

    reply('Suppression de ' + n + ' lignes d\'attaque en cours...');
    removeRows(plan.remove, function (count) {
      reply('Terminé : ' + n + ' lignes supprimées (' + count + ' attributs). Vérifie avec !attackdupes ' + C.clean(c.get('name')) + '.');
    });
  });
})();
