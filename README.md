# roll20
My roll20 shit

[Version française](README_fr.md)

## Area-of-effect templates (Pathfinder 1e)

`scripts/gabarit.js` draws area-of-effect templates on the map (burst, cone, line, emanation) following the official
Pathfinder 1e rules: the outline follows the exact borders of the squares touched (square counting, every second
diagonal counts double), not an approximate circle. Sizes can be given in squares, feet or meters and are converted to
squares, so the map scale has no influence (5 ft = 1.5 m = 1 square).

![Example: four templates at once](macro/gabarit-exemple.png)

*Four templates at once on a map in meters: straight 18 m cone (red), diagonal 6 m cone (green), diagonal 4.5 m cone (blue) and 6 m burst (purple). Each has its own Aimer, whose arrow shows the direction.*

**Installation**
1. Paste `scripts/gabarit.js` into a new API script (Game Settings > API Scripts) and save.
2. Import `macro/viseur.png` into your Roll20 library (not from the Marketplace), place it on the map, select it, then
   type `!gabarit aimerimg` (GM). Without this, the script uses a fallback image tinted red.
3. Create a macro named "Gabarit", visible to all, with the content of `macro/gabarit.macro.txt`.

**Use (player)**: select your token, click "Gabarit", then pick the shape and size from the lists. An Aimer (one per
template, in the template's color) appears next to the character.
- Burst: the circle is centered on the Aimer.
- Straight cone, diagonal cone, line: the template starts from the Aimer. Rotate it (E key + mouse wheel, in 45° steps)
  to choose the direction; the rotation snaps to valid directions.
- Emanation: no Aimer. It starts from the edges of the caster's square and follows the caster when it moves.
- Creatures that walk into or out of a template get or lose its colored aura right away.
- Several templates can stay on the map at the same time. Use "Effacer" (clear) in the message you received, or delete the Aimer.
- With `scripts/altitude.js` (flying combat), templates work in 3D: the template's altitude is its Aimer's (it starts at the
  caster's altitude; select the Aimer and use "Altitude" in the Vol menu to change it). Heights are counted like squares on
  the ground (every second diagonal counts double): a burst is a sphere, a cone a pyramid that opens as much up and down as
  sideways, a line only hits at its own height, an emanation starts from the caster's volume. The outline stays 2D (the
  slice at the template's altitude); the aura shows who is hit. Without altitude.js, or with everyone on the ground,
  results are the same as in 2D.

| Command | Effect |
| --- | --- |
| `!gabarit cast <caster id> <shape> <size> [color=fire] [duration=60]` | Creates the template and its Aimer. Shapes: `burst`, `straightcone`, `diagcone`, `cone`, `line`, `emanation`. Size: `4sq` (squares), `6m`, `20ft` or `20`. Colors: `fire`, `cold`, `acid`, `electricity`, `sonic`, `force`, `negative`, `neutral`. |
| `!gabarit clear [gN]` | Clears one template, or all of the player's templates. |
| `!gabarit clear all` | GM: clears all templates. |
| `!gabarit aimerimg` | GM: saves the selected token as the Aimer image. |

**Tests**: `node tests/gabarit.test.js` (Node, no dependency) runs 313 checks: size conversion, shapes and square
counts, outlines, then the full flow with a fake Roll20 (every shape and size of the macro, auras when creatures move,
emanation following its caster). They are no substitute for a try-out in a real campaign.

## Random weather (Climat)

`scripts/Climat.js` draws random weather by heat level (very cold, cold, temperate, hot, very hot) rather than by
region, so it also works outside Golarion. Each day is split into 4 phases (morning, afternoon, evening, night), each
with its own temperature. Phenomena (rain, snow, fog, hail, thunderstorm, snowstorm, blizzard, hurricane, tornado,
sandstorm, torrential rain) have warning signs, a start time and a duration drawn from the Climat page of the
Pathfinder-FR wiki. They can carry over onto the following days. Heat waves, cold waves and the desert wind last 3 days.
If a drawn phenomenon runs past the number of days requested, the period is extended until it ends (5 days at most) and
the card says so. The script handles no game mechanics, only text and temperatures. It keeps no state.

**Installation**: paste `scripts/Climat.js` (and only that file, not the test file) into a new API script and save.
Create the "Climat" macro with the content of `macro/Climat.macro.txt` (`!climat`).

**Use (GM)**: click "Climat", choose the heat level, then a month (one day) or "Plusieurs jours" (several days, 1 to 14).

| Command | Effect |
| --- | --- |
| `!climat` | Heat level buttons. |
| `!region <level>` | Month buttons for that level. |
| `!RollClimat <level> <month> [days]` | Draws the weather (e.g. `!RollClimat cold neth 3`). Argument order is free. |

The level ids are `verycold`, `cold`, `temperate`, `hot` and `veryhot`, and months use their Golarion names (Abadius, Calistril, Pharast...).

**Tests**: `node tests/Climat.test.js` (Node, no dependency) runs 306 checks: scripted dice, statistical properties over
tens of thousands of days, then the full flow with a fake Roll20. They are no substitute for a try-out in a real game.

## Buff and spell duration tracker (BuffTracker)

`scripts/bufftracker.js` tracks running effects (spells, buffs, conditions) and their duration in rounds
(1 min = 10 rounds, 1 h = 600 rounds). One cast carries its list of targets: a Bless on four PCs is a single line
with a single duration. Players see a handout "Effets actifs" (grouped by character, rewritten on every change) and a
chat notice on an effect's last round and when it ends. The script puts no status marker on tokens (players use them
for other things), and markers left by version 2.0 are removed at start-up. It never touches character sheets; its
data lives in `state.BuffTracker`.

**Installation**: paste `scripts/bufftracker.js` into a new API script and save. Create the "BuffTracker" macro, visible to all players,
with the content of `macro/BuffTracker.macro.txt` (`!buff`). The script creates the "Effets actifs" handout itself.

**Countdown**: in combat, when the turn tracker moves to the next turn, effects whose caster takes the turn lose
1 round (PF1: an effect ends just before its caster's turn). Effects without a caster in the tracker lose 1 round at
the start of each round. The start of a round is a custom tracker entry whose text contains the word "round" or "tour"
reaching the top (for example the `Round` counter added by AddCustomTurn's `!act --Round`); without one, the
initiative going back up marks it. Filling or sorting the tracker counts nothing, and going back then forward again
does not count a turn twice. Out of combat, the GM moves time on with `!buff time 10min`.

| Command | Effect |
| --- | --- |
| `!buff` | Menu: one line per cast with its targets and buttons (-1, +1, Durée, Effet, Cibles, X). |
| `!buff add --name <name> --dur <duration> [--caster <name>] [--targets <list>] [--effect <text>] [--hidden]` | Adds a cast. Targets: `group`, `me`, `selected`, `pick` (tick boxes) or names/token ids separated by commas (any name works, see below). Durations: `3r`, `3`, `10min`, `2h`, `13h50`, `1j` (days), `perm`. Recasting an effect of the same name by the same caster replaces it on the new targets; from another caster, both casts are kept, but the handout shows one line per character (the longest) and no end notice is sent while the other cast still covers that character. |
| `!buff add --spell <id> --cl <level> ...` | Adds a common spell with its duration computed from the caster level. |
| `!buff fav` | Buttons for the common spells. |
| `!buff edit <n> --dur -1` | Changes a cast (`+2`, `4r`, `10min`, `perm`; also `--name`, `--effect`, `--caster`, `--targets`, `--hidden yes\|no` for the GM). |
| `!buff remove <n> [<n> ...]` | Removes casts: dry run, then `... confirm N`. |
| `!buff clear` | Removes the selected tokens from all their effects (dry run, then `confirm N`). |
| `!buff clear all` | GM: removes every effect (dry run, then `confirm N`). |
| `!buff time <duration>` | GM: moves time on for every effect (dry run, then `confirm N`); also the "Passer le temps" button of the GM menu. |
| `!buff show` | Rewrites the handout and gives a link to open it. |
| `!buff help` | Help. |

**Rights**: anyone can cast an effect on anyone. A player edits or removes the casts they created and those whose caster
they control. From a cast that only targets one of their characters, they can only remove their own characters ("Me
retirer" button, or `!buff clear` on their token). The GM manages everything and alone creates hidden effects.
An effect on a token linked to a sheet follows the character on every page; on an unlinked token (numbered monsters)
it follows that token only.

**No map needed**: a target or caster name must match exactly (case and accents ignored) a token of your page, or else
one of the campaign's character sheets. If it is only part of other names ("Moi" for "Moine noir"), the script whispers
buttons to pick one, or "Nom libre" to keep the name as typed; `=Moi` forces a free name without asking. A name that
matches nothing is a free name: an NPC played during a role-play scene with no map keeps the effect afterwards. "Tout le groupe", "Moi seul" and "Choisir..."
use the PCs of the page, or all the campaign's PCs when none is on it.

**Tests**: `node tests/bufftracker.test.js` (Node, no dependency) runs 363 checks: the pure logic (durations, targets, countdown) and then the full flow with a fake Roll20. They are no substitute for a try-out in a real game.

## Flying combat (altitude)

`scripts/altitude.js` keeps each token's altitude (the map is 2D), shows it to the right of the token, level with its bar ("↑ 9 m") and does the
Pathfinder 1e flight math, so a player can price a move before making it. Rules applied:
- Fly skill (Core p. 96): climb at half speed up to 45°, descend at normal speed at any angle. Climbing steeper than 45°:
  Fly DC 20; moving less than half speed: DC 10; staying in place: DC 15.
- Paizo FAQ "Fly" (July 2011): no diagonal counting on the vertical axis. With H squares across and V squares of height:
  climbing costs `V + max(H, V)` (3 squares at 45° = 6 squares), descending costs `max(H, V)`.
- Falling: 1d6 per 10 ft (max 20d6); a creature able to fly negates it with a DC 10 Fly check, except after a failed Fly
  check or a collision.
- Getting adjacent to a target: the gap is counted in squares on each axis (5/10/5 diagonals on the ground); a token is
  as many squares tall as it is wide. Adjacent = at most one square apart on each axis. Reach is not calculated.

Distances are given in feet (`30`, `30ft`), meters (`9m`) or squares (`6sq`); a bare number uses the page unit (the one
of the Measure tool). With gabarit.js v1.5, area-of-effect templates take altitudes into account (see above). Fly speed is read from the Pathfinder Community sheet (`speed-fly`, in meters if the sheet is set
to meters); `speed=60` overrides it (Fly spell, for example).

**Installation**: paste `scripts/altitude.js` into a new API script and save. Create the "Vol" macro, visible to all
players, with the content of `macro/Vol.macro.txt` (`!alt`). It whispers a menu of buttons that act on the token
selected when the button is clicked. The menu asks for distances in meters, whatever the page unit.

| Command | Effect |
| --- | --- |
| `!alt` | Button menu. |
| `!alt set [id...] <altitude>` | Sets the altitude of the selected tokens: `9m` (absolute), `+3`, `-3m` (change), `=-9m` (absolute, below level 0), `0`. Level 0 is whatever you choose: the ground, or the top of a cliff so creatures below it are at negative altitudes. |
| `!alt fly [id] <horizontal> <vertical> [speed=60]` | Cost of a flying move before moving: cost, movement left (move action / double move), max horizontal distance for that climb, Fly checks needed, and an "Apply" button for the new altitude. Vertical: `+` up, `-` down. |
| `!alt dist <id> <target id>` | Gap between two tokens and the flying movement needed to get adjacent to the target (with the Fly check if the climb is steeper than 45°). Menu button "Rejoindre". |
| `!alt fall [id...] [to=-9m] [cat]` | Rolls falling damage down to the ground (altitude 0, or the one given with `to=`, e.g. the foot of a cliff) and sets the altitude there. `cat`: Boots of the Cat, 1 damage per die. |
| `!alt show` | Whispers the altitudes on the page (players don't see GM-layer tokens). |
| `!alt clear all` | GM: sets every altitude back to 0. |
| `!alt style color=#ff3300 size=26` | GM: color and size of the altitude labels. |

Players act only on tokens they control (token or character); the GM on all.

**Tests**: `node tests/altitude.test.js` (Node, no dependency) runs 145 checks: unit conversion, distances, getting adjacent,
flight cost (including the FAQ example), Fly DCs, falling dice, then the full flow with a fake Roll20 (label following
the token, player rights, sheet fly speed in meters, menu buttons). They are no substitute for a try-out in a real game.

## Sync the API scripts with GitHub (userscript)

`sync/roll20-github-sync.user.js` adds a "⟳ GitHub" button to the Roll20 API Scripts page
(`app.roll20.net/campaigns/scripts/<campaign>`). It reads the `.js` files of `scripts/` at the latest commit of `main`
and matches each one to the Roll20 script tab with the same name (case, spaces, dashes and accents ignored, so
"token tool.js" is `token-tool.js`). The panel shows each file as up to date, changed (+lines / -lines) or not in the
game. "Mettre à jour la sélection" saves the ticked ones through Roll20's own "Save Mod Script" button, one per page
load, and creates the missing ones you tick. After each reload it checks that Roll20 stored exactly the repo's
content, and stops at the first mismatch. Roll20 library (one-click) scripts and tabs with no file in the repo are
never touched. Each save restarts the API sandbox, as a manual save does.

**Install**: install [Tampermonkey](https://www.tampermonkey.net/) in your browser, then open
`https://raw.githubusercontent.com/Sheo42/roll20/main/sync/roll20-github-sync.user.js`: Tampermonkey offers to install
it. It updates itself from the same address. In Chrome, Tampermonkey only runs scripts once you allow it: `chrome://extensions` > Tampermonkey > Details > turn on "Allow User Scripts" (on older Chrome versions, turn on Developer mode instead). The button appears at the bottom right of the API Scripts page.

**Tests**: `node tests/sync.test.js` (name matching, diff, plan, and the save-reload-check queue with a fake page).

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

## Dungeon Painter Studio maps

[`dps/`](dps) holds the tools to make Dungeon Painter Studio battle maps with code and with Claude: a Python generator
that writes native `.dps` maps, and "DPS Maps", a Claude desktop extension (MCP server) that searches the installed
asset library, previews maps from the real assets and drives DPS to export the JPG. See [`dps/README.md`](dps/README.md).

## Walls and doors from a Dungeon Painter Studio map (dps-walls)

`scripts/dps-walls.js` draws Roll20 dynamic-lighting barriers and doors from one chat line. The line is written by
the DPS map generator (`DPSMap.roll20_command()` in [`dps/generator/dps_lib.py`](dps/generator/dps_lib.py)), so the
walls match the map image exactly. Coordinates are in squares; Jumpgate games get `pathv2` objects, older games classic paths.

**Installation**: paste `scripts/dps-walls.js` into a new API script and save.

**Use (GM)**: Create Page > Upload Background with the exported JPG (Roll20 sizes the page from it), stay on that
page, then paste the map's `.roll20.txt` line in the chat.

| Command | Effect |
| --- | --- |
| `!dpswalls size=42x42 ; W:x,y x,y ... ; T:... ; O:... ; D:x,y x,y ; S:x,y x,y` | On the GM's current page: sets the size, draws walls (`W`, block sight and movement), transparent barriers (`T`, block movement only), one-way barriers (`O`), closed doors (`D`) and secret doors (`S`). Running it again replaces what it drew before. No brackets: Roll20 would read `[[` as an inline roll. |
| `!dpswalls clear` | Removes the walls and doors it drew on the page. |
| `!dpswalls img <url>` | Puts an image from your library on the map layer, page-sized. |

**Tests**: `node tests/dps-walls.test.js` (Node, no dependency): parsing, pathv2/legacy path/door geometry (doors use
an inverted y axis), then the full flow with a fake Roll20. Tried on the Ermitage de la Lame Veillante map in the
real campaign.

## Slow page after editing a token of a PC

Symptom: renaming or editing a token that represents a Pathfinder Community character freezes the page for a long
time, with `could not find top macro for 0` repeating in the browser console. Cause: an ability with `showinmenu`
true and an empty or missing type is read as type "0" by the sheet worker (`getTopOfMenu`). Run
`!abilitycheck <character>`, then `!abilityfix <character>` (dry run first). A separate note: PFCompanion's
"Mook Numbering" can wrongly number PC tokens (`Name 1`); see `!tokeninfo` and `!tokenwatch`.

**Folders**: `scripts/` (API scripts), `tests/` (Node tests of the scripts), `macro/` (macros and related images), `sync/` (userscript that syncs the API scripts with this repo),
`dps/` (Dungeon Painter Studio map tools).
The macros are the `*.macro.txt` files: their content is pasted as is into a Roll20 macro. What each macro does and
which scripts it depends on is listed in [`macro/README.md`](macro/README.md) (in French).
