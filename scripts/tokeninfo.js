// tokeninfo.js - diagnostic Roll20, LECTURE SEULE, réservé au MJ.
//
//   !tokeninfo <personnage>   Nom stocké dans le token par défaut du personnage, présence éventuelle
//                             du marqueur %%NUMBERED%% (TokenNameNumber), et tokens déjà posés qui
//                             le représentent (nom, page).
//   !tokenwatch on | off      Chuchote au MJ chaque création de token lié à un personnage et chaque
//                             changement de nom (nom avant / après). S'arrête seul après 15 minutes.
//
// But: savoir si le nom "Personnage 1" est déjà dans le token par défaut, ou s'il est ajouté
// APRÈS la création par un script (et à quel moment). Ne modifie aucun objet du jeu.

(function () {
  var WATCH_MAX_MS = 15 * 60 * 1000;
  var watchWho = null;
  var watchTimer = null;

  var clean = function (v, max) {
    return String(v === undefined || v === null ? '' : v).replace(/[\[\]{}<>@&"]/g, '').replace(/\s+/g, ' ').slice(0, max || 60);
  };
  var whisper = function (who, text) { sendChat('tokeninfo', '/w "' + who + '" ' + text); };
  var stamp = function () { return new Date().toISOString().slice(11, 19) + ' UTC'; };

  var stopWatch = function (why) {
    if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
    if (watchWho) { whisper(watchWho, 'Surveillance des tokens arrêtée' + (why ? ' (' + why + ')' : '') + '.'); }
    watchWho = null;
  };

  // --- surveillance ---
  on('add:graphic', function (t) {
    if (!watchWho || t.get('_subtype') !== 'token' || !t.get('represents')) return;
    var id = t.id;
    var first = t.get('name');
    var c = getObj('character', t.get('represents'));
    whisper(watchWho, stamp() + ' CRÉÉ : nom=' + clean(first) + ' | personnage=' + clean(c ? c.get('name') : '?') + ' | id=' + id);
    // instantané 1,5 s plus tard: un script qui renomme "plus tard" apparaît ici
    setTimeout(function () {
      var again = getObj('graphic', id);
      if (watchWho && again && again.get('name') !== first) {
        whisper(watchWho, stamp() + ' 1,5 s après : nom=' + clean(again.get('name')) + ' (était ' + clean(first) + ') | id=' + id);
      }
    }, 1500);
  });

  on('change:graphic:name', function (t, prev) {
    if (!watchWho || t.get('_subtype') !== 'token' || !t.get('represents')) return;
    whisper(watchWho, stamp() + ' RENOMMÉ : ' + clean(prev.name) + ' -> ' + clean(t.get('name')) + ' | id=' + t.id);
  });

  // --- commandes ---
  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !playerIsGM(msg.playerid)) return;
    var who = msg.who.replace(/ \(GM\)$/, '');

    if (/^!tokenwatch(\s|$)/.test(msg.content)) {
      var arg = msg.content.replace(/^!tokenwatch\s*/, '').trim().toLowerCase();
      if (arg === 'on') {
        stopWatch();
        watchWho = who;
        watchTimer = setTimeout(function () { stopWatch('15 minutes écoulées'); }, WATCH_MAX_MS);
        whisper(who, 'Surveillance des tokens activée pour 15 minutes. Pose un token du PJ depuis le journal.');
      } else if (arg === 'off') {
        if (watchWho) stopWatch('demandé'); else whisper(who, 'La surveillance n\'était pas active.');
      } else {
        whisper(who, 'Usage : !tokenwatch on | off');
      }
      return;
    }

    if (/^!tokeninfo(\s|$)/.test(msg.content)) {
      var name = msg.content.replace(/^!tokeninfo\s*/, '').trim().toLowerCase();
      if (!name) { whisper(who, 'Usage : !tokeninfo nom du personnage'); return; }
      var chars = findObjs({ _type: 'character' }).filter(function (c) { return (c.get('name') || '').toLowerCase() === name; });
      if (chars.length !== 1) { whisper(who, chars.length ? 'Plusieurs personnages portent ce nom.' : 'Aucun personnage nommé ' + clean(name) + '.'); return; }
      var ch = chars[0];

      var placed = findObjs({ _type: 'graphic', _subtype: 'token', represents: ch.id });
      var lines = [];
      lines.push('<b>' + clean(ch.get('name')) + '</b> : ' + placed.length + ' token(s) posé(s) qui le représentent');
      placed.slice(0, 12).forEach(function (t) {
        var p = getObj('page', t.get('_pageid'));
        lines.push('- ' + clean(t.get('name')) + ' (page ' + clean(p ? p.get('name') : '?') + ', liens barres : ' + [1, 2, 3].map(function (n) { return t.get('bar' + n + '_link') ? 'oui' : 'non'; }).join('/') + ')');
      });

      // le token par défaut est lu en différé (valeur asynchrone dans l'API)
      ch.get('defaulttoken', function (raw) {
        var dt = '(aucun token par défaut enregistré)';
        var marker = false;
        try {
          if (raw) {
            var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
            dt = clean(o.name);
            marker = /%%NUMBERED%%/.test(o.name || '');
            lines.push('nom du token par défaut : ' + dt + (marker ? ' <b>(contient %%NUMBERED%%)</b>' : ''));
            lines.push('le token par défaut représente le personnage : ' + (o.represents === ch.id ? 'oui' : 'non / vide'));
            // liens de barres du token par défaut (ce que PFCompanion teste pour décider si c'est un "mook")
            var bars = [1, 2, 3].map(function (n) { return 'barre' + n + ' = ' + (o['bar' + n + '_link'] ? clean(o['bar' + n + '_link']) : '(aucun lien)'); });
            var noLink = [1, 2, 3].every(function (n) { return !o['bar' + n + '_link']; });
            lines.push('liens de barres du token par défaut : ' + bars.join(', '));
            lines.push(noLink ? '<b>aucune barre liée : PFCompanion le traiterait comme un mook</b>' : 'au moins une barre liée : pas un mook pour PFCompanion');
          } else {
            lines.push('nom du token par défaut : ' + dt);
          }
        } catch (e) {
          lines.push('token par défaut illisible : ' + clean(e.message));
        }
        whisper(who, lines.join('<br>'));
      });
    }
  });
})();
