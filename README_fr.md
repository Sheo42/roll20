# roll20
My roll20 shit

[English version](README.md)


## Gabarits de zones d'effet (Pathfinder 1e)

`scripts/gabarit.js` trace sur la carte les zones d'effet (boule de feu, cône, ligne, émanation) selon les règles
officielles de Pathfinder 1e : le contour suit exactement les bordures des cases touchées (décompte des cases,
une diagonale sur deux compte double), pas un cercle approximatif. Les tailles sont données en cases, en pieds ou en
mètres et sont converties en cases : l'échelle de la carte n'a aucune influence (5 ft = 1,5 m = 1 case).

![Exemple : quatre gabarits en même temps](macro/gabarit-exemple.png)

*Quatre gabarits en même temps sur une carte en mètres : cône droit de 18 m (rouge), cône diagonal de 6 m (vert), cône diagonal de 4,5 m (bleu) et cercle de 6 m (violet). Chacun a son Viseur, dont la flèche donne la direction.*

**Installation**
1. Coller `scripts/gabarit.js` dans un nouveau script API (Game Settings > API Scripts), enregistrer.
2. Importer `macro/viseur.png` dans sa bibliothèque Roll20 (pas depuis le Marketplace), le placer sur la carte, le
   sélectionner puis taper `!gabarit aimerimg` (MJ). Sans cela, le script utilise une image de secours teintée en rouge.
3. Créer une macro « Gabarit », visible par tous, avec le contenu de `macro/gabarit.macro.txt`.

**Utilisation (joueur)** : sélectionner son token, cliquer sur « Gabarit », choisir la forme et la taille dans les
listes. Un Viseur (un par gabarit, de la couleur du gabarit) apparaît près du personnage.
- Cercle : le cercle est centré sur le Viseur.
- Cône droit, cône diagonal, ligne : le gabarit part du Viseur. On le tourne (touche E + molette, par pas de 45°)
  pour choisir la direction ; la rotation s'aimante sur les directions valides.
- Émanation : part des bords de la case du lanceur.
- Plusieurs gabarits peuvent rester en même temps. « Effacer » dans le message reçu, ou supprimer le Viseur.

| Commande | Effet |
| --- | --- |
| `!gabarit cast <id lanceur> <forme> <taille> [color=fire] [duration=60]` | Crée le gabarit et son Viseur. Formes : `burst`, `straightcone` (cône droit), `diagcone` (cône diagonal), `cone`, `line`, `emanation`. Taille : `4sq` (cases), `6m`, `20ft` ou `20`. Couleurs : `fire`, `cold`, `acid`, `electricity`, `sonic`, `force`, `negative`, `neutral`. |
| `!gabarit clear [gN]` | Efface un gabarit, ou tous ceux du joueur. |
| `!gabarit clear all` | MJ : efface tous les gabarits. |
| `!gabarit aimerimg` | MJ : enregistre le token sélectionné comme image du Viseur. |

**Tests** : `node tests/gabarit.test.js` (Node, sans dépendance) lance 228 vérifications : conversion des tailles,
formes et nombres de cases, contours, puis le flux complet avec un faux Roll20. Ils n'ont pas remplacé un essai en
campagne réelle.

## Météo aléatoire (Climat)

