// secretrolls.js - script API Roll20, réservé au MJ. Ajoute aux personnages un bouton de token « Secret »
// qui chuchote un menu de compétences ; chaque bouton du menu lance un jet secret natif de Roll20 (/sr) :
// seul le MJ voit le résultat, le joueur reçoit juste une confirmation.
//
// Même principe que les boutons de PFCompanion (All Skills, All Attacks...) : des capacités (abilities)
// du personnage, l'une en action de token. Le script ne sert qu'à les créer : une fois créées, les jets
// marchent sans lui (et même si le bac à sable API plante).
//
// Usage dans le chat :
//   !secretrolls                 -> ESSAI À BLANC sur les personnages des tokens sélectionnés
//   !secretrolls all             -> ESSAI À BLANC sur tous les PJ (personnages contrôlés par un joueur)
//   !secretrolls confirm N       -> crée / met à jour, SEULEMENT si le nombre de personnages (N) est exact
//   !secretrolls all confirm N
//   !secretrolls remove [all] [confirm N] -> retire ces capacités
//   !secretrolls auto on|off     -> ajout automatique (activé par défaut) : dès qu'un personnage a un joueur
//                                   (Contrôlé par) ou est renommé, ses capacités sont créées ou mises à jour
//
// Capacités créées par personnage :
//   - « Secret » : action de token, chuchote le menu au personnage (donc à ses joueurs) ;
//   - « sr-<compétence> » (13) : pas en action de token, appelées par les boutons du menu.
// Les boutons appellent des capacités (~Nom|sr-...) et non « !&#13;/sr ... », que l'éditeur de macros casse.

