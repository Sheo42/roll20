/*
 * bufftracker.js — Suivi des buffs et des durées de sort (Pathfinder 1e) pour l'API Roll20
 * Version 2.0 — un lancement porte une liste de cibles (un sort lancé sur plusieurs
 *               alliés = une seule ligne) ; choix des cibles par leur nom ou avec des
 *               boutons à cocher ; lien direct vers la fenêtre « Effets actifs ».
 * Version 2.1 — plus de marqueur d'état sur les tokens (ceux d'avant sont retirés).
 * Version 2.2 — plus besoin de carte : cibles et lanceur par fiche ou par nom libre.
 * Version 2.3 — boutons à cocher réparés ; minutes écrites « min » ; un joueur seulement
 *               ciblé ne retire que ses personnages.
 * Version 2.4 — un nom partiel n'est plus deviné : boutons pour choisir ; durées en jours.
 *
 * MISE EN PLACE (une seule fois)
 *   1. Coller ce fichier dans un nouveau script API, enregistrer.
 *   2. Créer la macro « Buffs » (visible par tous, dans la barre de macros) : !buff
 *   Le script crée le handout « Effets actifs », visible par tous les joueurs.
 *
 * CE QUE VOIENT LES JOUEURS
 *   - La fenêtre « Effets actifs » (un handout, rangé par personnage) : à garder
 *     ouverte à côté de la carte, réécrite par le script à chaque changement. Le
 *     bouton « Ouvrir la fenêtre » du menu et le lien des annonces l'ouvrent
 *     directement, sans passer par la bibliothèque. Les effets cachés n'apparaissent
 *     que dans la partie MJ du handout.
 *   - Aucun marqueur d'état sur les tokens : les joueurs s'en servent pour autre chose.
 *   - Une annonce dans le chat au dernier round d'un effet, puis quand il se termine.
 *
 * CE QUE FONT LES JOUEURS
 *   Cliquer sur « Buffs » : menu chuchoté, une ligne par lancement avec ses cibles et
 *   des boutons (-1, +1, Durée, Effet, Cibles, X). « Ajouter » et « Sorts courants »
 *   demandent le lanceur (ton personnage par défaut) puis les cibles :
 *     Tout le groupe   les PJ présents sur ta carte (sans carte ou sans PJ dessus :
 *                      tous les PJ de la partie)
 *     Moi seul         le lanceur
 *     Tokens sélectionnés
 *     Choisir...       boutons à cocher, un par PJ, puis « Valider »
 *   Un joueur ne peut sélectionner que ses propres tokens dans Roll20 : pour un allié,
 *   passer par « Tout le groupe » ou « Choisir... ».
 *
 * DÉCOMPTE
 *   Tout est compté en rounds : 1 min = 10 rounds, 1 h = 600 rounds.
 *   - En combat : quand le tracker d'initiative passe au tour suivant, les effets
 *     dont le lanceur prend la main perdent 1 round (règle PF1 : un effet se termine
 *     juste avant le tour de son lanceur). Si le lanceur n'est pas dans le tracker, ou
 *     s'il n'y a pas de lanceur, l'effet perd 1 round au début de chaque round.
 *     Début de round : une entrée personnalisée du tracker dont le texte contient le
 *     mot « round » ou « tour » arrive en tête ; sans elle, l'initiative remonte
 *     (tracker trié par ordre décroissant). Remplir, trier le tracker ou y déplacer
 *     quelqu'un ne décompte rien. Revenir en arrière ne rend pas le round, mais
 *     repasser ensuite au même tour ne le décompte pas une seconde fois.
 *   - Hors combat : le MJ avance le temps avec !buff time 10min.
 *   Un effet qui tombe à 0 est retiré et annoncé.
 *
 * COMMANDES (options en anglais)
 *   !buff                         menu (lancements des tokens sélectionnés, sinon les tiens)
 *   !buff add --name Bénédiction --dur 5min [--caster Solathia] [--targets group]
 *             [--effect +1 attaque] [--hidden]
 *       --targets : group, me, selected, pick, ou des noms ou ids de tokens séparés
 *       par des virgules (Selea, Paz). Sans --targets : les tokens sélectionnés, sinon
 *       les boutons à cocher. Durées : 3r, 3 (rounds), 10min, 2h, 1j, perm (jusqu'à ce
 *       qu'on le retire). Relancer un effet du même nom remplace l'ancien sur les
 *       cibles du nouveau lancement (pas de cumul).
 *   !buff add --spell bless --cl 5 [--caster Solathia] [--targets group]   sort courant
 *   !buff fav                     boutons des sorts courants
 *   !buff edit 3 --dur -1         -1 round (ou +2, 4r, 10min, perm) ; aussi --name,
 *                                 --effect, --caster, --targets (comme add),
 *                                 --hidden yes|no (MJ)
 *   !buff pick toggle|all|none|ok|cancel   boutons à cocher (envoyés par le script)
 *   !buff choose 2|free|cancel    choix d'un nom partiel (envoyé par le script)
 *   !buff remove 3 [4 ...]        retire des lancements : essai à blanc, puis ... confirm N
 *   !buff clear                   retire les tokens sélectionnés de tous leurs effets
 *                                 (essai à blanc, puis confirm N)
 *   !buff clear all               MJ : tous les effets (essai à blanc, puis confirm N)
 *   !buff time 10min                MJ : fait passer le temps (essai à blanc, puis confirm N)
 *   !buff show                    met à jour le handout et donne le lien pour l'ouvrir
 *   !buff help
 *   Les modifications d'un seul lancement (edit) s'appliquent tout de suite : elles se
 *   défont d'un clic. Suppressions et passage du temps passent par un essai à blanc.
 *
 * DROITS
 *   Tout le monde peut lancer un effet sur n'importe qui. Un joueur modifie ou retire
 *   les lancements qu'il a créés et ceux dont il contrôle le lanceur. D'un lancement qui
 *   ne fait que viser un de ses personnages, il ne peut que retirer ses personnages
 *   (bouton « Me retirer », ou !buff clear sur son token). Le MJ gère tout, et lui seul
 *   crée des effets cachés (--hidden).
 *
 * CIBLES
 *   Un token lié à une fiche (une barre liée à un attribut, comme les PJ) : l'effet
 *   suit le PERSONNAGE, sur toutes les cartes. Un token non lié (monstres en série) :
 *   l'effet suit ce token seulement ; si le token est supprimé, il quitte l'effet.
 *   Un nom (cible ou lanceur) doit être exact (casse et accents ignorés) : token de la
 *   carte, sinon fiche de la partie. S'il n'est qu'une partie d'autres noms (« Moi »
 *   pour « Moine noir »), le script demande lequel avec des boutons, dont « Nom libre ».
 *   Sinon c'est un nom libre (un PNJ joué sans carte ni fiche), suivi par son nom.
 *   « =Moi » force le nom libre sans question.
 *   « PJ » = personnage contrôlé par au moins un joueur.
 *
 * Données : state.BuffTracker. Ne touche pas aux fiches de personnage.
 */