`scripts/Climat.js` tire une météo au hasard, par niveau de chaleur (très froid, froid, tempéré, chaud, très chaud) plutôt que
par région, pour servir aussi hors de Golarion. Chaque jour est découpé en 4 phases (matin, après-midi, soir, nuit), chacune
avec sa température. Les phénomènes (pluie, neige, brouillard, grêle, orage, tempête de neige, blizzard, ouragan, tornade,
tempête de sable, trombes d'eau) ont des prémices, une heure de début et une durée tirée d'après la page Climat du wiki
Pathfinder-FR. Ils peuvent déborder sur les jours suivants. Les vagues de chaleur ou de froid et le vent du désert durent 3 jours.
Si un phénomène tiré dépasse le nombre de jours demandés, la période est prolongée jusqu'à sa fin (5 jours au plus) et la carte
l'indique. Le script ne gère aucune mécanique de jeu, seulement le texte et les températures. Il ne garde aucun état.

**Installation** : coller `scripts/Climat.js` (et seulement lui, pas le fichier de tests) dans un nouveau script API, enregistrer.
Créer la macro « Climat » avec le contenu de `macro/Climat.macro.txt` (`!climat`).

**Utilisation (MJ)** : cliquer sur « Climat », choisir le niveau de chaleur, puis un mois (un jour) ou « Plusieurs jours » (1 à 14).

| Commande | Effet |
| --- | --- |
| `!climat` | Boutons de niveau de chaleur. |
| `!region <niveau>` | Boutons des mois pour ce niveau. |
| `!RollClimat <niveau> <mois> [jours]` | Tire la météo (ex. `!RollClimat cold neth 3`). L'ordre des arguments est libre. |

Les identifiants de niveau, en anglais, sont `verycold`, `cold`, `temperate`, `hot` et `veryhot` ; les mois portent leurs noms golarions (Abadius, Calistril, Pharast...).

**Tests** : `node tests/Climat.test.js` (Node, sans dépendance) lance 306 vérifications : dés scriptés, propriétés statistiques
sur des dizaines de milliers de jours, puis le flux complet avec un faux Roll20. Ils n'ont pas remplacé un essai en partie réelle.

## Synchroniser les scripts API avec GitHub (userscript)

`sync/roll20-github-sync.user.js` ajoute un bouton « ⟳ GitHub » sur la page des scripts API de Roll20
(`app.roll20.net/campaigns/scripts/<campagne>`). Il lit les fichiers `.js` de `scripts/` au dernier commit de `main`
et associe chacun à l'onglet de script Roll20 du même nom (casse, espaces, tirets et accents ignorés : « token
tool.js » est `token-tool.js`). Le panneau indique pour chaque fichier : à jour, modifié (+lignes / -lignes) ou absent
du jeu. « Mettre à jour la sélection » enregistre les fichiers cochés avec le bouton « Save Mod Script » de Roll20
lui-même, un par chargement de page, et crée ceux à installer qui sont cochés. Après chaque rechargement, il vérifie
que Roll20 a enregistré exactement le contenu du dépôt, et s'arrête au premier écart. Les scripts de la bibliothèque
Roll20 (one-click) et les onglets sans fichier dans le dépôt ne sont jamais touchés. Chaque enregistrement redémarre
le sandbox API, comme un enregistrement à la main.