var SecretRolls = (function () {
  'use strict';
  var TOKEN_ACTION = 'Secret';
  var PREFIX = 'sr-';
  // [libellé affiché, attribut de la feuille Pathfinder Community]
  var SKILLS = [
    ['Évaluation', 'appraise'], ['Bluff', 'bluff'], ['Diplomatie', 'diplomacy'], ['Sabotage', 'disable-device'],
    ['Déguisement', 'disguise'], ['Intimidation', 'intimidate'], ['Perception', 'perception'],
    ['Psychologie', 'sense-motive'], ['Art de la magie', 'spellcraft'], ['Discrétion', 'stealth'],
    ['Survie', 'survival'], ['Représentation', 'perform'], ['Linguistique', 'linguistics']
  ];

  // un nom de personnage utilisable dans « ~Nom|capacité » et « /w "Nom" »
  function nameProblem(name) {
    if (!name || !String(name).trim()) return 'nom vide';
    if (/[|()\[\]{}"]/.test(name)) return 'le nom contient un de ces caractères : | ( ) [ ] { } "';
    return null;
  }

  function rollAction(label, attr) {
    return '/sr 1d20+@{' + attr + '}[' + label + ']';
  }

  function menuAction(charName) {
    var buttons = SKILLS.map(function (s) {
      return '[' + s[0] + ' (@{' + s[1] + '})](~' + charName + '|' + PREFIX + s[1] + ')';
    }).join(' ');
    return '/w "' + charName + '" &{template:pf_generic} {{name=Jets secrets}} {{' + buttons + '}}';
  }

  // abilities voulues pour un personnage : [{name, action, istokenaction}]
  function wanted(charName) {
    var list = [{ name: TOKEN_ACTION, action: menuAction(charName), istokenaction: true }];
    SKILLS.forEach(function (s) {
      list.push({ name: PREFIX + s[1], action: rollAction(s[0], s[1]), istokenaction: false });
    });
    return list;
  }

  function isOurs(abilityName) {
    if (abilityName === TOKEN_ACTION) return true;
    return SKILLS.some(function (s) { return abilityName === PREFIX + s[1]; });
  }

  // existing : [{name, action, istokenaction}] -> {create:[...], update:[...], same:n}
  function plan(charName, existing) {
    var byName = {};
    existing.forEach(function (a) { if (!byName[a.name]) byName[a.name] = a; });
    var out = { create: [], update: [], same: 0 };
    wanted(charName).forEach(function (w) {
      var e = byName[w.name];
      if (!e) out.create.push(w);
      else if (e.action !== w.action || !!e.istokenaction !== w.istokenaction) out.update.push(w);
      else out.same++;
    });
    return out;
  }

  function parseArgs(content) {
    var words = String(content || '').trim().split(/\s+/).slice(1).map(function (w) { return w.toLowerCase(); });
    var r = { all: false, remove: false, confirm: null, bad: [] };
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

  var api = { SKILLS: SKILLS, TOKEN_ACTION: TOKEN_ACTION, PREFIX: PREFIX, nameProblem: nameProblem,
    rollAction: rollAction, menuAction: menuAction, wanted: wanted, isOurs: isOurs, plan: plan, parseArgs: parseArgs };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof on !== 'function') return api;

  // ------------------------------------------------------------------ partie Roll20
  var NOM = 'SecretRolls';
  function tell(text) { sendChat(NOM, '/w gm ' + text, null, { noarchive: true }); }

  function targets(msg, all) {
    if (all) {
      return findObjs({ type: 'character' }).filter(function (c) { return String(c.get('controlledby') || '').trim() !== ''; });
    }
    var seen = {}, out = [];
    (msg.selected || []).forEach(function (s) {
      var g = getObj('graphic', s._id);
      var c = g && g.get('represents') && getObj('character', g.get('represents'));
      if (c && !seen[c.id]) { seen[c.id] = true; out.push(c); }
    });
    return out;
  }

  function abilitiesOf(c) { return findObjs({ type: 'ability', characterid: c.id }); }

  function st() {
    if (!state.SecretRolls) state.SecretRolls = { auto: true };
    return state.SecretRolls;
  }

  // ajout automatique : PJ (contrôlé par un joueur) au nom valide -> crée / met à jour sans demander
  function autoSync(c) {
    if (!st().auto || !c) return;
    var name = c.get('name');
    if (String(c.get('controlledby') || '').trim() === '' || nameProblem(name)) return;
    var ex = abilitiesOf(c);
    var p = plan(name, ex.map(function (ab) { return { name: ab.get('name'), action: ab.get('action'), istokenaction: ab.get('istokenaction') }; }));
    p.update.forEach(function (w) {
      ex.filter(function (x) { return x.get('name') === w.name; })[0].set({ action: w.action, istokenaction: w.istokenaction });
    });
    p.create.forEach(function (w) {
      createObj('ability', { _characterid: c.id, name: w.name, action: w.action, istokenaction: w.istokenaction });
    });
    if (p.create.length || p.update.length) tell('<b>' + name + '</b> : bouton Secret ' + (p.create.length ? 'ajouté' : 'mis à jour') + '.');
  }

  function run(msg) {
    var a = parseArgs(msg.content);
    if (a.bad.length) return tell('Option inconnue : ' + a.bad.join(' ') + '. Options : all, remove, confirm N, auto on|off.');
    if (a.auto) { st().auto = a.auto === 'on'; return tell('Ajout automatique ' + (st().auto ? 'activé' : 'désactivé') + '.'); }
    var chars = targets(msg, a.all);
    if (!chars.length) return tell(a.all ? 'Aucun personnage contrôlé par un joueur.' : 'Sélectionne des tokens liés à un personnage, ou ajoute « all ».');

    var lines = [], ok = [];
    chars.forEach(function (c) {
      var name = c.get('name');
      var pb = nameProblem(name);
      if (pb) { lines.push('<b>' + name + '</b> : ignoré (' + pb + ')'); return; }
      var ex = abilitiesOf(c);
      if (a.remove) {
        var mine = ex.filter(function (ab) { return isOurs(ab.get('name')); });
        lines.push('<b>' + name + '</b> : ' + mine.length + ' capacité(s) à retirer');
        ok.push({ c: c, mine: mine });
      } else {
        var p = plan(name, ex.map(function (ab) { return { name: ab.get('name'), action: ab.get('action'), istokenaction: ab.get('istokenaction') }; }));
        lines.push('<b>' + name + '</b> : ' + p.create.length + ' à créer, ' + p.update.length + ' à mettre à jour, ' + p.same + ' à jour');
        ok.push({ c: c, p: p, ex: ex });
      }
    });

    var cmd = '!secretrolls' + (a.remove ? ' remove' : '') + (a.all ? ' all' : '') + ' confirm ' + ok.length;
    if (a.confirm === null) {
      return tell('<b>Essai à blanc</b> (' + ok.length + ' personnage(s)) :<br>' + lines.join('<br>') +
        (ok.length ? '<br>[Confirmer](' + cmd + ')' : ''));
    }
    if (a.confirm !== ok.length) return tell('Le nombre a changé : ' + ok.length + ' personnage(s), pas ' + a.confirm + '. Relance l\'essai à blanc.');

    ok.forEach(function (o) {
      if (a.remove) { o.mine.forEach(function (ab) { ab.remove(); }); return; }
      o.p.update.forEach(function (w) {
        var ab = o.ex.filter(function (x) { return x.get('name') === w.name; })[0];
        ab.set({ action: w.action, istokenaction: w.istokenaction });
      });
      o.p.create.forEach(function (w) {
        createObj('ability', { _characterid: o.c.id, name: w.name, action: w.action, istokenaction: w.istokenaction });
      });
    });
    tell((a.remove ? 'Retiré' : 'Fait') + ' pour ' + ok.length + ' personnage(s) :<br>' + lines.join('<br>'));
  }

  on('change:character:name', function (c) { autoSync(c); });
  on('change:character:controlledby', function (c) { autoSync(c); });

  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!secretrolls(\s|$)/i.test(msg.content)) return;
    if (!playerIsGM(msg.playerid)) return;
    run(msg);
  });
  return api;
})();
