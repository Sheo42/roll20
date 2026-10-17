// attackwatch.js - script API Roll20, LECTURE SEULE, réservé au MJ.
// Surveille en permanence (même quand le MJ n'est pas là) ce qui crée des lignes d'attaque :
//   - chaque modification du champ « create attack » (create-attack-entry) d'un objet, sort ou capacité,
//     avec l'ancienne et la nouvelle valeur ;
//   - chaque nouvelle ligne d'attaque (repeating_weapon), avec ce à quoi elle est liée ;
//   - chaque redémarrage du sandbox API ;
//   - pour chaque évènement : l'heure (UTC) et les joueurs connectés à ce moment.
// Le journal est gardé dans state (les 60 derniers évènements) et chaque évènement est chuchoté au MJ.
//
// Usage dans le chat :
//   !attackwatch          -> état (actif ou non) et nombre d'évènements enregistrés
//   !attackwatch log      -> affiche le journal
//   !attackwatch on|off   -> active ou coupe la surveillance (active par défaut)
//   !attackwatch clear    -> vide le journal
//
// Pourquoi : la feuille Pathfinder Community crée une nouvelle attaque liée à un objet à CHAQUE
// modification de son champ create-attack-entry, sans regarder la valeur. Ce script dit quand ce
// champ change, sur quel personnage, et qui était connecté.
// Ne modifie, ne supprime et ne crée aucun objet du jeu (seul son propre state est écrit).

var AttackWatch = (function () {
  'use strict';
  var MAX_LOG = 60;
  var BUTTON_RE = /^repeating_(item|spells|ability)_(-[^_]+)_create-attack-entry$/;
  var WEAPON_RE = /^repeating_weapon_(-[^_]+)_(.+)$/;
  var PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  var SECTION_LABEL = { item: 'objet', spells: 'sort', ability: 'capacité' };
  var SOURCE_FIELDS = [['source-item', 'item'], ['source-spell', 'spells'], ['source-ability', 'ability']];

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
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }
  function clean(v, max) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/[\[\]{}<>@&"]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 40);
  }
  // champ « create attack » : {section, rowId} ou null
  function parseButton(name) {
    var m = BUTTON_RE.exec(name || '');
    return m ? { section: m[1], rowId: m[2] } : null;
  }
  // attribut d'une ligne d'attaque : {rowId, field} ou null
  function parseWeapon(name) {
    var m = WEAPON_RE.exec(name || '');
    return m ? { rowId: m[1], field: m[2] } : null;
  }
  // une ligne est neuve si aucun de ses attributs n'a été créé plus de `age` ms avant `ref`
  function isNewRow(attrIds, ref, age) {
    if (!attrIds.length) return false;
    return attrIds.every(function (id) {
      var t = idTime(id);
      return t !== null && t >= ref - age;
    });
  }
  // origine d'une ligne d'attaque à partir de ses champs et des noms des lignes sources
  function linkOf(fields, sourceNames) {
    for (var i = 0; i < SOURCE_FIELDS.length; i++) {
      var v = fields[SOURCE_FIELDS[i][0]];
      if (!v) continue;
      var sec = SOURCE_FIELDS[i][1];
      var n = (sourceNames[sec] || {})[String(v).toLowerCase()];
      return SECTION_LABEL[sec] + ' « ' + clean(n !== undefined ? n : v, 30) + ' »';
    }
    return 'sans lien';
  }
  function line(e) {
    var who = e.online && e.online.length ? ' · connectés : ' + e.online.join(', ') : ' · personne de connecté';
    if (e.kind === 'restart') return fmt(e.t) + ' · redémarrage du sandbox API' + who;
    if (e.kind === 'button') {
      return fmt(e.t) + ' · <b>' + clean(e.char, 30) + '</b> : bouton « create attack » de ' + SECTION_LABEL[e.section] +
        ' « ' + clean(e.source, 30) + ' » ' + (e.prev === null ? '(nouveau champ)' : clean(e.prev, 5) + ' -> ' + clean(e.value, 5)) + who;
    }
    if (e.kind === 'row') return fmt(e.t) + ' · <b>' + clean(e.char, 30) + '</b> : nouvelle attaque « ' + clean(e.name, 30) + ' », ' + e.link + who;
    return fmt(e.t) + ' · ?';
  }
  function push(log, e) {
    log.push(e);
    while (log.length > MAX_LOG) log.shift();
    return log;
  }

  return { idTime: idTime, fmt: fmt, clean: clean, parseButton: parseButton, parseWeapon: parseWeapon,
    isNewRow: isNewRow, linkOf: linkOf, line: line, push: push, MAX_LOG: MAX_LOG };
})();

if (typeof module !== 'undefined') module.exports = AttackWatch;

