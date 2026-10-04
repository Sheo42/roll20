# roll20
My roll20 shit

Copy/paste Climat.js into the API.
Use !climat in the chat to start it.

## Character tools (API scripts, GM only)

Three small scripts to inspect a character's attributes from the server side, without opening its
sheet in a browser. Opening a sheet from a session that did not receive the character's attributes
makes the Pathfinder sheet recreate its default attributes, which leaves duplicates behind.
Paste each file in a new API script (Game Settings > API Scripts), save, restart the sandbox.

| Script | Command | Effect |
| --- | --- | --- |
| `pjinfo.js` | `!pjinfo Nom du Personnage` | Read-only. Whispers race, level, alignment, deity, age, languages, classes, ability names, number of duplicated attributes and of same-named handouts. |
| `dupes.js` | `!dupes Nom du Personnage [tout]` | Read-only. Groups duplicated attribute names, compares values, and decodes the creation date from the Firebase-style ids to tell the oldest copy from the recent ones. |
| `dedup.js` | `!dedup Nom du Personnage` then `!dedup Nom du Personnage confirmer N` | Deletes duplicates. Dry run by default; deletion only with the exact count shown by the dry run. |
| `tokeninfo.js` | `!tokeninfo Nom du Personnage`, `!tokenwatch on\|off` | Read-only diagnostic for token naming. `!tokeninfo` shows the default token's name, its bar links and the tokens already placed. `!tokenwatch` whispers each token creation and every rename (old and new name) for 15 minutes, to find which script renames tokens. |
| `attrscan.js` | `!attrscan Nom du Personnage [section]` | Read-only. Counts attributes, repeating-section rows (and empty ones), "macro" attributes, longest values and most frequent name prefixes. With a section name (for example `ability`), shows each field and its most frequent short values. |
| `attrscan.js` | `!abilitycheck Nom du Personnage` | Read-only. Applies the Pathfinder Community sheet's own rule (`PFAbility.getTopOfMenu`): lists abilities shown in the menu (`showinmenu` true) whose `ability_type` is missing or not Ex/Sp/Su. Those rows make the sheet log `could not find top macro for 0` in a loop and slow the page down. |
| `abilityfix.js` | `!abilityfix Nom du Personnage` then `!abilityfix Nom du Personnage confirmer N` | Sets `showinmenu` to 0 on exactly those rows (they leave the chat ability menu, nothing else changes). Dry run by default; applies only with the exact count shown by the dry run. Try it on a duplicate of the character first. |

`dedup.js` keeps the oldest copy of every attribute and only removes recent copies created inside
`WINDOW_FROM`..`WINDOW_TO` (UTC, edit them at the top of the file) that have the same value and max as the
kept one. It never touches `repeating_` sections. Run `dupes.js` first to pick the window, and
duplicate the character beforehand if you want a backup.

## Slow page after editing a token of a PC

Symptom: renaming or editing a token that represents a Pathfinder Community character freezes the page for a long
time, with `could not find top macro for 0` repeating in the browser console. Cause: an ability with `showinmenu`
true and an empty or missing type is read as type "0" by the sheet worker (`getTopOfMenu`). Run
`!abilitycheck <character>`, then `!abilityfix <character>` (dry run first). A separate note: PFCompanion's
"Mook Numbering" can wrongly number PC tokens (`Name 1`); see `!tokeninfo` and `!tokenwatch`.

## Gabarits de zones d'effet (Pathfinder 1e)

`scripts/gabarit.js` trace sur la carte les zones d'effet (boule de feu, cône, ligne, émanation) selon les règles
officielles de Pathfinder 1e : le contour suit exactement les bordures des cases touchées (décompte des cases,
une diagonale sur deux compte double), pas un cercle approximatif. Les tailles sont données en cases, en pieds ou en
mètres et sont converties en cases : l'échelle de la carte n'a aucune influence (5 ft = 1,5 m = 1 case).

**Installation**
1. Coller `scripts/gabarit.js` dans un nouveau script API (Game Settings > API Scripts), enregistrer.
2. Importer `macro/viseur.png` dans sa bibliothèque Roll20 (pas depuis le Marketplace), le placer sur la carte, le
   sélectionner puis taper `!gabarit viseurimg` (MJ). Sans cela, le script utilise une image de secours teintée en rouge.
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
| `!gabarit lancer <id lanceur> <forme> <taille> [couleur=feu] [duree=60]` | Crée le gabarit et son Viseur. Formes : `burst`, `conedroit`, `conediag`, `ligne`, `emanation`. Taille : `4c` (cases), `6m`, `20ft` ou `20`. |
| `!gabarit clear [gN]` | Efface un gabarit, ou tous ceux du joueur. |
| `!gabarit clear tout` | MJ : efface tous les gabarits. |
| `!gabarit viseurimg` | MJ : enregistre le token sélectionné comme image du Viseur. |

**Tests** : `node tests/gabarit.test.js` (Node, sans dépendance) lance 214 vérifications : conversion des tailles,
formes et nombres de cases, contours, puis le flux complet avec un faux Roll20. Ils n'ont pas remplacé un essai en
campagne réelle.

**Dossiers** : `scripts/` (scripts API), `tests/` (tests Node des scripts), `macro/` (macros et images associées).
Les scripts plus anciens restent à la racine.
