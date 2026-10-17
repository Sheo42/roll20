/* pjstats.js - !pjstats <nom> [sections]
 * Lecture seule, MJ uniquement. Chuchote les chiffres utiles d'une fiche Pathfinder Community
 * (caracs, PV, CA, JS, BBA, BMO/DMD, armes, dons, objets, sorts, buffs) sans ouvrir la feuille.
 * Sections (facultatives, séparées par des espaces, en anglais): base weapons feats items spells buffs. Défaut: toutes.
 * Les attributs sont indexés en une seule passe findObjs (pas de getAttrByName en boucle).
 */
var PjStats = (function () {
  'use strict';

  var SECTIONS = ['base', 'weapons', 'feats', 'items', 'spells', 'buffs'];
  var REP_RE = /^repeating_([a-z0-9-]+)_(-[A-Za-z0-9_-]{19}|[A-Za-z0-9_-]{20})_(.+)$/;

  // attrs: [{name, current, max}] -> {flat: {nom: {current,max}}, rep: {section: {rowid: {champ: valeur}}}, order: {section: [rowid]}}
  function indexAttrs(attrs) {
    var flat = {}, rep = {}, order = {};
    attrs.forEach(function (a) {
      var m = REP_RE.exec(a.name);
      if (m) {
        var sec = m[1].toLowerCase(), row = m[2].toLowerCase(), field = m[3];
        if (!rep[sec]) { rep[sec] = {}; order[sec] = []; }
        if (!rep[sec][row]) { rep[sec][row] = {}; order[sec].push(row); }
        if (!(field in rep[sec][row])) rep[sec][row][field] = a.current;
        return;
      }
      if (!(a.name in flat)) flat[a.name] = { current: a.current, max: a.max };
    });
    return { flat: flat, rep: rep, order: order };
  }

  function v(idx, name) {
    var a = idx.flat[name];
    if (!a) return '';
    var c = a.current;
    return (c === undefined || c === null) ? '' : String(c).trim();
  }
  function vmax(idx, name) {
    var a = idx.flat[name];
    return a && a.max !== undefined && a.max !== null ? String(a.max).trim() : '';
  }
  function sgn(x) {
    if (x === '') return '?';
    var n = Number(x);
    return isNaN(n) ? x : (n >= 0 ? '+' + n : String(n));
  }
  function clean(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  }
  function rows(idx, sec) {
    return (idx.order[sec] || []).map(function (id) { return idx.rep[sec][id]; });
  }
  function names(idx, sec) {
    return rows(idx, sec).map(function (r) { return clean(r.name); }).filter(Boolean);
  }

  function base(idx) {
    var out = [];
    var classes = [];
    for (var i = 0; i < 6; i++) {
      var cn = v(idx, 'class-' + i + '-name'), cl = v(idx, 'class-' + i + '-level');
      if (cn) classes.push(clean(cn) + ' ' + (cl || '?'));
    }
    out.push('Classes: ' + (classes.join(', ') || '?') + ' (niveau ' + (v(idx, 'level') || '?') + ') · ' + clean(v(idx, 'race')));
    out.push('Caracs: ' + ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(function (k) {
      return k + ' ' + (v(idx, k) || '?') + ' (' + sgn(v(idx, k + '-mod')) + ')';
    }).join(', '));
    var hp = v(idx, 'HP'), hpm = vmax(idx, 'HP');
    out.push('PV: ' + (hp || '?') + '/' + (hpm || '?') + (v(idx, 'HP-temp') && v(idx, 'HP-temp') !== '0' ? ' (+' + v(idx, 'HP-temp') + ' temp)' : '') +
      ' · Init ' + sgn(v(idx, 'init')) + ' · Vitesse ' + (v(idx, 'speed-modified') || '?'));
    out.push('CA ' + (v(idx, 'AC') || '?') + ' / contact ' + (v(idx, 'Touch') || '?') + ' / dépourvu ' + (v(idx, 'Flat-Footed') || '?') +
      ' [armure ' + (v(idx, 'AC-armor') || 0) + ', bouclier ' + (v(idx, 'AC-shield') || 0) + ', carac ' + (v(idx, 'AC-ability') || 0) +
      ', parade ' + (v(idx, 'AC-deflect') || 0) + ', naturelle ' + (v(idx, 'AC-natural') || 0) + ', esquive ' + (v(idx, 'AC-dodge') || 0) +
      ', divers ' + (v(idx, 'AC-misc') || 0) + ']');
    out.push('JS: Réf ' + sgn(v(idx, 'Ref')) + ', Vig ' + sgn(v(idx, 'Fort')) + ', Vol ' + sgn(v(idx, 'Will')) +
      ' · BBA ' + sgn(v(idx, 'bab')) + ' · BMO ' + sgn(v(idx, 'CMB')) + ' · DMD ' + (v(idx, 'CMD') || '?') +
      ' · RM ' + (v(idx, 'SR') || '0') + ' · RD ' + (clean(v(idx, 'DR')) || '-'));
    var arm = [];
    if (v(idx, 'armor3-type')) arm.push('armure ' + clean(v(idx, 'armor3-type')) + ' (+' + (v(idx, 'armor3-acbonus') || 0) + ', alt +' + (v(idx, 'armor3-enhance') || 0) + ')');
    if (v(idx, 'shield3-type')) arm.push('bouclier ' + clean(v(idx, 'shield3-type')) + ' (+' + (v(idx, 'shield3-acbonus') || 0) + ', alt +' + (v(idx, 'shield3-enhance') || 0) + ')');
    if (arm.length) out.push('Protections: ' + arm.join(', '));
    return out;
  }

  function armes(idx) {
    var out = rows(idx, 'weapon').map(function (r) {
      var n = clean(r.name);
      if (!n) return '';
      var dmg = (r['damage-dice-num'] || '?') + 'd' + (r['damage-die'] || '?') + sgn(r['total-damage'] === undefined ? '' : String(r['total-damage']).trim());
      var crit = (r['crit-target'] || '20') + '/x' + (r['crit-multiplier'] || '2');
      return n + ': ' + sgn(r['total-attack'] === undefined ? '' : String(r['total-attack']).trim()) + ', ' + dmg + ', ' + crit +
        (r.enhance && r.enhance !== '0' ? ', alt +' + r.enhance : '');
    }).filter(Boolean);
    return out.length ? ['Armes: ' + out.join(' | ')] : ['Armes: aucune'];
  }

  function dons(idx) {
    var out = [];
    var groups = [['Dons', 'feat'], ['Dons mythiques', 'mythic-feat'], ['Traits', 'trait'], ['Raciaux', 'racial-trait'],
      ['Capacités de classe', 'class-ability'], ['Capacités (menu)', 'ability'], ['Capacités mythiques', 'mythic-ability']];
    groups.forEach(function (g) {
      var n = names(idx, g[1]);
      if (n.length) out.push(g[0] + ' (' + n.length + '): ' + n.join(', '));
    });
    return out.length ? out : ['Dons: aucun'];
  }

  function objets(idx) {
    var list = rows(idx, 'item').map(function (r) {
      var n = clean(r.name);
      if (!n) return '';
      var q = r.qty && r.qty !== '1' && r.qty !== '0' ? ' x' + r.qty : '';
      var loc = clean(r.location);
      return n + q + (loc && loc !== '0' ? ' [' + loc + ']' : '');
    }).filter(Boolean);
    return list.length ? ['Objets (' + list.length + '): ' + list.join(', ')] : ['Objets: aucun'];
  }

  function sorts(idx) {
    var byLvl = {};
    rows(idx, 'spells').forEach(function (r) {
      var n = clean(r.name);
      if (!n) return;
      var lvl = String(r.spell_level === undefined ? '?' : r.spell_level).trim() || '?';
      (byLvl[lvl] = byLvl[lvl] || []).push(n);
    });
    var lvls = Object.keys(byLvl).sort(function (a, b) { return (Number(a) || 0) - (Number(b) || 0); });
    var out = lvls.map(function (l) { return 'Sorts niv ' + l + ' (' + byLvl[l].length + '): ' + byLvl[l].join(', '); });
    return out.length ? out : ['Sorts: aucun'];
  }

  function buffs(idx) {
    var list = rows(idx, 'buff2').concat(rows(idx, 'buff')).map(function (r) {
      var n = clean(r.name);
      if (!n) return '';
      var on = r.enable_toggle === '1' || r['buff-enable_toggle'] === '1';
      return n + (on ? ' (actif)' : '');
    }).filter(Boolean);
    return list.length ? ['Buffs (' + list.length + '): ' + list.join(', ')] : ['Buffs: aucun'];
  }

  var BUILDERS = { base: base, weapons: armes, feats: dons, items: objets, spells: sorts, buffs: buffs };

  function parseArgs(argStr) {
    var words = String(argStr || '').trim().split(/\s+/).filter(Boolean);
    var secs = [];
    while (words.length && SECTIONS.indexOf(words[words.length - 1].toLowerCase()) !== -1) {
      secs.unshift(words.pop().toLowerCase());
    }
    return { name: words.join(' '), sections: secs.length ? secs : SECTIONS.slice() };
  }

  function report(attrs, sections) {
    var idx = indexAttrs(attrs);
    var lines = [];
    sections.forEach(function (s) { lines = lines.concat(BUILDERS[s](idx)); });
    return lines;
  }

  // Regroupe les lignes en messages de taille raisonnable pour le chat.
  function chunk(lines, maxLen) {
    maxLen = maxLen || 1800;
    var out = [], cur = '';
    lines.forEach(function (l) {
      while (l.length > maxLen) {
        if (cur) { out.push(cur); cur = ''; }
        out.push(l.slice(0, maxLen));
        l = l.slice(maxLen);
      }
      if (cur && (cur.length + l.length + 4) > maxLen) { out.push(cur); cur = ''; }
      cur = cur ? cur + '<br>' + l : l;
    });
    if (cur) out.push(cur);
    return out;
  }

  return { indexAttrs: indexAttrs, parseArgs: parseArgs, report: report, chunk: chunk, SECTIONS: SECTIONS };
})();

