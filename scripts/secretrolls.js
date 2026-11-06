// secretrolls.js - Roll20 API script, GM only. Adds a "Blindroll" token button to PCs:
// a dropdown of skills (with the character's bonus) then a native Roll20 secret roll (/sr):
// only the GM sees the result, the player just gets a confirmation.
//
// Same principle as the PFCompanion buttons (All Skills, All Attacks...): an ability
// of the character as a token action. The script is only there to create it: afterwards the roll works without it
// (even if the API sandbox crashes).
//
// Usage in chat:
//   !secretrolls                 -> DRY RUN on the characters of the selected tokens
//   !secretrolls all             -> DRY RUN on all PCs (characters controlled by a player)
//   !secretrolls confirm N       -> creates / updates, ONLY if the number of characters (N) is exact
//   !secretrolls all confirm N
//   !secretrolls remove [all] [confirm N] -> removes the ability
//   !secretrolls auto on|off     -> automatic add (on by default): as soon as a character controlled
//                                   by a player changes or one of their tokens is placed, the ability is
//                                   created or updated
//
// A single ability per character: "Blindroll". The script's old abilities ("Secret",
// "sr-<skill>") are removed on update.
// No button menu (all tried, 2026-11-04): "!&#13;/sr" breaks in an ability (formula error),
// a backtick link [x](`/sr ...) works but not in a whisper (formula error), a public menu
// is not wanted, hidden abilities per skill clutter the sheet, and going through the API no longer
// works when the sandbox crashes. The dropdown is private and needs no API.