(() => {
  'use strict';

  const NOM = 'Buffs';
  const ETAT = 'BuffTracker';
  const HANDOUT = 'Effets actifs';
  const CMD = '!buff';

  // ======================================================= LOGIQUE PURE (testable)

  // ---- durées (toujours en rounds)
  const UNITE = { r: 1, m: 10, h: 600, d: 14400 };
  const ALIAS_UNITE = {
    r: 'r', rd: 'r', rds: 'r', round: 'r', rounds: 'r', tour: 'r', tours: 'r',
    m: 'm', mn: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm',
    h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h', heure: 'h', heures: 'h',
    d: 'd', day: 'd', days: 'd', j: 'd', jour: 'd', jours: 'd'
  };
  const PERMANENT = ['perm', 'permanent', 'inf', 'infinite', 'none', '-'];

  // "3r" -> {rounds:3, sign:0} ; "-1" -> {rounds:1, sign:-1} ; "perm" -> {rounds:null} ;
  // invalide -> null
  const parseDuration = (txt) => {
    if (txt === undefined || txt === null || txt === true) return null;
    const t = String(txt).trim().toLowerCase();
    if (!t) return null;
    if (PERMANENT.includes(t)) return { rounds: null, sign: 0 };
    const m = t.match(/^([+-])?\s*(\d+(?:[.,]\d+)?)\s*([a-z]*)$/);
    if (!m) return null;
    const u = m[3] ? ALIAS_UNITE[m[3]] : 'r';
    if (!u) return null;
    const rounds = Math.round(parseFloat(m[2].replace(',', '.')) * UNITE[u]);
    return { rounds, sign: m[1] === '-' ? -1 : (m[1] === '+' ? 1 : 0) };
  };

  // 4 -> "4 rd" ; 95 -> "9 min 5 rd" ; 630 -> "1 h 3 min" ; null -> "permanent"
  const formatDuration = (r) => {
    if (r === null || r === undefined) return 'permanent';
    if (r < 10) return `${r} rd`;
    if (r < 600) {
      const min = Math.floor(r / 10), rd = r % 10;
      return rd ? `${min} min ${rd} rd` : `${min} min`;
    }
    if (r < 14400) {
      const h = Math.floor(r / 600), min = Math.floor((r % 600) / 10);
      return min ? `${h} h ${min} min` : `${h} h`;
    }
    const j = Math.floor(r / 14400), h = Math.floor((r % 14400) / 600);
    return h ? `${j} j ${h} h` : `${j} j`;
  };

  // forme courte, relisible par parseDuration (valeur par défaut des boutons)
  const compactDuration = (r) => {
    if (r === null || r === undefined) return 'perm';
    if (r && r % 14400 === 0) return `${r / 14400}j`;
    if (r && r % 600 === 0) return `${r / 600}h`;
    if (r && r % 10 === 0) return `${r / 10}min`;
    return `${r}r`;
  };

  const normalize = (s) => String(s === undefined || s === null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  // HTML sûr pour le chat et les handouts ; [ ] { } échappés pour que Roll20 n'y
  // voie ni jet en ligne ni requête
  const escapeHtml = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/\[/g, '&#91;').replace(/\]/g, '&#93;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
    .replace(/\r?\n/g, ' ');

  // valeur par défaut d'une requête ?{...|défaut} : sans les caractères qui la
  // casseraient (le navigateur décode les entités HTML de href avant Roll20)
  const pourRequete = (s) => String(s || '').replace(/[{}|[\]"<>@&,]/g, ' ').replace(/\s+/g, ' ').trim();

  // ---- commande
  // "!buff edit 3 --dur -1 confirm 2" -> {sub:'edit', args:['3'], opts:{dur:'-1'}, confirm:2}
  const parseCommand = (content) => {
    let s = String(content || '').trim();
    if (!/^!buff(\s|$)/i.test(s)) return null;
    s = s.replace(/^!buff/i, '').trim();
    let confirm = null;
    const cm = s.match(/(?:^|\s)confirm\s+(\d+)\s*$/i);
    if (cm) { confirm = parseInt(cm[1], 10); s = s.slice(0, cm.index).trim(); }
    const parts = (' ' + s).split(/\s--(?=\S)/);
    const head = parts.shift().trim();
    const words = head ? head.split(/\s+/) : [];
    const opts = {};
    parts.forEach((p) => {
      const m = p.match(/^(\S+)(?:\s+([\s\S]*))?$/);
      if (!m) return;
      opts[m[1].toLowerCase()] = m[2] === undefined ? true : m[2].trim();
    });
    if (opts.target !== undefined && opts.targets === undefined) opts.targets = opts.target;
    delete opts.target;
    return { sub: (words.shift() || 'menu').toLowerCase(), args: words, opts, confirm };
  };

  // valeur texte d'une option ; une requête laissée vide en fin de commande arrive
  // comme une option sans valeur (true) : c'est une chaîne vide
  const texte = (v) => (v === true ? '' : (typeof v === 'string' ? v.trim() : undefined));

  // "yes"/"no" pour --hidden ; true (option sans valeur) = oui
  const parseBool = (v) => {
    if (v === true) return true;
    const t = normalize(v);
    if (['yes', 'y', 'on', 'true', '1', ''].includes(t)) return true;
    if (['no', 'n', 'off', 'false', '0'].includes(t)) return false;
    return null;
  };

  // --targets : un des mots réservés, ou une liste de noms / ids
  const TARGET_MODES = ['group', 'me', 'selected', 'pick'];
  const parseTargets = (v) => {
    const t = texte(v);
    if (t === undefined || t === '') return { mode: 'default' };
    if (TARGET_MODES.includes(normalize(t))) return { mode: normalize(t) };
    const names = t.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    return names.length ? { mode: 'names', names } : { mode: 'default' };
  };

  // ---- entités : {kind:'char'|'token', id}
  // clé « char.-Mabc » : pas de « : », Roll20 retire des boutons du chat les liens
  // qui ressemblent à une adresse (char:...) et le bouton ne réagit plus
  const entityKey = (e) => `${e.kind}.${e.id}`;
  const lireCle = (k) => String(k || '').replace(/^(char|token|name):/, '$1.');
  const sameEntity = (a, b) => !!(a && b && a.kind === b.kind && a.id === b.id);

  // ---- décompte
  // Retire n rounds aux effets choisis. Renvoie ceux qui expirent (0) et ceux qui
  // passent à leur dernier round (1). Les effets permanents ne bougent pas.
  const tick = (buffs, pred, n) => {
    const expired = [], warned = [];
    buffs.forEach((b) => {
      if (b.remaining === null || b.remaining === undefined) return;
      if (!pred(b)) return;
      const old = b.remaining;
      b.remaining = Math.max(0, old - n);
      if (b.remaining === 0) expired.push(b);
      else if (old > 1 && b.remaining === 1) warned.push(b);
    });
    return { expired, warned };
  };

  // Le tracker a-t-il avancé d'un tour (premier passé à la fin), reculé, ou autre chose ?
  const cleEntree = (e) => String(e && e.id) + '|' + String((e && e.custom) || '');
  const memesCles = (a, b) => a.length === b.length && a.every((e, i) => cleEntree(e) === cleEntree(b[i]));
  const detectAdvance = (prev, next) => {
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length < 2 || prev.length !== next.length) return 'other';
    if (memesCles(prev.slice(1).concat([prev[0]]), next)) return 'forward';
    if (memesCles([prev[prev.length - 1]].concat(prev.slice(0, -1)), next)) return 'backward';
    return 'other';
  };

  // Entrée personnalisée qui marque le début du round : son texte contient le mot
  // « round » ou « tour » (« Round », « Tour 3 », « -- Début du round -- »...)
  const estPerso = (e) => String(e && e.id) === '-1';
  const isRoundEntry = (e) => estPerso(e) && /(^|[^a-z])(round|tour)s?([^a-z]|$)/.test(normalize(e.custom));
  // Début d'un nouveau round (à n'appeler qu'après une avance) : l'entrée de round
  // arrive en tête, ou, sans elle, l'initiative remonte (ordre décroissant : on est
  // revenu au plus haut). Les autres entrées personnalisées (torche...) sont ignorées.
  const isNewRound = (prev, next) => {
    if (!next || !next.length) return false;
    const idx = next.findIndex(isRoundEntry);
    if (idx >= 0) return idx === 0;
    if (estPerso(next[0])) return false;
    let j = next.length - 1; // le token qui vient de jouer
    while (j > 0 && estPerso(next[j])) j--;
    if (j <= 0) return false;
    const a = parseFloat(next[j].pr), b = parseFloat(next[0].pr);
    return !isNaN(a) && !isNaN(b) && b > a;
  };

  // ---- marqueurs d'état : le script n'en pose plus (les joueurs s'en servent pour
  // autre chose). Retire d'une chaîne statusmarkers ceux qu'une ancienne version a
  // posés (owned) ; les autres marqueurs du token ne bougent pas.
  const stripMarkers = (current, owned) => {
    const mine = new Set(owned || []);
    return String(current || '').split(',').filter((m) => m && !mine.has(m.split('@')[0])).join(',');
  };

  // ---- recherche par nom (accents et casse ignorés) : égalité, puis début, puis contenu
  const resolveByName = (query, candidates) => {
    const q = normalize(query);
    if (!q) return [];
    for (const test of [(n) => n === q, (n) => n.startsWith(q), (n) => n.includes(q)]) {
      const found = candidates.filter((c) => test(normalize(c.name)));
      if (found.length) return found;
    }
    return [];
  };

  // ---- relance : le nouveau lancement remplace l'ancien sur ses cibles (pas de cumul).
  // Retire ces cibles des lancements du même nom (et de même visibilité) ; renvoie les
  // cibles relancées et la liste sans les lancements devenus vides.
  const replaceTargets = (buffs, name, hidden, targets) => {
    const keys = new Set(targets.map(entityKey));
    const relaunched = [];
    buffs.forEach((b) => {
      if (normalize(b.name) !== normalize(name) || !!b.hidden !== !!hidden) return;
      b.targets = b.targets.filter((t) => {
        if (!keys.has(entityKey(t))) return true;
        if (!relaunched.some((r) => sameEntity(r, t))) relaunched.push(t);
        return false;
      });
    });
    return { buffs: buffs.filter((b) => b.targets.length), relaunched };
  };

  // ---- sorts courants : durée = niveau de lanceur x unité (ou durée fixe)
  const FAVORITES = [
    { key: 'bless', name: 'Bénédiction', per: 'm', mult: 1, effect: '+1 moral attaque et JS contre la terreur' },
    { key: 'prayer', name: 'Prière', per: 'r', mult: 1, effect: '+1 chance alliés, -1 ennemis (attaque, dégâts, JS, compétences)' },
    { key: 'divinefavor', name: 'Faveur divine', fixed: 10, effect: '+1 chance attaque et dégâts par 3 niveaux (max +3)' },
    { key: 'shieldoffaith', name: 'Bouclier de la foi', per: 'm', mult: 1, effect: '+2 parade CA (+1 par 6 niveaux, max +5)' },
    { key: 'protectionfromevil', name: 'Protection contre le Mal', per: 'm', mult: 1, effect: '+2 parade CA et +2 résistance JS contre le Mal' },
    { key: 'shield', name: 'Bouclier', per: 'm', mult: 1, effect: '+4 bouclier CA, immunité aux projectiles magiques' },
    { key: 'magearmor', name: 'Armure de mage', per: 'h', mult: 1, effect: '+4 armure CA' },
    { key: 'haste', name: 'Rapidité', per: 'r', mult: 1, effect: '+1 attaque, +1 esquive CA et Réflexes, +9 m, 1 attaque en plus' },
    { key: 'enlarge', name: 'Agrandissement', per: 'm', mult: 1, effect: 'taille +1 : +2 For, -2 Dex, -1 attaque et CA' },
    { key: 'bullsstrength', name: 'Force de taureau', per: 'm', mult: 1, effect: '+4 altération For' },
    { key: 'catsgrace', name: 'Grâce féline', per: 'm', mult: 1, effect: '+4 altération Dex' },
    { key: 'bearsendurance', name: "Endurance de l'ours", per: 'm', mult: 1, effect: '+4 altération Con' },
    { key: 'blur', name: 'Flou', per: 'm', mult: 1, effect: '20 % de camouflage' },
    { key: 'mirrorimage', name: 'Image miroir', per: 'm', mult: 1, effect: '1d4 images +1 par 3 niveaux (max 8)' },
    { key: 'invisibility', name: 'Invisibilité', per: 'm', mult: 1, effect: "invisible jusqu'à une attaque" },
    { key: 'fly', name: 'Vol', per: 'm', mult: 1, effect: 'vol 18 m (bonne manœuvrabilité)' },
    { key: 'heroism', name: 'Héroïsme', per: 'm', mult: 10, effect: '+2 moral attaque, JS et compétences' },
    { key: 'resistenergy', name: 'Résistance aux énergies', per: 'm', mult: 10, effect: 'résistance 10 (20 au niv 7, 30 au niv 11)' },
    { key: 'darkvision', name: 'Vision dans le noir', per: 'h', mult: 1, effect: 'vision dans le noir 18 m' }
  ];
  const findFavorite = (q) => {
    const n = normalize(q).replace(/[^a-z0-9]/g, '');
    if (!n) return null;
    return FAVORITES.find((f) => f.key === n) ||
      FAVORITES.find((f) => normalize(f.name).replace(/[^a-z0-9]/g, '') === n) || null;
  };
  const spellDuration = (fav, cl) => (fav.fixed ? fav.fixed : UNITE[fav.per] * (fav.mult || 1) * cl);

  const val = (r) => (r === null || r === undefined ? Infinity : r);
  const parDuree = (a, b) => val(a.remaining) - val(b.remaining) || normalize(a.name).localeCompare(normalize(b.name));

  // ---- vue par personnage (fenêtre) : une ligne par effet et par cible
  // nameOf(entité) -> nom ; casterNameOf(buff) -> nom
  const buildView = (buffs, nameOf, casterNameOf, includeHidden) => {
    const groups = new Map();
    buffs.forEach((b) => {
      if (b.hidden && !includeHidden) return;
      b.targets.forEach((t) => {
        const key = entityKey(t);
        if (!groups.has(key)) groups.set(key, { target: nameOf(t) || t.name || '?', rows: [] });
        groups.get(key).rows.push({
          id: b.id, name: b.name, remaining: b.remaining, effect: b.effect || '', hidden: !!b.hidden,
          caster: casterNameOf(b) || ''
        });
      });
    });
    const out = [...groups.values()];
    out.forEach((g) => g.rows.sort(parDuree));
    out.sort((a, b) => normalize(a.target).localeCompare(normalize(b.target)));
    return out;
  };

  // ---- vue par lancement (menu) : une ligne par effet avec la liste de ses cibles
  // editable(b) : boutons complets ; selfOnly(b) : seulement « Me retirer » (un joueur
  // ciblé par le lancement d'un autre)
  const buildCastView = (buffs, nameOf, casterNameOf, editable, includeHidden, selfOnly = () => false) => buffs
    .filter((b) => includeHidden || !b.hidden)
    .map((b) => {
      const ed = !!editable(b);
      return {
        id: b.id, name: b.name, remaining: b.remaining, effect: b.effect || '', hidden: !!b.hidden,
        caster: casterNameOf(b) || '', targets: b.targets.map((t) => nameOf(t) || t.name || '?'),
        editable: ed, selfOnly: !ed && !!selfOnly(b)
      };
    })
    .sort(parDuree);

  const couleurDuree = (r) => {
    if (r === null || r === undefined) return '#555555';
    if (r <= 1) return '#c62828';
    if (r <= 3) return '#e65100';
    return '#2e7d32';
  };

  // ---- handout (fenêtre « Effets actifs »)
  const renderHandout = (view, opts = {}) => {
    const n = view.reduce((s, g) => s + g.rows.length, 0);
    let h = `<h3>${escapeHtml(opts.title || HANDOUT)}</h3>`;
    if (!n) return h + `<p><i>${escapeHtml(opts.empty || 'Aucun effet actif.')}</i></p>`;
    h += '<p style="color:#666666"><i>Mise à jour par le script, ne pas modifier à la main.</i></p>';
    view.forEach((g) => {
      h += `<h4 style="margin:8px 0 2px 0">${escapeHtml(g.target)}</h4>`;
      h += '<table style="width:100%;border-collapse:collapse">';
      g.rows.forEach((r) => {
        h += '<tr style="border-top:1px solid #dddddd">' +
          `<td style="padding:2px 4px"><b>${escapeHtml(r.name)}</b>${r.hidden ? ' <i style="color:#888888">(caché)</i>' : ''}` +
          (r.effect ? `<br><span style="color:#666666;font-size:0.9em">${escapeHtml(r.effect)}</span>` : '') + '</td>' +
          `<td style="padding:2px 4px;text-align:right;white-space:nowrap;color:${couleurDuree(r.remaining)}"><b>${escapeHtml(formatDuration(r.remaining))}</b></td>` +
          `<td style="padding:2px 4px;color:#666666;white-space:nowrap">${escapeHtml(r.caster)}</td>` +
          '</tr>';
      });
      h += '</table>';
    });
    return h;
  };

  // ---- chat (une seule ligne : pas de retour à la ligne dans sendChat)
  const STYLE_BOITE = 'border:1px solid #888888;border-radius:4px;padding:4px 6px;background:#ffffff;color:#222222';
  const STYLE_BTN = 'display:inline-block;background:#4a4a4a;color:#ffffff;border:none;border-radius:3px;padding:0 5px;margin:1px;font-size:11px;text-decoration:none';
  const STYLE_BTN_ON = 'display:inline-block;background:#2e7d32;color:#ffffff;border:none;border-radius:3px;padding:0 5px;margin:1px;font-size:11px;text-decoration:none';
  const STYLE_BTN_OFF = 'display:inline-block;background:#e0e0e0;color:#222222;border:1px solid #9e9e9e;border-radius:3px;padding:0 5px;margin:1px;font-size:11px;text-decoration:none';
  const bouton = (label, href, style) => `<a style="${style || STYLE_BTN}" href="${href}">${escapeHtml(label)}</a>`;
  const handoutUrl = (id) => `http://journal.roll20.net/handout/${id}`;
  const lienFenetre = (id, label) => bouton(label || 'Ouvrir la fenêtre', handoutUrl(id));

  const Q_DUREE = 'Durée : 3r 10min 2h 1j ou perm';
  const Q_LANCEUR = 'Lanceur';
  const Q_CIBLES = '?{Cibles|Tout le groupe,group|Moi seul,me|Tokens sélectionnés,selected|Choisir...,pick}';
  const boutonsLancement = (r) => [
    bouton('-1', `${CMD} edit ${r.id} --dur -1`),
    bouton('+1', `${CMD} edit ${r.id} --dur +1`),
    bouton('Durée', `${CMD} edit ${r.id} --dur ?{${Q_DUREE}|${compactDuration(r.remaining)}}`),
    bouton('Effet', `${CMD} edit ${r.id} --effect ?{Effet|${escapeHtml(pourRequete(r.effect))}}`),
    bouton('Cibles', `${CMD} edit ${r.id} --targets pick`),
    bouton('X', `${CMD} remove ${r.id}`)
  ].join('');
  const renderMenu = (rows, opts = {}) => {
    let h = `<div style="${STYLE_BOITE}"><div style="font-weight:bold;margin-bottom:2px">${escapeHtml(opts.title || 'Effets actifs')}</div>`;
    if (!rows.length) h += `<div style="color:#666666"><i>${escapeHtml(opts.empty || 'Aucun effet.')}</i></div>`;
    rows.forEach((r) => {
      h += '<div style="padding:3px 0;border-top:1px solid #dddddd">' +
        `<b>${escapeHtml(r.name)}</b>${r.hidden ? ' <i>(caché)</i>' : ''} ` +
        `<span style="color:${couleurDuree(r.remaining)};font-weight:bold">${escapeHtml(formatDuration(r.remaining))}</span>` +
        (r.caster ? ` <span style="color:#666666">par ${escapeHtml(r.caster)}</span>` : '') +
        ` <span style="color:#888888;font-size:10px">#${escapeHtml(r.id)}</span>` +
        `<br><span style="font-size:11px">→ ${escapeHtml(r.targets.join(', '))}</span>` +
        (r.effect ? `<br><span style="color:#666666;font-size:11px">${escapeHtml(r.effect)}</span>` : '') +
        (r.editable ? `<br>${boutonsLancement(r)}` : (r.selfOnly ? `<br>${bouton('Me retirer', `${CMD} remove ${r.id}`)}` : '')) +
        '</div>';
    });
    if (opts.footer) h += `<div style="margin-top:2px;border-top:1px solid #cccccc;padding-top:2px">${opts.footer}</div>`;
    return h + '</div>';
  };

  // boutons à cocher : candidates = [{key, name, on}]
  const renderPicker = (title, candidates) => {
    const n = candidates.filter((c) => c.on).length;
    return `<div style="${STYLE_BOITE}"><div style="font-weight:bold">${escapeHtml(title)}</div>` +
      '<div style="margin-top:2px">Cibles :</div><div>' +
      (candidates.length
        ? candidates.map((c) => bouton((c.on ? '✔ ' : '') + c.name, `${CMD} pick toggle ${c.key}`, c.on ? STYLE_BTN_ON : STYLE_BTN_OFF)).join('')
        : '<i style="color:#666666">Aucun PJ sur la carte.</i>') +
      '</div><div style="margin-top:2px">' +
      bouton('Tout le groupe', `${CMD} pick all`) + bouton('Aucun', `${CMD} pick none`) +
      '</div><div style="margin-top:2px">' +
      bouton(`Valider (${n})`, `${CMD} pick ok`) + bouton('Annuler', `${CMD} pick cancel`) +
      '</div></div>';
  };

  // choix d'un nom : un bouton par possibilité, le nom libre, Annuler
  const renderChoix = (nom, role, labels) => `<div style="${STYLE_BOITE}">` +
    `<div style="font-weight:bold">« ${escapeHtml(nom)} » (${escapeHtml(role)}) : lequel ?</div><div>` +
    labels.map((l, i) => bouton(labels.indexOf(l) !== i || labels.lastIndexOf(l) !== i ? `${l} (${i + 1})` : l, `${CMD} choose ${i + 1}`)).join('') +
    '</div><div style="margin-top:2px">' +
    bouton(`Nom libre « ${nom} »`, `${CMD} choose free`) + bouton('Annuler', `${CMD} choose cancel`) +
    '</div></div>';

  const boutonAjouter = (lanceur) => bouton('Ajouter',
    `${CMD} add --name ?{Nom} --dur ?{${Q_DUREE}|1min} --caster ?{${Q_LANCEUR}|${escapeHtml(pourRequete(lanceur))}} --targets ${Q_CIBLES} --effect ?{Effet|}`);
  const boutonFavori = (f, lanceur) => bouton(f.name,
    `${CMD} add --spell ${f.key} --cl ?{Niveau de lanceur|1} --caster ?{${Q_LANCEUR}|${escapeHtml(pourRequete(lanceur))}} --targets ${Q_CIBLES}`);

  const exportsPurs = {
    parseDuration, formatDuration, compactDuration, normalize, escapeHtml, pourRequete, parseCommand, parseBool,
    texte, parseTargets, entityKey, tick, detectAdvance, isRoundEntry, isNewRound, stripMarkers,
    resolveByName, replaceTargets, FAVORITES, findFavorite, spellDuration, buildView,
    buildCastView, renderHandout, renderMenu, renderPicker, renderChoix
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsPurs;
  if (typeof on !== 'function') return; // hors Roll20 : on s'arrête ici

  // ============================================================== PARTIE ROLL20

  const etat = () => {
    const s = state[ETAT] = state[ETAT] || {};
    s.nextId = s.nextId || 1;
    s.buffs = s.buffs || [];
    s.drafts = s.drafts || {};   // id du joueur -> choix de cibles en cours
    if (s.version !== 2) {       // v1 : une cible par effet
      s.buffs.forEach((b) => {
        if (b.targets) return;
        b.targets = b.target ? [{ kind: b.target.kind, id: b.target.id, name: b.targetName || '' }] : [];
        delete b.target; delete b.targetName;
      });
      s.buffs = s.buffs.filter((b) => b.targets.length);
      s.version = 2;
    }
    return s;
  };

  // ---- entités : un personnage (token lié à sa fiche) ou un token seul
  const entiteDuToken = (tok) => {
    const cid = tok.get('represents');
    const lie = cid && (tok.get('bar1_link') || tok.get('bar2_link') || tok.get('bar3_link'));
    return lie ? { kind: 'char', id: cid } : { kind: 'token', id: tok.id };
  };
  const nomToken = (tok) => {
    if (!tok) return '';
    const n = tok.get('name');
    if (n) return n;
    const c = getObj('character', tok.get('represents'));
    return c ? c.get('name') : '';
  };
  // nom libre : un PNJ sans token ni fiche (scène jouée sans carte)
  // (id sans espace : il sert d'argument aux boutons à cocher)
  const entiteNom = (nom) => ({ kind: 'name', id: normalize(nom).replace(/[^a-z0-9]+/g, '-'), name: String(nom || '').trim() });
  const entiteDuPerso = (c) => ({ kind: 'char', id: c.id, name: c.get('name') });
  const nomEntite = (e) => {
    if (!e || !e.id || e.kind === 'name') return (e && e.name) || '';
    if (e.kind === 'char') { const c = getObj('character', e.id); return c ? c.get('name') : (e.name || ''); }
    return nomToken(getObj('graphic', e.id)) || e.name || '';
  };
  const tokensDe = (e) => {
    if (e.kind === 'name') return [];
    if (e.kind === 'token') { const t = getObj('graphic', e.id); return t ? [t] : []; }
    return findObjs({ _type: 'graphic', represents: e.id });
  };
  const tokenEst = (e, tok) => !!(e && e.id && e.kind !== 'name' && tok && (e.kind === 'token' ? tok.id === e.id : tok.get('represents') === e.id));
  const entitesUniques = (toks) => {
    const out = [];
    toks.forEach((t) => {
      const e = entiteDuToken(t);
      if (!out.some((o) => sameEntity(o, e))) out.push(Object.assign(e, { name: nomEntite(e) || nomToken(t) }));
    });
    return out;
  };
  const tokensPage = (pageid) => (pageid ? findObjs({ _type: 'graphic', _subtype: 'token', _pageid: pageid }) : []);

  // ---- joueurs et droits
  const liste = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const controleurs = (e) => {
    if (!e || !e.id || e.kind === 'name') return [];
    if (e.kind === 'char') { const c = getObj('character', e.id); return c ? liste(c.get('controlledby')) : []; }
    const t = getObj('graphic', e.id);
    if (!t) return [];
    const c = getObj('character', t.get('represents'));
    return liste(t.get('controlledby')).concat(c ? liste(c.get('controlledby')) : []);
  };
  const controle = (pid, e) => {
    if (playerIsGM(pid)) return true;
    const l = controleurs(e);
    return l.includes('all') || l.includes(pid);
  };
  // gérer un lancement (durée, cibles, retrait pour tous) : le MJ, son créateur, ou qui
  // contrôle son lanceur. Un joueur seulement ciblé peut juste en retirer ses personnages.
  const peutGerer = (pid, b) => playerIsGM(pid) ||
    (!b.hidden && (b.owner === pid || (!!b.caster && controle(pid, b.caster))));
  const mesCibles = (pid, b) => (b.hidden ? [] : b.targets.filter((t) => controle(pid, t)));

  // PJ = personnage contrôlé par au moins un joueur, présent sur la carte
  const pjsDeLaPage = (pageid) => entitesUniques(tokensPage(pageid).filter((t) => {
    const c = getObj('character', t.get('represents'));
    return !!c && liste(c.get('controlledby')).length > 0;
  })).sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  const fiches = () => findObjs({ _type: 'character' }).filter((c) => !c.get('archived'));
  const pjsDeLaPartie = () => fiches().filter((c) => liste(c.get('controlledby')).length > 0).map(entiteDuPerso)
    .sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
  // PJ de la carte, sinon (scène sans carte, ou PJ absents) tous les PJ de la partie
  const pjsDuGroupe = (pageid) => { const l = pjsDeLaPage(pageid); return l.length ? l : pjsDeLaPartie(); };
  // personnages de ce joueur (contrôlés nommément, pas par « all ») : sur la carte, sinon dans la partie
  const persosDuJoueur = (pid, pageid) => {
    const siens = (e) => controleurs(e).includes(pid);
    const l = pjsDeLaPage(pageid).filter(siens);
    return l.length ? l : pjsDeLaPartie().filter(siens);
  };

  // nom -> entité, sans deviner. Clé (char.<id>, token.<id>) ou id de token ; « =Nom »
  // force un nom libre ; nom exact (casse et accents ignorés) d'un token de la carte,
  // sinon d'une fiche. Un nom qui n'est qu'une partie de noms existants (« Moi » pour
  // « Moine noir ») renvoie {choices} : le joueur choisit, ou garde le nom libre.
  // Renvoie {entity} ou {choices: [entités]}.
  const MAX_CHOIX = 6;
  const trouverEntite = (nom, pageid) => {
    const brut = String(nom || '').trim();
    if (brut.startsWith('=')) return { entity: entiteNom(brut.slice(1)) };
    const direct = getObj('graphic', brut);
    if (direct) return { entity: entitesUniques([direct])[0] };
    const cle = lireCle(brut).match(/^(char|token)\.(\S+)$/);
    if (cle && getObj(cle[1] === 'char' ? 'character' : 'graphic', cle[2])) {
      const e = { kind: cle[1], id: cle[2] };
      return { entity: Object.assign(e, { name: nomEntite(e) }) };
    }
    const q = normalize(brut);
    const toks = tokensPage(pageid).map((t) => ({ tok: t, name: nomToken(t) })).filter((c) => c.name);
    const exactCarte = entitesUniques(toks.filter((c) => normalize(c.name) === q).map((c) => c.tok));
    if (exactCarte.length === 1) return { entity: exactCarte[0] };
    if (exactCarte.length > 1) return { choices: exactCarte.slice(0, MAX_CHOIX) };
    const toutes = fiches();
    const exactes = toutes.filter((c) => normalize(c.get('name')) === q).map(entiteDuPerso);
    if (exactes.length === 1) return { entity: exactes[0] };
    if (exactes.length > 1) return { choices: exactes.slice(0, MAX_CHOIX) };
    // proches : tokens de la carte qui contiennent le nom, fiches dont un mot commence par lui
    const proches = entitesUniques(toks.filter((c) => normalize(c.name).includes(q)).map((c) => c.tok));
    toutes.forEach((c) => {
      const n = normalize(c.get('name'));
      if (!(n.startsWith(q) || n.includes(' ' + q))) return;
      const e = entiteDuPerso(c);
      if (!proches.some((o) => sameEntity(o, e))) proches.push(e);
    });
    return proches.length ? { choices: proches.slice(0, MAX_CHOIX) } : { entity: entiteNom(brut) };
  };

  const selection = (msg) => (msg.selected || []).map((x) => getObj('graphic', x._id)).filter(Boolean);
  // carte du joueur : celle des tokens sélectionnés, sinon celle où il se trouve
  // (pour le MJ, la dernière carte qu'il a ouverte, pas forcément celle des joueurs)
  const pageDu = (msg) => {
    const sel = selection(msg);
    if (sel.length) return sel[0].get('_pageid');
    const c = Campaign();
    if (playerIsGM(msg.playerid)) {
      const pl = getObj('player', msg.playerid);
      const last = pl && pl.get('_lastpage');
      if (last && getObj('page', last)) return last;
    } else {
      const psp = c.get('playerspecificpages');
      if (psp && psp[msg.playerid]) return psp[msg.playerid];
    }
    return c.get('playerpageid');
  };

  const nomLanceur = (b) => (b.caster ? nomEntite(b.caster) : '');
  const nomsCibles = (b) => b.targets.map((t) => nomEntite(t) || '?').join(', ');
  const libelle = (b) => `${b.name} (${nomsCibles(b)})`;

  // ---- chat
  const nomJoueur = (pid) => { const p = getObj('player', pid); return p ? String(p.get('_displayname') || '') : ''; };
  const dire = (pid, html) => {
    if (playerIsGM(pid)) return sendChat(NOM, `/w gm ${html}`);
    const n = nomJoueur(pid).replace(/"/g, '');
    return sendChat(NOM, n ? `/w "${n}" ${html}` : `/w gm ${html}`);
  };
  const boite = (html) => `<div style="${STYLE_BOITE}">${html}</div>`;
  const erreur = (pid, txt) => dire(pid, boite(`<span style="color:#c62828">${escapeHtml(txt)}</span>`));

  // ---- handout, annonces
  let dernierHandout = { id: null, notes: null, gmnotes: null };
  const handout = () => {
    const s = etat();
    let h = s.handoutId && getObj('handout', s.handoutId);
    if (!h) h = findObjs({ _type: 'handout', name: HANDOUT })[0];
    if (!h) h = createObj('handout', { name: HANDOUT, inplayerjournals: 'all', archived: false });
    if (h.id !== dernierHandout.id) dernierHandout = { id: h.id, notes: null, gmnotes: null };
    s.handoutId = h.id;
    return h;
  };
  const annoncer = (buffs, texteAnnonce) => {
    const pub = buffs.filter((b) => !b.hidden), mj = buffs.filter((b) => b.hidden);
    const ligne = (l, lien) => boite(`${escapeHtml(texteAnnonce)} : ${l.map((b) => `<b>${escapeHtml(b.name)}</b> (${escapeHtml(nomsCibles(b))})`).join(', ')}` +
      (lien ? ` ${lienFenetre(handout().id, 'Voir les effets')}` : ''));
    if (pub.length) sendChat(NOM, ligne(pub, true));
    if (mj.length) sendChat(NOM, `/w gm ${ligne(mj, false)}`);
  };
  const majHandout = () => {
    const s = etat();
    const h = handout();
    const notes = renderHandout(buildView(s.buffs, nomEntite, nomLanceur, false));
    const gmnotes = renderHandout(buildView(s.buffs.filter((b) => b.hidden), nomEntite, nomLanceur, true),
      { title: 'Effets cachés (MJ)', empty: 'Aucun effet caché.' });
    if (notes !== dernierHandout.notes) h.set({ notes });
    if (gmnotes !== dernierHandout.gmnotes) h.set({ gmnotes });
    dernierHandout.notes = notes;
    dernierHandout.gmnotes = gmnotes;
  };
  // marqueurs posés par une version précédente : retirés une fois au démarrage
  const nettoyerMarqueurs = () => {
    const s = etat();
    if (!s.markers) return;
    Object.keys(s.markers).forEach((id) => {
      const t = getObj('graphic', id);
      if (!t) return;
      const cur = t.get('statusmarkers') || '';
      const nv = stripMarkers(cur, s.markers[id]);
      if (nv !== cur) t.set({ statusmarkers: nv });
    });
    delete s.markers;
  };
  const rafraichir = () => majHandout();

  // retire les effets expirés, les annonce, et met tout à jour
  const traiter = (res, { avertir = true } = {}) => {
    const s = etat();
    if (avertir && res.warned.length) annoncer(res.warned, 'Dernier round');
    if (res.expired.length) {
      const fin = new Set(res.expired);
      s.buffs = s.buffs.filter((b) => !fin.has(b));
      annoncer(res.expired, 'Fin');
    }
    rafraichir();
  };

  const trouver = (id) => etat().buffs.find((b) => b.id === String(id || '').replace(/^#/, ''));

  // ---- lanceur donné par son nom : token de la carte, fiche, sinon nom libre (suivi
  // par son nom dans le tracker). Renvoie {caster} (null sans nom) ou {choices}.
  const trouverLanceur = (nom, pageid) => {
    const q = String(nom || '').trim();
    if (!q) return { caster: null };
    const r = trouverEntite(q, pageid);
    return r.choices ? r : { caster: copieEntite(r.entity) };
  };
  const lanceurParDefaut = (pid, pageid) => {
    const l = persosDuJoueur(pid, pageid);
    return l.length === 1 ? l[0].name : '';
  };

  // ---- cibles : renvoie {targets}, {pick: preselection}, {choose: {index, nom, choices}} ou {error}
  const resoudreCibles = (spec, msg, caster, pageid) => {
    const pid = msg.playerid;
    const sel = entitesUniques(selection(msg));
    switch (spec.mode) {
      case 'default': return sel.length ? { targets: sel } : { pick: [] };
      case 'pick': return { pick: sel };
      case 'selected': return sel.length ? { targets: sel } : { error: 'Aucun token sélectionné. Tu ne peux sélectionner que tes propres tokens : pour un allié, choisis « Tout le groupe » ou « Choisir... ».' };
      case 'group': {
        const l = pjsDuGroupe(pageid);
        return l.length ? { targets: l } : { error: 'Aucun PJ dans la partie.' };
      }
      case 'me': {
        if (caster) return { targets: [copieEntite(caster.kind ? caster : entiteNom(caster.name))] };
        const l = persosDuJoueur(pid, pageid);
        return l.length ? { targets: l } : { error: 'Moi seul : indique le lanceur (--caster).' };
      }
      default: {
        const out = [];
        for (let i = 0; i < spec.names.length; i++) {
          const r = trouverEntite(spec.names[i], pageid);
          if (r.choices) return { choose: { index: i, nom: spec.names[i], choices: r.choices } };
          if (!out.some((o) => sameEntity(o, r.entity))) out.push(r.entity);
        }
        return { targets: out };
      }
    }
  };
  const copieEntite = (e) => ({ kind: e.kind, id: e.id, name: e.name || nomEntite(e) });

  // ---- boutons à cocher
  const montrerChoix = (pid) => {
    const d = etat().drafts[pid];
    if (!d) return;
    const titre = d.editId
      ? `Cibles de ${d.name} (#${d.editId})`
      : `${d.name} · ${formatDuration(d.rounds)}${d.caster ? ' · par ' + (nomEntite(d.caster) || d.caster.name) : ''}`;
    const cands = d.candidates.map((c) => ({ key: entityKey(c), name: nomEntite(c) || c.name || '?', on: d.targets.some((t) => sameEntity(t, c)) }));
    dire(pid, renderPicker(titre, cands));
  };
  const ouvrirChoix = (pid, pageid, d, preselection) => {
    const cands = pjsDuGroupe(pageid);
    preselection.forEach((e) => { if (!cands.some((c) => sameEntity(c, e))) cands.push(e); });
    d.candidates = cands.map(copieEntite);
    d.targets = preselection.map(copieEntite);
    d.pageid = pageid;
    etat().drafts[pid] = d;
    montrerChoix(pid);
  };

  // ---- création d'un lancement (relance : remplace l'ancien sur ces cibles)
  const lancer = (pid, d) => {
    const s = etat();
    // même sort sous une autre graphie (casse, accents) : on garde celle déjà en jeu
    const existant = s.buffs.find((b) => normalize(b.name) === normalize(d.name));
    if (existant) d.name = existant.name;
    const res = replaceTargets(s.buffs, d.name, d.hidden, d.targets);
    s.buffs = res.buffs;
    const b = {
      id: String(s.nextId++), name: d.name, targets: d.targets.map(copieEntite), caster: d.caster || null,
      remaining: d.rounds, effect: d.effect || '', hidden: !!d.hidden, owner: pid
    };
    s.buffs.push(b);
    rafraichir();
    const relance = res.relaunched.length ? ` <i>(relancé pour ${escapeHtml(res.relaunched.map(nomEntite).join(', '))})</i>` : '';
    dire(pid, boite(`<b>${escapeHtml(b.name)}</b> (${escapeHtml(formatDuration(b.remaining))}) → ${escapeHtml(nomsCibles(b))}${relance} ` +
      lienFenetre(handout().id, 'Voir les effets')));
    return b;
  };

  // ---------------------------------------------------------------- commandes
  const cmdMenu = (msg) => {
    const pid = msg.playerid, gm = playerIsGM(pid), s = etat();
    const pageid = pageDu(msg);
    const sel = entitesUniques(selection(msg));
    let buffs, titre;
    if (sel.length) {
      buffs = s.buffs.filter((b) => b.targets.some((t) => sel.some((e) => sameEntity(e, t))) && (!b.hidden || gm));
      titre = 'Effets : ' + sel.map((e) => e.name || nomEntite(e)).join(', ');
    } else {
      buffs = s.buffs.filter((b) => peutGerer(pid, b) || mesCibles(pid, b).length);
      titre = gm ? 'Tous les effets' : 'Tes effets';
    }
    const rows = buildCastView(buffs, nomEntite, nomLanceur, (b) => peutGerer(pid, b), gm, (b) => mesCibles(pid, b).length > 0);
    const footer = [boutonAjouter(lanceurParDefaut(pid, pageid)), bouton('Sorts courants', `${CMD} fav`), lienFenetre(handout().id)].join('');
    dire(pid, renderMenu(rows, {
      title: titre,
      empty: sel.length ? 'Aucun effet sur la sélection.' : 'Aucun effet en cours.',
      footer
    }));
  };

  const cmdAdd = (msg, c) => {
    const pid = msg.playerid, gm = playerIsGM(pid), o = c.opts;
    const fav = o.spell ? findFavorite(o.spell) : null;
    if (o.spell && !fav) return erreur(pid, `Sort courant inconnu : ${o.spell}. Voir !buff fav.`);
    const name = texte(o.name) || (fav ? fav.name : '');
    if (!name) return erreur(pid, 'Il manque le nom de l\'effet (--name).');
    let rounds;
    if (texte(o.dur)) {
      const d = parseDuration(o.dur);
      if (!d || d.sign < 0 || d.rounds === 0) return erreur(pid, `Durée illisible : ${o.dur}. Exemples : 3r, 10min, 2h, perm.`);
      rounds = d.rounds;
    } else if (fav) {
      const cl = parseInt(o.cl, 10);
      if (!(cl >= 1 && cl <= 40)) return erreur(pid, 'Il manque le niveau de lanceur (--cl).');
      rounds = spellDuration(fav, cl);
    } else return erreur(pid, 'Il manque la durée (--dur).');
    const hidden = o.hidden !== undefined ? parseBool(o.hidden) === true : false;
    if (hidden && !gm) return erreur(pid, 'Seul le MJ peut créer un effet caché.');
    const pageid = pageDu(msg);
    const rl = trouverLanceur(texte(o.caster), pageid);
    if (rl.choices) return demanderChoix(msg, c, 'caster', 0, texte(o.caster), rl.choices);
    const caster = rl.caster;
    const d = {
      name, rounds, caster, hidden,
      effect: texte(o.effect) || (fav ? fav.effect : '')
    };
    const r = resoudreCibles(parseTargets(o.targets), msg, caster, pageid);
    if (r.error) return erreur(pid, r.error);
    if (r.choose) return demanderChoix(msg, c, 'targets', r.choose.index, r.choose.nom, r.choose.choices);
    if (r.pick) return ouvrirChoix(pid, pageid, d, r.pick);
    d.targets = r.targets;
    lancer(pid, d);
  };

  // ---- choix d'un nom qui n'est pas exact : on garde la commande, on demande lequel,
  // puis on la relance avec la clé choisie (ou « =Nom » pour le nom libre)
  const demanderChoix = (msg, c, champ, index, nom, choices) => {
    const pid = msg.playerid, s = etat();
    s.choix = s.choix || {};
    s.choix[pid] = {
      sub: c.sub, args: c.args, opts: c.opts, selected: (msg.selected || []).map((x) => x._id),
      champ, index, nom, options: choices.map(copieEntite)
    };
    dire(pid, renderChoix(nom, champ === 'caster' ? 'lanceur' : 'cible', s.choix[pid].options.map((e) => e.name || '?')));
  };
  const cmdChoose = (msg, c) => {
    const pid = msg.playerid, s = etat();
    const d = s.choix && s.choix[pid];
    if (!d) return erreur(pid, 'Aucun choix de nom en cours.');
    const a = normalize(c.args[0]);
    if (a === 'cancel') { delete s.choix[pid]; return dire(pid, boite('Annulé.')); }
    let val;
    if (a === 'free') val = '=' + d.nom;
    else {
      const e = d.options[parseInt(a, 10) - 1];
      if (!e) return erreur(pid, 'Choix inconnu.');
      val = entityKey(e);
    }
    delete s.choix[pid];
    const opts = Object.assign({}, d.opts);
    if (d.champ === 'caster') opts.caster = val;
    else {
      const noms = String(opts.targets).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      noms[d.index] = val;
      opts.targets = noms.join(', ');
    }
    const m2 = { type: 'api', playerid: pid, who: msg.who, content: '', selected: d.selected.map((id) => ({ _id: id, _type: 'graphic' })) };
    const c2 = { sub: d.sub, args: d.args, opts, confirm: null };
    return d.sub === 'edit' ? cmdEdit(m2, c2) : cmdAdd(m2, c2);
  };

  const cmdPick = (msg, c) => {
    const pid = msg.playerid, s = etat();
    const d = s.drafts[pid];
    if (!d) return erreur(pid, 'Aucun choix de cibles en cours.');
    const action = normalize(c.args[0]);
    if (action === 'toggle') {
      const key = c.args[1];
      const cand = d.candidates.find((x) => entityKey(x) === lireCle(key));
      if (!cand) return erreur(pid, 'Cible inconnue.');
      if (d.targets.some((t) => sameEntity(t, cand))) d.targets = d.targets.filter((t) => !sameEntity(t, cand));
      else d.targets.push(copieEntite(cand));
      return montrerChoix(pid);
    }
    if (action === 'all') {
      const pjs = pjsDuGroupe(d.pageid);
      pjs.forEach((e) => {
        if (!d.candidates.some((x) => sameEntity(x, e))) d.candidates.push(copieEntite(e));
        if (!d.targets.some((t) => sameEntity(t, e))) d.targets.push(copieEntite(e));
      });
      return montrerChoix(pid);
    }
    if (action === 'none') { d.targets = []; return montrerChoix(pid); }
    if (action === 'cancel') { delete s.drafts[pid]; return dire(pid, boite('Annulé.')); }
    if (action === 'ok') {
      if (!d.targets.length) return erreur(pid, 'Aucune cible cochée. Pour retirer l\'effet, utilise le bouton X du menu.');
      delete s.drafts[pid];
      if (d.editId) {
        const b = trouver(d.editId);
        if (!b || !peutGerer(pid, b)) return erreur(pid, `Effet introuvable : ${d.editId}.`);
        b.targets = d.targets.map(copieEntite);
        rafraichir();
        return dire(pid, boite(`<b>${escapeHtml(b.name)}</b> → ${escapeHtml(nomsCibles(b))}`));
      }
      return lancer(pid, d);
    }
    return erreur(pid, 'Action inconnue : toggle, all, none, ok ou cancel.');
  };

  const cmdEdit = (msg, c) => {
    const pid = msg.playerid, gm = playerIsGM(pid), o = c.opts;
    const b = trouver(c.args[0]);
    if (!b || (b.hidden && !gm)) return erreur(pid, `Effet introuvable : ${c.args[0] || '(aucun numéro)'}.`);
    if (!peutGerer(pid, b)) return erreur(pid, `Tu ne peux pas modifier ${libelle(b)}.`);
    const faits = [];
    let dur = null;
    if (o.dur !== undefined) {
      dur = parseDuration(o.dur);
      if (!dur) return erreur(pid, `Durée illisible : ${o.dur}. Exemples : -1, +2, 4r, 10min, perm.`);
      if (dur.sign && (b.remaining === null || dur.rounds === null)) return erreur(pid, 'Effet permanent : donne une durée (4r, 10min...) plutôt qu\'un ajout.');
    }
    if (o.hidden !== undefined) {
      if (!gm) return erreur(pid, 'Seul le MJ peut cacher un effet.');
      if (parseBool(o.hidden) === null) return erreur(pid, '--hidden attend yes ou no.');
    }
    const pageid = (() => { const t = b.targets.map(tokensDe).find((l) => l.length); return t ? t[0].get('_pageid') : pageDu(msg); })();
    let nouveauLanceur;
    if (texte(o.caster) !== undefined) {
      const rl = trouverLanceur(texte(o.caster), pageid);
      if (rl.choices) return demanderChoix(msg, c, 'caster', 0, texte(o.caster), rl.choices);
      nouveauLanceur = rl.caster;
    }
    let cibles = null;
    if (o.targets !== undefined) {
      const caster = nouveauLanceur !== undefined ? nouveauLanceur : b.caster;
      const r = resoudreCibles(parseTargets(o.targets), msg, caster, pageid);
      if (r.error) return erreur(pid, r.error);
      if (r.choose) return demanderChoix(msg, c, 'targets', r.choose.index, r.choose.nom, r.choose.choices);
      if (r.pick) {
        const pre = parseTargets(o.targets).mode === 'pick' ? b.targets : r.pick;
        return ouvrirChoix(pid, pageid, { name: b.name, editId: b.id }, pre.length ? pre : b.targets);
      }
      cibles = r.targets;
    }
    if (dur) { b.remaining = dur.sign ? Math.max(0, b.remaining + dur.sign * dur.rounds) : dur.rounds; faits.push(formatDuration(b.remaining)); }
    if (texte(o.name)) { b.name = texte(o.name); faits.push('renommé'); }
    if (texte(o.effect) !== undefined) { b.effect = texte(o.effect); faits.push(b.effect ? 'effet modifié' : 'effet effacé'); }
    if (nouveauLanceur !== undefined) {
      b.caster = nouveauLanceur;
      faits.push('lanceur ' + (nomLanceur(b) || 'aucun'));
    }
    if (o.hidden !== undefined) { b.hidden = parseBool(o.hidden); faits.push(b.hidden ? 'caché' : 'visible'); }
    if (cibles) { b.targets = cibles.map(copieEntite); faits.push('cibles : ' + nomsCibles(b)); }
    if (!faits.length) return erreur(pid, 'Rien à modifier : --dur, --name, --effect, --caster, --targets ou --hidden.');
    if (b.remaining === 0) {
      traiter({ expired: [b], warned: [] });
      return dire(pid, boite(`<b>${escapeHtml(libelle(b))}</b> retiré.`));
    }
    rafraichir();
    dire(pid, boite(`<b>${escapeHtml(libelle(b))}</b> : ${escapeHtml(faits.join(', '))}.`));
  };

  // suppression de lancements entiers, avec essai à blanc puis « confirm N »
  const cmdRemove = (msg, c) => {
    const pid = msg.playerid, s = etat(), gm = playerIsGM(pid);
    const ids = c.args.join(' ').split(/[,\s]+/).filter(Boolean);
    if (!ids.length) return erreur(pid, 'Donne le numéro de l\'effet : !buff remove 3');
    // {b, seul} : seul = null (tout le lancement) ou les seuls personnages du joueur
    const cibles = [];
    for (const id of ids) {
      const b = trouver(id);
      if (!b || (b.hidden && !gm)) return erreur(pid, `Effet introuvable : ${id}.`);
      if (cibles.some((x) => x.b === b)) continue;
      if (peutGerer(pid, b)) { cibles.push({ b, seul: null }); continue; }
      const miens = mesCibles(pid, b);
      if (!miens.length) return erreur(pid, `Tu ne peux pas retirer ${libelle(b)}.`);
      // tous ses personnages et personne d'autre : c'est tout le lancement
      cibles.push({ b, seul: miens.length === b.targets.length ? null : miens });
    }
    const noms = cibles.map(({ b, seul }) => `<b>${escapeHtml(b.name)}</b> (${escapeHtml(seul ? seul.map(nomEntite).join(', ') + ' seulement' : nomsCibles(b))})`).join(', ');
    const n = cibles.length;
    if (c.confirm === null) {
      return dire(pid, boite(`Retirerait ${n} effet${n > 1 ? 's' : ''} : ${noms}<br>` +
        bouton('Confirmer', `${CMD} remove ${cibles.map((x) => x.b.id).join(' ')} confirm ${n}`)));
    }
    if (c.confirm !== n) return erreur(pid, `Le nombre ne correspond pas (${n} effet(s), pas ${c.confirm}) : rien n'a été retiré.`);
    cibles.forEach(({ b, seul }) => { b.targets = seul ? b.targets.filter((t) => !seul.includes(t)) : []; });
    s.buffs = s.buffs.filter((b) => b.targets.length);
    rafraichir();
    dire(pid, boite(`Retiré : ${noms}`));
  };

  // !buff clear : retire des personnages (sélection, ou --keys) de tous leurs effets
  const cmdClear = (msg, c) => {
    const pid = msg.playerid, s = etat();
    if (normalize(c.args[0]) === 'all') {
      if (!playerIsGM(pid)) return erreur(pid, 'Seul le MJ peut tout effacer.');
      const n = s.buffs.length;
      if (!n) return erreur(pid, 'Aucun effet à effacer.');
      if (c.confirm === null) {
        return dire(pid, boite(`Effacerait les ${n} effets de la partie.<br>${bouton('Confirmer', `${CMD} clear all confirm ${n}`)}`));
      }
      if (c.confirm !== n) return erreur(pid, `Le nombre ne correspond pas (${n} effet(s), pas ${c.confirm}) : rien n'a été effacé.`);
      s.buffs = [];
      rafraichir();
      return dire(pid, boite(`${n} effet${n > 1 ? 's' : ''} effacé${n > 1 ? 's' : ''}.`));
    }
    const keys = typeof c.opts.keys === 'string'
      ? c.opts.keys.split(/[,\s]+/).filter(Boolean).map(lireCle)
      : entitesUniques(selection(msg)).map(entityKey);
    if (!keys.length) return erreur(pid, 'Sélectionne des tokens (ou !buff clear all pour le MJ).');
    const paires = [];
    // ses propres personnages se retirent de tout ; les autres, des lancements qu'on gère
    s.buffs.forEach((b) => {
      if (b.hidden && !playerIsGM(pid)) return;
      const gere = peutGerer(pid, b);
      b.targets.forEach((t) => { if (keys.includes(entityKey(t)) && (gere || controle(pid, t))) paires.push({ b, t }); });
    });
    const n = paires.length;
    if (!n) return erreur(pid, 'Aucun effet que tu peux retirer sur la sélection.');
    const noms = paires.map((p) => `<b>${escapeHtml(p.b.name)}</b> (${escapeHtml(nomEntite(p.t))})`).join(', ');
    if (c.confirm === null) {
      return dire(pid, boite(`Retirerait ${n} effet${n > 1 ? 's' : ''} : ${noms}<br>` +
        bouton('Confirmer', `${CMD} clear --keys ${keys.join(',')} confirm ${n}`)));
    }
    if (c.confirm !== n) return erreur(pid, `Le nombre ne correspond pas (${n} effet(s), pas ${c.confirm}) : rien n'a été retiré.`);
    paires.forEach((p) => { p.b.targets = p.b.targets.filter((t) => t !== p.t); });
    s.buffs = s.buffs.filter((b) => b.targets.length);
    rafraichir();
    dire(pid, boite(`Retiré : ${noms}`));
  };

  const cmdTime = (msg, c) => {
    const pid = msg.playerid, s = etat();
    if (!playerIsGM(pid)) return erreur(pid, 'Seul le MJ fait passer le temps.');
    const d = parseDuration(c.args.join(' '));
    if (!d || d.sign < 0 || !d.rounds) return erreur(pid, 'Durée à faire passer : !buff time 10min (ou 3r, 1h).');
    const concernes = s.buffs.filter((b) => b.remaining !== null && b.remaining !== undefined);
    const n = concernes.length;
    if (!n) return erreur(pid, 'Aucun effet avec une durée.');
    const fini = concernes.filter((b) => b.remaining <= d.rounds);
    if (c.confirm === null) {
      return dire(pid, boite(`Faire passer ${escapeHtml(formatDuration(d.rounds))} : ${n} effet${n > 1 ? 's' : ''} raccourci${n > 1 ? 's' : ''}` +
        (fini.length ? `, dont ${fini.length} se terminerai${fini.length > 1 ? 'ent' : 't'} : ${fini.map((b) => escapeHtml(libelle(b))).join(', ')}` : '') +
        `.<br>${bouton('Confirmer', `${CMD} time ${compactDuration(d.rounds)} confirm ${n}`)}`));
    }
    if (c.confirm !== n) return erreur(pid, `Le nombre ne correspond pas (${n} effet(s), pas ${c.confirm}) : le temps n'a pas passé.`);
    traiter(tick(s.buffs, () => true, d.rounds), { avertir: false });
    dire(pid, boite(`${escapeHtml(formatDuration(d.rounds))} passées.`));
  };

  const cmdFav = (msg) => {
    const lanceur = lanceurParDefaut(msg.playerid, pageDu(msg));
    dire(msg.playerid, boite('<b>Sorts courants</b><br>' + FAVORITES.map((f) => boutonFavori(f, lanceur)).join('')));
  };

  const cmdShow = (msg) => {
    rafraichir();
    dire(msg.playerid, boite(lienFenetre(handout().id, `Ouvrir la fenêtre « ${HANDOUT} »`)));
  };

  const cmdHelp = (msg) => {
    dire(msg.playerid, boite('<b>!buff</b> : menu des effets<br>' +
      '<b>!buff add --name X --dur 5min</b> [--caster Nom] [--targets group|me|selected|pick|Selea,Paz] [--effect texte] [--hidden]<br>' +
      '<b>!buff add --spell bless --cl 5</b> · <b>!buff fav</b> : sorts courants<br>' +
      '<b>!buff edit 3 --dur -1</b> (ou +2, 4r, 10min, perm), --name, --effect, --caster, --targets, --hidden yes|no<br>' +
      '<b>!buff remove 3</b> · <b>!buff clear</b> (sélection) · <b>!buff clear all</b> (MJ)<br>' +
      '<b>!buff time 10min</b> (MJ) · <b>!buff show</b> : lien vers la fenêtre<br>' +
      'Durées : 3r ou 3 (rounds), 10min, 2h, 1j, perm. Nom libre forcé : =Nom.'));
  };

  // ------------------------------------------------------- tracker d'initiative
  const lireOrdre = (v) => { try { const o = JSON.parse(v || '[]'); return Array.isArray(o) ? o : []; } catch (e) { return []; } };

  const tourSuivant = (prev, next) => {
    const s = etat();
    if (!next.length) { s.dernierTour = null; return; } // tracker vidé : fin du combat
    if (detectAdvance(prev, next) !== 'forward') return;
    // revenir en arrière puis repasser au même tour ne décompte pas deux fois
    const signature = next.map(cleEntree).join(';');
    if (signature === s.dernierTour) return;
    s.dernierTour = signature;
    if (!s.buffs.length) return;
    const toks = next.map((e) => (e && e.id && !estPerso(e) ? getObj('graphic', e.id) : null));
    // position du lanceur dans le tracker, ou -1 (pas de lanceur, ou absent)
    const ancre = (b) => {
      if (!b.caster) return -1;
      let i = b.caster.id ? toks.findIndex((t) => tokenEst(b.caster, t)) : -1;
      if (i < 0 && b.caster.name) i = toks.findIndex((t) => t && normalize(nomToken(t)) === normalize(b.caster.name));
      return i;
    };
    const ancres = new Map(s.buffs.map((b) => [b, ancre(b)]));
    const r1 = tick(s.buffs, (b) => ancres.get(b) === 0, 1);
    const r2 = isNewRound(prev, next) ? tick(s.buffs, (b) => ancres.get(b) === -1, 1) : { expired: [], warned: [] };
    traiter({ expired: r1.expired.concat(r2.expired), warned: r1.warned.concat(r2.warned) });
  };

  // ------------------------------------------------------------------ évènements
  on('ready', () => {
    etat();
    nettoyerMarqueurs();
    rafraichir();
    log(`${NOM} (bufftracker.js) prêt : ${etat().buffs.length} effet(s) suivis.`);
  });

  on('chat:message', (msg) => {
    if (msg.type !== 'api') return;
    const c = parseCommand(msg.content);
    if (!c) return;
    try {
      switch (c.sub) {
        case 'menu': case 'list': return cmdMenu(msg);
        case 'add': return cmdAdd(msg, c);
        case 'pick': return cmdPick(msg, c);
        case 'choose': return cmdChoose(msg, c);
        case 'edit': return cmdEdit(msg, c);
        case 'remove': return cmdRemove(msg, c);
        case 'clear': return cmdClear(msg, c);
        case 'time': return cmdTime(msg, c);
        case 'fav': return cmdFav(msg);
        case 'show': case 'handout': return cmdShow(msg);
        case 'help': return cmdHelp(msg);
        default: return erreur(msg.playerid, `Commande inconnue : ${c.sub}. Voir !buff help.`);
      }
    } catch (e) {
      log(`${NOM} : erreur ${e && e.stack ? e.stack : e}`);
      erreur(msg.playerid, `Erreur du script : ${e && e.message ? e.message : e}`);
    }
  });

  on('change:campaign:turnorder', (obj, prev) => {
    try {
      tourSuivant(lireOrdre(prev && prev.turnorder), lireOrdre(obj.get('turnorder')));
    } catch (e) { log(`${NOM} : erreur tracker ${e && e.stack ? e.stack : e}`); }
  });

  on('destroy:graphic', (tok) => {
    const s = etat();
    let change = false;
    s.buffs.forEach((b) => {
      const avant = b.targets.length;
      b.targets = b.targets.filter((t) => !(t.kind === 'token' && t.id === tok.id));
      if (b.targets.length !== avant) change = true;
      if (b.caster && b.caster.kind === 'token' && b.caster.id === tok.id) b.caster = { kind: null, id: null, name: nomToken(tok) || b.caster.name };
    });
    s.buffs = s.buffs.filter((b) => b.targets.length);
    if (change) majHandout();
  });
})();