**Installation** : installer [Tampermonkey](https://www.tampermonkey.net/) dans le navigateur, puis ouvrir
`https://raw.githubusercontent.com/Sheo42/roll20/main/sync/roll20-github-sync.user.js` : Tampermonkey propose de
l'installer. Il se met ensuite à jour tout seul depuis la même adresse. Dans Chrome, Tampermonkey ne lance les scripts qu'après autorisation : `chrome://extensions` > Tampermonkey > Détails > activer « Autoriser les scripts utilisateur » (sur les anciennes versions de Chrome, activer plutôt le mode développeur). Le bouton apparaît en bas à droite de la page des scripts API.

**Tests** : `node tests/sync.test.js` (noms, différences, plan, et la file enregistrement-rechargement-vérification
avec une fausse page).

## Character tools (API scripts, GM only)

Small scripts to inspect a character's attributes from the server side, without opening its
sheet in a browser. Opening a sheet from a session that did not receive the character's attributes
makes the Pathfinder sheet recreate its default attributes, which leaves duplicates behind.
Paste each file from `scripts/` in a new API script (Game Settings > API Scripts), save, restart the sandbox.

| Script | Command | Effect |
| --- | --- | --- |
| `pjinfo.js` | `!pjinfo Nom du Personnage` | Read-only. Whispers race, level, alignment, deity, age, languages, classes, ability names, number of duplicated attributes and of same-named handouts. |
| `dupes.js` | `!dupes Nom du Personnage [all]` | Read-only. Groups duplicated attribute names, compares values, and decodes the creation date from the Firebase-style ids to tell the oldest copy from the recent ones. |
| `attackdupes.js` | `!attackdupes Nom du Personnage [all]`, `!attackdupes *` | Read-only. Finds duplicated attack rows (same name, case and spaces ignored, and same source: the same item, spell or ability, or both unlinked; a renamed attack linked to the same item is a variant, not a copy), with the date each row appeared and what it is linked to, to tell which part of the Pathfinder sheet created the copies. `*` lists the characters that have duplicated attacks. |
| `attackwatch.js` | `!attackwatch [log\|context\|on\|off\|clear]` | Read-only, always on. Logs every change to an item, spell or ability "create attack" field and every API sandbox restart, with the time and the players online. It rereads the attack rows of player-controlled characters in turns (12 characters every 5 seconds), so a new row is caught even when Roll20 sends no event (changes made by an API script never reach other scripts); each new row comes with its context: the API commands and the item changes of those characters in the 3 minutes before. It also wraps `createObj` in the shared API sandbox to log any other script creating a "create attack" field or an attack row, with the calling functions (the original call always runs). Changes made with `set` or `setWithWorker` cannot be watched: Roll20 does not let a script modify its objects. The Pathfinder Community sheet adds a linked attack on *any* change to the "create attack" field. Keeps the last 60 events in `state`. |
| `attackclean.js` | `!attackclean Nom du Personnage` then `!attackclean Nom du Personnage confirm N`; `!attackclean all` then `!attackclean all confirm N` for every character | Deletes duplicated attack rows. Dry run by default. Only removes rows linked to the same item, spell or ability as an older row with the same name, and only when their hand-edited settings are identical and they have no extra fields; the oldest row is kept, renamed variants and unlinked attacks are never touched, anything else is listed "to check" with the differing values and a button to delete that one copy by hand (`delete <id>`, then `delete <id> confirm`). |
| `dedup.js` | `!dedup Nom du Personnage` then `!dedup Nom du Personnage confirm N` | Deletes duplicates. Dry run by default; deletion only with the exact count shown by the dry run. |
| `tokeninfo.js` | `!tokeninfo Nom du Personnage`, `!tokenwatch on\|off` | Read-only diagnostic for token naming. `!tokeninfo` shows the default token's name, its bar links and the tokens already placed. `!tokenwatch` whispers each token creation and every rename (old and new name) for 15 minutes, to find which script renames tokens. |
| `attrscan.js` | `!attrscan Nom du Personnage [section]` | Read-only. Counts attributes, repeating-section rows (and empty ones), "macro" attributes, longest values and most frequent name prefixes. With a section name (for example `ability`), shows each field and its most frequent short values. |
| `attrscan.js` | `!abilitycheck Nom du Personnage` | Read-only. Applies the Pathfinder Community sheet's own rule (`PFAbility.getTopOfMenu`): lists abilities shown in the menu (`showinmenu` true) whose `ability_type` is missing or not Ex/Sp/Su. Those rows make the sheet log `could not find top macro for 0` in a loop and slow the page down. |
| `abilityfix.js` | `!abilityfix Nom du Personnage` then `!abilityfix Nom du Personnage confirm N` | Sets `showinmenu` to 0 on exactly those rows (they leave the chat ability menu, nothing else changes). Dry run by default; applies only with the exact count shown by the dry run. Try it on a duplicate of the character first. |
| `pjstats.js` | `!pjstats Nom du Personnage [base weapons feats items spells buffs]` | Read-only. Whispers the numbers that matter for a build review: classes, ability scores, HP, initiative, AC with its breakdown, saves, BAB, CMB/CMD, SR/DR, armor and shield, each weapon's attack, damage and critical range, feats, traits and class abilities, items, spells by level, and buffs (active ones marked). Reads all attributes in one `findObjs` pass. Sections are optional (default: all). Tests: `node tests/pjstats.test.js`. |

`dedup.js` keeps the oldest copy of every attribute and only removes recent copies created inside
`WINDOW_FROM`..`WINDOW_TO` (UTC, edit them at the top of the file) that have the same value and max as the
kept one. It never touches `repeating_` sections. Run `dupes.js` first to pick the window, and
duplicate the character beforehand if you want a backup.

## Cartes Dungeon Painter Studio

[`dps/`](dps) contient les outils pour créer des cartes Dungeon Painter Studio par code et avec Claude : un générateur
Python qui écrit des cartes `.dps` natives, et « DPS Maps », une extension de l'application Claude (serveur MCP) qui
cherche dans la bibliothèque d'assets installée, prévisualise les cartes avec les vrais assets et pilote DPS pour
exporter le JPG. Documentation (en anglais) : [`dps/README.md`](dps/README.md).

## Murs et portes d'une carte Dungeon Painter Studio (dps-walls)

`scripts/dps-walls.js` trace les barrières d'éclairage dynamique et les portes Roll20 à partir d'une seule ligne de
chat. Cette ligne est écrite par le générateur de cartes DPS (`DPSMap.roll20_command()` dans
[`dps/generator/dps_lib.py`](dps/generator/dps_lib.py)) : les murs tombent donc exactement sur l'image de la carte. Coordonnées en cases ; les parties Jumpgate
reçoivent des objets `pathv2`, les anciennes des chemins classiques.

**Installation** : coller `scripts/dps-walls.js` dans un nouveau script API et enregistrer.

**Utilisation (MJ)** : Create Page > Upload Background avec le JPG exporté (Roll20 dimensionne la page d'après
l'image), rester sur cette page, puis coller dans le chat la ligne du fichier `.roll20.txt` de la carte.

| Commande | Effet |
| --- | --- |
| `!dpswalls size=42x42 ; W:x,y x,y ... ; T:... ; O:... ; D:x,y x,y ; S:x,y x,y` | Sur la page où se trouve le MJ : fixe la taille, trace les murs (`W`, bloquent vue et déplacement), barrières transparentes (`T`, bloquent seulement le déplacement), barrières à sens unique (`O`), portes fermées (`D`) et portes secrètes (`S`). Relancée, elle remplace ce qu'elle avait tracé. Pas de crochets : Roll20 lirait `[[` comme un jet en ligne. |
| `!dpswalls clear` | Efface les murs et portes qu'elle a tracés sur la page. |
| `!dpswalls img <url>` | Pose une image de ta bibliothèque sur le calque carte, à la taille de la page. |

**Tests** : `node tests/dps-walls.test.js` (Node, sans dépendance) : lecture de la commande, géométrie pathv2, chemin
classique et porte (axe y inversé pour les portes), puis flux complet avec un faux Roll20. Essayé sur la carte de
l'Ermitage de la Lame Veillante dans la vraie campagne.

## Slow page after editing a token of a PC

Symptom: renaming or editing a token that represents a Pathfinder Community character freezes the page for a long
time, with `could not find top macro for 0` repeating in the browser console. Cause: an ability with `showinmenu`
true and an empty or missing type is read as type "0" by the sheet worker (`getTopOfMenu`). Run
`!abilitycheck <character>`, then `!abilityfix <character>` (dry run first). A separate note: PFCompanion's
"Mook Numbering" can wrongly number PC tokens (`Name 1`); see `!tokeninfo` and `!tokenwatch`.

**Dossiers** : `scripts/` (scripts API), `tests/` (tests Node des scripts), `macro/` (macros et images associées), `sync/` (userscript qui synchronise les scripts API avec ce dépôt),
`dps/` (outils de cartes Dungeon Painter Studio).
Les macros sont les fichiers `*.macro.txt` : leur contenu se colle tel quel dans une macro Roll20. L'inventaire de ce que fait chaque macro et des scripts dont elle dépend est dans [`macro/README.md`](macro/README.md).
