// secretrolls.js - script API Roll20, réservé au MJ. Ajoute aux PJ un bouton de token « Secret » :
// une liste déroulante des compétences (avec le bonus du personnage) puis un jet secret natif de Roll20 (/sr) :
// seul le MJ voit le résultat, le joueur reçoit juste une confirmation.
//
// Même principe que les boutons de PFCompanion (All Skills, All Attacks...) : une capacité (ability)
// du personnage en action de token. Le script ne sert qu'à la créer : ensuite le jet marche sans lui
// (et même si le bac à sable API plante).
//
// Usage dans le chat :
//   !secretrolls                 -> ESSAI À BLANC sur les personnages des tokens sélectionnés
//   !secretrolls all             -> ESSAI À BLANC sur tous les PJ (personnages contrôlés par un joueur)
//   !secretrolls confirm N       -> crée / met à jour, SEULEMENT si le nombre de personnages (N) est exact
//   !secretrolls all confirm N
//   !secretrolls remove [all] [confirm N] -> retire la capacité
//   !secretrolls auto on|off     -> ajout automatique (activé par défaut) : dès qu'un personnage contrôlé
//                                   par un joueur change ou qu'un de ses tokens est posé, la capacité est
//                                   créée ou mise à jour
//
// Une seule capacité par personnage : « Secret ». Les anciennes capacités cachées « sr-<compétence> »
// de la première version sont retirées à la mise à jour.
// Pas de menu de boutons : un bouton ne peut lancer /sr que par « !&#13;/sr ... », que l'éditeur de macros
// casse, ou en appelant une capacité par compétence (13 capacités de plus sur la fiche).

var SecretRolls = (function () {
  'use strict';
  var TOKEN_ACTION = 'Secret';
  var LEGACY_PREFIX = 'sr-';
  // [libellé affiché, attribut de la feuille Pathfinder Community]
  // pas de virgule ni de barre verticale dans les libellés (liste déroulante)
  var SKILLS = [
    ['Évaluation', 'appraise'], ['Bluff', 'bluff'], ['Diplomatie', 'diplomacy'], ['Sabotage', 'disable-device'],
    ['Déguisement', 'disguise'], ['Intimidation', 'intimidate'], ['Perception', 'perception'],
    ['Psychologie', 'sense-motive'], ['Art de la magie', 'spellcraft'], ['Discrétion', 'stealth'],
    ['Survie', 'survival'], ['Représentation', 'perform'], ['Linguistique', 'linguistics']
  ];

  // même forme que la macro Blindroll testée dans le jeu, avec le bonus dans chaque libellé
  function secretAction() {
    return '/sr 1d20+?{Compétence|' + SKILLS.map(function (s) {
      return s[0] + ' (@{' + s[1] + '}),@{' + s[1] + '}[' + s[0] + ']';
    }).join('|') + '}';
  }

  function isLegacy(abilityName) {
    return SKILLS.some(function (s) { return abilityName === LEGACY_PREFIX + s[1]; });
  }
  function isOurs(abilityName) { return abilityName === TOKEN_ACTION || isLegacy(abilityName); }

  // existing : [{id, name, action, istokenaction}] -> {create, update, remove:[ids], same}
  function plan(existing) {
    var out = { create: null, update: null, remove: [], same: false };
    var mine = existing.filter(function (a) { return a.name === TOKEN_ACTION; });
    var action = secretAction();
    if (!mine.length) out.create = { name: TOKEN_ACTION, action: action, istokenaction: true };
    else if (mine[0].action !== action || !mine[0].istokenaction) out.update = mine[0].id;
    else out.same = true;
    mine.slice(1).forEach(function (a) { out.remove.push(a.id); });
    existing.forEach(function (a) { if (isLegacy(a.name)) out.remove.push(a.id); });
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

  // ------------------------------------------------------------------ partie Roll20
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

  // ajout automatique : PJ (contrôlé par un joueur) -> crée / met à jour sans demander
  function autoSync(c) {
    if (!st().auto || !isPC(c)) return;
    var p = planFor(c);
    if (!hasWork(p)) return;
    apply(c, p);
    tell('<b>' + (c.get('name') || 'Personnage sans nom') + '</b> : bouton Secret ' + (p.create ? 'ajouté' : 'mis à jour') + '.');
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
        var mine = abilitiesOf(c).filter(function (ab) { return isOurs(ab.get('name')); });
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

  // tout changement du personnage (dont « Contrôlé par » sur une fiche toute neuve), et tout token posé
  // ou relié à un personnage : on vérifie, il ne se passe rien si la capacité est déjà à jour
  // dans « ready » : sinon Roll20 envoie un add:graphic pour chaque token existant au démarrage
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
