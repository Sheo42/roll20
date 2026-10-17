# Dungeon Painter Studio tools

Tools to make [Dungeon Painter Studio](https://store.steampowered.com/app/592260/) (DPS) battle maps with code and
with Claude, and to bring them into Roll20 with their vision walls and doors.

| Folder | What it is |
| --- | --- |
| [`generator/`](generator) | Python library that writes native `.dps` maps from a short script, places objects exactly where DPS draws them, and records Roll20 walls and doors. |
| [`extension/`](extension) | "DPS Maps", a Claude desktop extension (MCP server) that runs on the PC: searches the installed asset library, shows assets, reads and saves maps, renders previews from the real assets, and drives DPS to export the JPG. |
| [`../scripts/dps-walls.js`](../scripts/dps-walls.js) | Roll20 Mod script that draws the walls and doors of a generated map from one chat line (see the main README). |

Nothing here contains assets: the tools read the asset packs installed in DPS (`<DPS install>/data/collections`).

## Workflow

1. **Write the map** as a small Python script with `generator/dps_lib.py` (start from
   [`generator/maps/ermitage_lame_veillante.py`](generator/maps/ermitage_lame_veillante.py)).
   Assets are chosen with the extension's `dps_find_assets` and `dps_asset_sheet`, or by path.
2. **Save** the `.dps` (and its `.roll20.txt` wall line) in the Maps folder.
3. **Preview** it from the real assets (`dps_preview`, optionally with the Roll20 walls drawn on top), fix, repeat.
4. **Export** the JPG with DPS (`dps_export`, or by hand: Ouvrir, then Exporter en PNG & JPG, Créer *.JPG).
5. **Roll20**: Create Page > Upload Background with the JPG (Roll20 sizes the page from it), stay on that page and
   paste the `.roll20.txt` line in the chat. `scripts/dps-walls.js` draws the walls and doors.

Maps are never overwritten: new versions get a new name (`_v2`, `_v3`...).

## Generator (`generator/`)

```python
from dps_lib import DPSMap
m = DPSMap('maCarte', 30, 20)                 # name, width, height in squares (70 px per square)
with m.group('Sol'):                           # a DPS layer group
    m.plot('floor.rock_tiles', 0, 0, 30, 20)   # textured rectangle
    m.circle('floor.water_bright', 15, 10, 4, rough=0.03)
with m.group('Murs'):
    m.wall('wall.brick', (5, 5), (12, 5), (12, 12), (5, 12), closed=True)    # also a Roll20 vision wall
    m.wall('wall.rock_low', (14, 5), (18, 5), blocks=False)                 # low wall: no Roll20 wall
with m.group('Objets'):
    m.obj('door.double', 8.5, 5)               # CENTRE of the image, in squares
    m.obj('rubble.3x2', 20, 14, angle=30)      # angle clockwise, degrees
m.door((7.5, 5), (9.5, 5))                     # Roll20 door
m.barrier_circle(20, 14, 1.2, type='transparent')   # Roll20: blocks movement, not sight
m.save('maCarte.dps')
open('maCarte.roll20.txt', 'w').write(m.roll20_command())
```

| File | Role |
| --- | --- |
| `dps_lib.py` | `DPSMap`: `plot`, `polygon`, `circle`, `wall`, `obj`, `group`, `barrier`, `barrier_circle`, `door`, `save`, `roll20_command`. Standard library only. |
| `aliases.json` | Short names for assets used often (`floor.water_deep`, `door.double`, `stairs.turn_rock`...). Add your own. |
| `sizes.json` | Image sizes in squares of the aliased assets, used to centre objects exactly. Extend it with `measure_sizes.py` or pass `size=(w, h)` to `obj()`. |
| `render_preview.py` | Quick preview from asset images copied next to the script (the extension's `dps_preview` is better). Needs Pillow. |
| `verify_export.py` | Compares a DPS export with the map, object by object (template matching). Needs numpy, Pillow, OpenCV. |
| `measure_sizes.py` | Fills `sizes.json` from a folder that mirrors `data/collections`. |
| `maps/ermitage_lame_veillante.py` | Worked example: a 42x42 air dome under a lake, round brick tower with a grid-aligned spiral stair, lists, chapel; Roll20 walls included. Output goes to `$DPS_MAPS_DIR` or the current folder. |
| `maps/calibration.py` | Test map: each object must fill its outline in DPS (checks the placement rule). |
| `tests/` | `python -m unittest discover -s tests` (from `generator/`). |

`pip install -r requirements.txt` is only needed for the preview and verification scripts.

### Format facts (checked against DPS exports)

- A `.dps` file is JSON: `{"tables": {Table: [rows]}}`. Coordinates are in squares, y downwards.
- `TextureItemHelper.path` is relative to the DPS install (`data/collections/...`). Textures and objects edited in DPS
  are folders holding `img.png`; DPS stores the folder path without extension.
- `Layer.data` is the id of the object a layer shows, `Layer.parent` its group (`Bunch`). Bunch 1 is the root and lists
  layers and sub-groups bottom to top. `Layer.preset` = an `FxPreset` id attaches an effect (shadow, glow, bevel).
- Objects are drawn at 200 px per square times `scale`. `Obstacle.begin` is not the image centre: DPS draws the centre
  at `begin + R(angle) . scale . (0.5 if width even, 0.5 if height even)`, with width and height = image px / 200 and
  the angle clockwise. `obj()` takes the centre and applies this.
- A JPG export covers the bounding box of floors, polygons and walls, and is named `name(WxH).jpg`.
- Grid-aligned spiral stairs: FA Builders Pack `Stairs_Turn_Rock_D_01` at scale 0.5 is a quarter ring (radius 1 to 2
  squares) whose curve centre is (+1, +0.5) squares from the image centre at angle 0.

## Extension (`extension/`)

See [`extension/README.md`](extension/README.md): installation, tools, calibration of the export clicks, build and
tests.