(function () {
  'use strict';
  if (typeof on !== 'function') return;
  var W = AttackWatch;
  var NEW_ROW_AGE = 60000;   // ms : au-delà, la ligne existait déjà
  var REPORT_DELAY = 2000;   // ms : laisse à la feuille le temps d'écrire le nom et le lien
  var SCAN_DELAY = 4000;     // ms : après un changement du bouton, délai avant de chercher la nouvelle ligne
  var decided = {};          // cid|ligne -> true (ligne déjà classée par add:attribute)
  var reported = {};         // cid|ligne -> true (ligne déjà annoncée)
  var pending = {};          // cid -> true (recherche de nouvelle ligne en attente)

  function st() {
    state.AttackWatch = state.AttackWatch || { on: true, log: [] };
    return state.AttackWatch;
  }
  function online() {
    return findObjs({ _type: 'player', _online: true }).map(function (p) { return W.clean(p.get('_displayname'), 25); });
  }
  function record(e) {
    var s = st();
    if (!s.on) return;
    e.online = online();
    W.push(s.log, e);
    sendChat('attackwatch', '/w gm ' + W.line(e), null, { noarchive: true });
  }
  function attrsOf(charId) {
    return findObjs({ _type: 'attribute', _characterid: charId });
  }
  function sourceName(charId, section, rowId) {
    var a = findObjs({ _type: 'attribute', _characterid: charId, name: 'repeating_' + section + '_' + rowId + '_name' })[0];
    return a ? a.get('current') : rowId;
  }
  function charName(charId) {
    var c = getObj('character', charId);
    return c ? c.get('name') : charId;
  }

  // ids (en minuscules) des lignes d'attaque d'un personnage
  function weaponRows(cid) {
    var keys = {};
    attrsOf(cid).forEach(function (a) {
      var w = W.parseWeapon(a.get('name'));
      if (w) keys[w.rowId.toLowerCase()] = true;
    });
    return keys;
  }
  // annonce une nouvelle ligne d'attaque (une seule fois par ligne)
  function reportRow(cid, key) {
    if (reported[cid + '|' + key]) return;
    reported[cid + '|' + key] = true;
    var prefix = 'repeating_weapon_' + key + '_', fields = {}, names = { item: {}, spells: {}, ability: {} }, born = null;
    attrsOf(cid).forEach(function (a) {
      var n = a.get('name'), low = n.toLowerCase(), m;
      if (low.indexOf(prefix) === 0) {
        fields[n.slice(prefix.length)] = a.get('current');
        var t = W.idTime(a.id);
        if (t !== null && (born === null || t < born)) born = t;
      } else if ((m = /^repeating_(item|spells|ability)_(-[^_]+)_name$/.exec(n))) {
        names[m[1]][m[2].toLowerCase()] = a.get('current');
      }
    });
    record({ kind: 'row', t: born || Date.now(), char: charName(cid), name: fields.name || '', link: W.linkOf(fields, names) });
  }

  function onButton(obj, prev) {
    var b = W.parseButton(obj.get('name'));
    if (!b) return;
    var cid = obj.get('_characterid');
    record({ kind: 'button', t: Date.now(), char: charName(cid), section: b.section,
      source: sourceName(cid, b.section, b.rowId),
      prev: prev ? prev.current : null, value: obj.get('current') });
    // la feuille crée la ligne juste après : on compare les lignes avant et quelques secondes après
    if (pending[cid]) return;
    var before = weaponRows(cid);
    pending[cid] = true;
    setTimeout(function () {
      delete pending[cid];
      var after = weaponRows(cid);
      Object.keys(after).forEach(function (k) { if (!before[k]) reportRow(cid, k); });
    }, SCAN_DELAY);
  }
  // filet de sécurité : ligne neuve signalée par un évènement add:attribute
  function onWeaponAttr(obj) {
    var w = W.parseWeapon(obj.get('name'));
    if (!w) return;
    var cid = obj.get('_characterid'), key = w.rowId.toLowerCase();
    if (decided[cid + '|' + key]) return;
    decided[cid + '|' + key] = true;
    var prefix = 'repeating_weapon_' + key + '_';
    var rowIds = attrsOf(cid).filter(function (a) { return a.get('name').toLowerCase().indexOf(prefix) === 0; })
      .map(function (a) { return a.id; });
    // comparé à l'heure de l'attribut qui vient d'arriver (même horloge que le navigateur qui l'a créé)
    if (!W.isNewRow(rowIds, W.idTime(obj.id) || Date.now(), NEW_ROW_AGE)) return;
    setTimeout(function () { reportRow(cid, key); }, REPORT_DELAY);
  }

  on('ready', function () {
    record({ kind: 'restart', t: Date.now() });
    on('change:attribute', function (obj, prev) { onButton(obj, prev); });
    on('add:attribute', function (obj) { onButton(obj, null); onWeaponAttr(obj); });
  });

  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!attackwatch(\s|$)/.test(msg.content)) return;
    if (!playerIsGM(msg.playerid)) return;
    var who = msg.who.replace(/ \(GM\)$/, '');
    var reply = function (t) { sendChat('attackwatch', '/w "' + who + '" ' + t, null, { noarchive: true }); };
    var arg = msg.content.replace(/^!attackwatch\s*/, '').trim().toLowerCase();
    var s = st();
    if (arg === 'on' || arg === 'off') { s.on = arg === 'on'; reply('Surveillance ' + (s.on ? 'activée.' : 'coupée.')); return; }
    if (arg === 'clear') { s.log = []; reply('Journal vidé.'); return; }
    if (arg === 'log') {
      if (!s.log.length) { reply('Journal vide.'); return; }
      for (var i = 0, n = 0; i < s.log.length; i += 10, n++) {
        (function (chunk, delay) { setTimeout(function () { reply(chunk); }, delay); })(s.log.slice(i, i + 10).map(W.line).join('<br>'), n * 400);
      }
      return;
    }
    if (arg) { reply('Usage : !attackwatch [log|on|off|clear]'); return; }
    reply('Surveillance ' + (s.on ? 'active' : 'coupée') + ', ' + s.log.length + ' évènements dans le journal (!attackwatch log).');
  });
})();
