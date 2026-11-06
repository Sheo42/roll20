// abilityfix.js - Roll20 API script, GM only. CHANGES attributes, with safeguards.
//
//   !abilityfix <character>              -> DRY RUN: changes nothing, reports what would be changed
//   !abilityfix <character> confirm N  -> changes, ONLY if the number N is still exact
//
// Verified cause (Pathfinder Community sheet code, PFAbility.getTopOfMenu, and a test on a copy):
// an ability whose "showinmenu" is true but whose type ("ability_type") is empty or missing is read
// by the sheet with an invalid type ("0"). This produces "could not find top macro for 0" in a loop
// and makes the page much heavier on every change to a token linked to the character.
//
// Fix: for these rows only, showinmenu is set to "0" (the ability no longer appears in the chat's ability
// menu; it stays intact on the sheet). No other value is touched, nothing is deleted.
// To keep the ability in the menu, give it a real type (Ex, Sp or Su) on the sheet instead.
// Try it first on a COPY of the character.

(function () {
  var BATCH = 20;     // changes per batch
  var PAUSE = 600;    // ms between two batches
  var ROW = /^repeating_ability_(-[\w-]{19})_(.+)$/;

  var clean = function (v, max) {
    return String(v === undefined || v === null ? '' : v).replace(/[\[\]{}<>@&"]/g, '').replace(/\s+/g, ' ').slice(0, max || 40);
  };

  // rows to fix: showinmenu true AND ability_type empty or missing
  var buildPlan = function (charId) {
    var rows = {};
    findObjs({ _type: 'attribute', _characterid: charId }).forEach(function (a) {
      var m = (a.get('name') || '').match(ROW);
      if (!m) return;
      var r = rows[m[1]] = rows[m[1]] || {};
      if (m[2] === 'name') r.name = a.get('current');
      if (m[2] === 'showinmenu') { r.menuAttr = a; r.showinmenu = a.get('current'); }
      if (m[2] === 'ability_type') r.type = String(a.get('current') === undefined || a.get('current') === null ? '' : a.get('current'));
    });
    var targets = [];
    Object.keys(rows).forEach(function (id) {
      var r = rows[id];
      var inMenu = (parseInt(r.showinmenu, 10) || 0) !== 0;
      if (inMenu && r.menuAttr && (r.type === undefined || r.type === '')) {
        targets.push({ attr: r.menuAttr, row: clean(r.name, 30), type: r.type === undefined ? 'absent' : 'vide' });
      }
    });
    return { rows: Object.keys(rows).length, targets: targets };
  };

  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!abilityfix(\s|$)/.test(msg.content)) return;
    if (!playerIsGM(msg.playerid)) return;
    var who = msg.who.replace(/ \(GM\)$/, '');
    var reply = function (t) { sendChat('abilityfix', '/w "' + who + '" ' + t); };

    var args = msg.content.replace(/^!abilityfix\s*/, '').trim();
    var confirmCount = null;
    var m = args.match(/\s+confirm\s+(\d+)$/i);
    if (m) { confirmCount = parseInt(m[1], 10); args = args.replace(/\s+confirm\s+\d+$/i, '').trim(); }
    var name = args.toLowerCase();
    if (!name) { reply('Usage : !abilityfix nom du personnage [confirm N]'); return; }

    var chars = findObjs({ _type: 'character' }).filter(function (c) { return (c.get('name') || '').toLowerCase() === name; });
    if (chars.length !== 1) { reply(chars.length ? 'Plusieurs personnages portent ce nom, abandon.' : 'Aucun personnage nommé ' + clean(name) + '.'); return; }
    var c = chars[0];

    var plan = buildPlan(c.id);
    var n = plan.targets.length;
    var info = ['<b>' + clean(c.get('name')) + '</b> : ' + plan.rows + ' capacités, à masquer du menu (showinmenu 1 -> 0) : <b>' + n + '</b>'];
    if (n) info.push('lignes : ' + plan.targets.slice(0, 25).map(function (t) { return t.row + ' (type ' + t.type + ')'; }).join(', '));

    if (confirmCount === null) {
      info.push(n ? 'ESSAI À BLANC : rien n\'a été modifié. Pour appliquer : <b>!abilityfix ' + clean(c.get('name')) + ' confirm ' + n + '</b>' : 'Rien à corriger.');
      reply(info.join('<br>'));
      return;
    }
    if (confirmCount !== n) { info.push('ABANDON : tu as confirmé ' + confirmCount + ' mais il y en a ' + n + ' maintenant. Relance l\'essai à blanc.'); reply(info.join('<br>')); return; }
    if (!n) { reply(info.join('<br>')); return; }

    reply(info.join('<br>') + '<br>Modification de ' + n + ' attributs en cours...');
    var queue = plan.targets.slice();
    var done = 0;
    var step = function () {
      queue.splice(0, BATCH).forEach(function (t) { t.attr.set('current', '0'); done++; });
      if (queue.length) setTimeout(step, PAUSE);
      else reply('Terminé : ' + done + ' attributs modifiés. Relance !abilitycheck ' + clean(c.get('name')) + ' pour vérifier.');
    };
    step();
  });
})();