if (typeof module !== 'undefined') module.exports = PjStats;

(function () {
  'use strict';
  if (typeof on !== 'function') return;

  on('chat:message', function (msg) {
    if (msg.type !== 'api' || !/^!pjstats(\s|$)/i.test(msg.content)) return;
    var who = String(msg.who || 'gm').replace(/ \(GM\)$/, '');
    var reply = function (t) { sendChat('pjstats', '/w "' + who + '" ' + t, null, { noarchive: true }); };
    if (!playerIsGM(msg.playerid)) { reply('Réservé au MJ.'); return; }

    var args = PjStats.parseArgs(msg.content.replace(/^!pjstats/i, ''));
    if (!args.name) { reply('Usage: !pjstats Nom du Personnage [' + PjStats.SECTIONS.join(' ') + ']'); return; }

    var chars = findObjs({ _type: 'character' }).filter(function (c) {
      return c.get('name').toLowerCase() === args.name.toLowerCase();
    });
    if (!chars.length) { reply('Personnage introuvable: ' + args.name); return; }
    if (chars.length > 1) reply(chars.length + ' personnages portent ce nom, lecture du premier.');
    var ch = chars[0];

    var attrs = findObjs({ _type: 'attribute', _characterid: ch.id }).map(function (a) {
      return { name: a.get('name'), current: a.get('current'), max: a.get('max') };
    });
    var lines = ['<b>' + ch.get('name') + '</b> (' + attrs.length + ' attributs)'].concat(PjStats.report(attrs, args.sections));
    PjStats.chunk(lines).forEach(reply);
  });
})();
