# DPS Maps — Claude desktop extension

An MCP server, packaged as a Claude desktop extension (`.mcpb`), that gives Claude tools to work with Dungeon Painter
Studio on the PC where DPS is installed. It runs on the Node.js built into the Claude desktop app: nothing else to
install. It works from a local Claude session or from a cloud session linked to the PC.

## Install

1. Build it (see below) or take a `dps-maps.mcpb` built from this folder.
2. Claude desktop app > Settings > Extensions: install the `.mcpb` file (or double-click it / drag it onto the
   Extensions page).
3. Fill in the two folders it asks for:
   - **Dungeon Painter Studio folder**: the DPS install, the one that contains `data\collections`
     (Steam default: `C:\Program Files (x86)\Steam\steamapps\common\Dungeon Painter Studio`).
   - **Maps folder**: where your `.dps` maps and exports live.
4. Restart the Claude app. The tools show up as `dps_*`.

## Tools

| Tool | Effect |
| --- | --- |
| `dps_info` | The two folders and how many floors, walls and objects each asset collection holds. |
| `dps_find_assets` | Searches the installed library by words in the path (all must match), optionally by kind (floor, wall, object) and collection. Returns DPS paths exactly as a `.dps` stores them, and each image's size in squares (200 px per square). |
| `dps_asset_sheet` | One JPEG of up to 30 numbered thumbnails on a square grid, with a legend. |
| `dps_list_maps` | `.dps`, `.jpg` and `.roll20.txt` files in the Maps folder. |
| `dps_read_map` | A map's summary (object counts, layer groups, assets used) or its full JSON. |
| `dps_write_file` | Saves a new `.dps` or `.roll20.txt` in the Maps folder. An existing name is refused, unless this extension wrote that file and `replace=true`: the user's own maps are never replaced. |
| `dps_preview` | Renders a map from the real assets in layer order (floors, polygons, walls, objects with DPS's placement rule) as a JPEG; Roll20 walls can be drawn on top, and a region can be cropped. Effects, lights, brushes and text are not drawn. |
| `dps_window` | DPS's window geometry (no input sent). Used to calibrate the export. |
| `dps_export` | Opens a map in DPS and exports the JPG with DPS's own renderer, saved as `name(WxH).jpg` in the Maps folder (or in `_dps_tools\export_tests` with `test=true`). Takes the mouse and keyboard for 15 to 60 seconds. Closes the map open in DPS without saving it. Never overwrites an export it did not write. Windows only. |
| `dps_reindex` | Rescans the library after installing a pack. |

Paths given to the tools must stay inside the DPS collections or the Maps folder.

## Export and calibration

`dps_export` runs [`src/dps_ui.ps1`](src/dps_ui.ps1) with Windows PowerShell. It brings DPS to the front, clicks
"Ouvrir" (and confirms that the open map will be closed), types the map path in the Windows open dialog, clicks
"Exporter en PNG & JPG" then "Créer *.JPG", waits for the save dialog, types the output path and waits until the file
is complete.

The four click points are in [`src/dps_ui.json`](src/dps_ui.json), in physical pixels, measured on a maximized DPS
window on a 2560x1440 screen at 100 % scaling (`from: topleft` = offset from the client area's top-left corner,
`from: center` = from its centre). If the screen, the scaling or the window differs, call `dps_window`, take one
screenshot of DPS, compute the new offsets and save them as `<Maps folder>\_dps_tools\mcp\dps_ui.json`, which overrides
the default. A `dps_ui.ps1` in that folder also overrides the bundled script (handy to try a fix without rebuilding).

Files the extension keeps in `<Maps folder>\_dps_tools`: `mcp_written.json` (files it wrote, the only ones it may
replace), `export_tests\` (test exports) and the optional overrides above.

## Build and test

```
npm install
npm test               # self-contained end-to-end test: fake asset library, every tool over stdio
npm run pack           # bundle into pkg/, test the bundle, write dps-maps.mcpb
```

`src/index.js` declares the tools, `src/dps.js` holds the DPS logic (asset index, sizes, export area, preview
renderer), `src/imaging.js` the pure-JS image code (PNG/JPEG decode, resize, rotation, polygon fill, JPEG encode), so
the bundle has no native modules. The bundled server must start listening as soon as it is loaded: the Claude app runs
it through a launcher, so a `require.main === module` guard would leave it silent.