var SecretRolls = (function () {
  'use strict';
  var TOKEN_ACTION = 'Blindroll'; // same name as the old macro, so players find their way
  var OLD_TOKEN_ACTION = 'Secret'; // name used by the 2026-11-04 versions, removed on update
  var LEGACY_PREFIX = 'sr-';
  // [displayed label, Pathfinder Community sheet attribute]
  // no comma or vertical bar in labels (dropdown)
  var SKILLS = [
    ['Évaluation', 'appraise'], ['Bluff', 'bluff'], ['Diplomatie', 'diplomacy'], ['Sabotage', 'disable-device'],
    ['Déguisement', 'disguise'], ['Intimidation', 'intimidate'], ['Perception', 'perception'],
    ['Psychologie', 'sense-motive'], ['Art de la magie', 'spellcraft'], ['Discrétion', 'stealth'],
    ['Survie', 'survival'], ['Représentation', 'perform'], ['Linguistique', 'linguistics']
  ];

  // same form as the Blindroll macro tested in the game, with the bonus in each label
  function secretAction() {
    return '/sr 1d20+?{Compétence|' + SKILLS.map(function (s) {
      return s[0] + ' (@{' + s[1] + '}),@{' + s[1] + '}[' + s[0] + ']';
    }).join('|') + '}';
  }

  // the script's old abilities: sr-<skill>, and "Secret" only if it really is ours (a /sr roll)
  function isLegacy(abilityName, action) {
    if (abilityName === OLD_TOKEN_ACTION) return /\/sr |Jets secrets|!secretroll/.test(String(action || ''));
    return SKILLS.some(function (s) { return abilityName === LEGACY_PREFIX + s[1]; });
  }
  function isOurs(abilityName, action) { return abilityName === TOKEN_ACTION || isLegacy(abilityName, action); }

  // existing: [{id, name, action, istokenaction}] -> {create, update, remove:[ids], same}
  function plan(existing) {
    var out = { create: null, update: null, remove: [], same: false };
    var mine = existing.filter(function (a) { return a.name === TOKEN_ACTION; });
    var action = secretAction();
    if (!mine.length) out.create = { name: TOKEN_ACTION, action: action, istokenaction: true };
    else if (mine[0].action !== action || !mine[0].istokenaction) out.update = mine[0].id;
    else out.same = true;
    mine.slice(1).forEach(function (a) { out.remove.push(a.id); });
    existing.forEach(function (a) { if (isLegacy(a.name, a.action)) out.remove.push(a.id); });
    return out;
  }
  function hasWork(p) { return !!(p.create || p.update || p.remove.length); }
  function describe(p) {
    if (!hasWork(p)) return 'à jour';
    var parts = [];
    if (p.create) parts.push('à créer');
    if (p.update) parts.push('à mettre à jour');
    if (p.remove.length) parts.push(p.remove.length + ' ancienne(s) capacité(s) à retirer');
    return parts.join(', ');
  }

  function parseArgs(content) {
    var words = String(content || '').trim().split(/\s+/).slice(1).map(function (w) { return w.toLowerCase(); });
    var r = { all: false, remove: false, confirm: null, auto: null, bad: [] };
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w === 'auto' && /^(on|off)$/.test(words[i + 1] || '')) { r.auto = words[++i]; }
      else if (w === 'all') r.all = true;
      else if (w === 'remove') r.remove = true;
      else if (w === 'confirm' && /^\d+$/.test(words[i + 1] || '')) { r.confirm = parseInt(words[++i], 10); }
      else r.bad.push(w);
    }
    return r;
  }

  var api = { SKILLS: SKILLS, TOKEN_ACTION: TOKEN_ACTION, secretAction: secretAction, isOurs: isOurs,
    isLegacy: isLegacy, plan: plan, hasWork: hasWork, describe: describe, parseArgs: parseArgs };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof on !== 'function') return api;

  // ------------------------------------------------------------------ Roll20 part
  var NOM = 'SecretRolls';
  function tell(text) { sendChat(NOM, '/w gm ' + text, null, { noarchive: true }); }
  function isPC(c) { return !!c && String(c.get('controlledby') || '').trim() !== ''; }

  function targets(msg, all) {
    if (all) return findObjs({ type: 'character' }).filter(isPC);
    var seen = {}, out = [];
    (msg.selected || []).forEach(function (s) {
      var g = getObj('graphic', s._id);
      var c = g && g.get('represents') && getObj('character', g.get('represents'));
      if (c && !seen[c.id]) { seen[c.id] = true; out.push(c); }
    });
    return out;
  }

  function abilitiesOf(c) { return findObjs({ type: 'ability', characterid: c.id }); }
  function planFor(c) {
    return plan(abilitiesOf(c).map(function (ab) {
      return { id: ab.id, name: ab.get('name'), action: ab.get('action'), istokenaction: ab.get('istokenaction') };
    }));
  }
  function apply(c, p) {
    if (p.create) createObj('ability', { _characterid: c.id, name: p.create.name, action: p.create.action, istokenaction: true });
    if (p.update) { var u = getObj('ability', p.update); if (u) u.set({ action: secretAction(), istokenaction: true }); }
    p.remove.forEach(function (id) { var r = getObj('ability', id); if (r) r.remove(); });
  }

  function st() {
    if (!state.SecretRolls) state.SecretRolls = { auto: true };
    return state.SecretRolls;
  }

  // automatic add: PC (controlled by a player) -> creates / updates without asking
  function autoSync(c) {
    if (!st().auto || !isPC(c)) return;
    var p = planFor(c);
    if (!hasWork(p)) return;
    apply(c, p);
    tell('<b>' + (c.get('name') || 'Personnage sans nom') + '</b> : bouton Blindroll ' + (p.create ? 'ajouté' : 'mis à jour') + '.');
  }
  function autoSyncToken(g) {
    var cid = g && g.get('represents');
    if (cid) autoSync(getObj('character', cid));
  }

  function run(msg) {
    var a = parseArgs(msg.content);
    if (a.bad.length) return tell('Option inconnue : ' + a.bad.join(' ') + '. Options : all, remove, confirm N, auto on|off.');
    if (a.auto) { st().auto = a.auto === 'on'; return tell('Ajout automatique ' + (st().auto ? 'activé' : 'désactivé') + '.'); }
    var chars = targets(msg, a.all);
    if (!chars.length) return tell(a.all ? 'Aucun personnage contrôlé par un joueur.' : 'Sélectionne des tokens liés à un personnage, ou ajoute « all ».');

    var lines = [], todo = [];
    chars.forEach(function (c) {
      var name = c.get('name') || 'Personnage sans nom';
      if (a.remove) {
        var mine = abilitiesOf(c).filter(function (ab) { return isOurs(ab.get('name'), ab.get('action')); });
        lines.push('<b>' + name + '</b> : ' + mine.length + ' capacité(s) à retirer');
        todo.push({ c: c, mine: mine });
      } else {
        var p = planFor(c);
        lines.push('<b>' + name + '</b> : ' + describe(p));
        todo.push({ c: c, p: p });
      }
    });

    var cmd = '!secretrolls' + (a.remove ? ' remove' : '') + (a.all ? ' all' : '') + ' confirm ' + todo.length;
    if (a.confirm === null) {
      return tell('<b>Essai à blanc</b> (' + todo.length + ' personnage(s)) :<br>' + lines.join('<br>') + '<br>[Confirmer](' + cmd + ')');
    }
    if (a.confirm !== todo.length) return tell('Le nombre a changé : ' + todo.length + ' personnage(s), pas ' + a.confirm + '. Relance l\'essai à blanc.');

    todo.forEach(function (o) {
      if (a.remove) o.mine.forEach(function (ab) { ab.remove(); });
      else apply(o.c, o.p);
    });
    tell((a.remove ? 'Retiré' : 'Fait') + ' pour ' + todo.length + ' personnage(s) :<br>' + lines.join('<br>'));
  }

  // any change to the character (including "Controlled by" on a brand-new sheet), and any token placed
  // or linked to a character: we check, nothing happens if the ability is already up to date
  // in "ready": otherwise Roll20 sends an add:graphic for every existing token at startup
  on('ready', function () {
    on('change:character', function (c) { autoSync(c); });
    on('add:graphic', function (g) { autoSyncToken(g); });
    on('change:graphic:represents', function (g) { autoSyncToken(g); });
    on('chat:message', function (msg) {
      if (msg.type !== 'api' || !/^!secretrolls(\s|$)/i.test(msg.content)) return;
      if (!playerIsGM(msg.playerid)) return;
      run(msg);
    });
  });
  return api;
})();
