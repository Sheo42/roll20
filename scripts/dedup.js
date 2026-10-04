// dedup.js - script API Roll20, réservé au MJ. SUPPRIME des attributs en double, avec garde-fous.
//
// Usage dans le chat :
//   !dedup Nom du Personnage                 -> ESSAI À BLANC: ne supprime rien, annonce ce qui serait supprimé
//   !dedup Nom du Personnage confirmer 703   -> supprime, SEULEMENT si le nombre (703) est encore exact
//
// Pour chaque nom d'attribut présent plusieurs fois sur le personnage:
//   - l'exemplaire le plus ANCIEN est toujours conservé (ordre des ids = ordre de création);
//   - il n'est supprimé que les exemplaires récents qui remplissent TOUTES ces conditions:
//       * créés dans la fenêtre WINDOW_FROM -> WINDOW_TO (voir plus bas, heure UTC);
//       * même valeur courante ET même max que l'exemplaire conservé;
//       * l'exemplaire conservé a été créé AVANT la fenêtre;
//       * le nom ne commence pas par "repeating_" (sections répétées jamais touchées).
//   - tout le reste est laissé tel quel et listé comme "ignoré".
// La suppression se fait par lots, avec une pause, pour ne pas déclencher la détection de boucle.
//
// À ADAPTER si besoin: la fenêtre ci-dessous correspond aux copies créées le 2026-10-03
// entre 09:05 et 14:21 UTC (rapport de !dupes), avec une marge.

(function () {
  var WINDOW_FROM = Date.UTC(2026, 9, 3, 9, 0);    // 2026-10-03 09:00 UTC (les mois commencent à 0)
  var WINDOW_TO   = Date.UTC(2026, 9, 3, 14, 30);  // 2026-10-03 14:30 UTC
  var BATCH = 40;      // suppressions par lot
  var PAUSE = 400;     // ms entre deux lots

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

  // calcule le plan de nettoyage d'un personnage, sans rien modifier
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
    var m = args.match(/\s+confirmer\s+(\d+)$/i);
    if (m) { confirmCount = parseInt(m[1], 10); args = args.replace(/\s+confirmer\s+\d+$/i, '').trim(); }
    var name = args.toLowerCase();
    if (!name) { reply('Usage : !dedup nom du personnage [confirmer N]'); return; }

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
      info.push(n ? 'ESSAI À BLANC : rien n\'a été supprimé. Pour supprimer : <b>!dedup ' + clean(c.get('name')) + ' confirmer ' + n + '</b>' : 'Rien à supprimer.');
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
