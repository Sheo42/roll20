"""dps_lib — write native Dungeon Painter Studio (.dps) maps from Python.

A .dps file is plain JSON: {"tables": {TableName: [rows...]}}.
All coordinates are in grid squares (x to the right, y downwards).

    from dps_lib import DPSMap
    m = DPSMap('maCarte', 30, 20)
    m.plot('floor.rock_tiles', 0, 0, 30, 20)
    m.obj('door.double', 10, 5)                      # centre of the object, in squares
    m.save('maCarte.dps')

Assets are given either as an alias (aliases.json) or as a path relative to the DPS install
("data/collections/FA - .../thing.png"). An optional catalog.json (asset index) makes resolve()
check that paths exist; the DPS Maps extension (../extension) searches the installed library directly.

What is known about the format (checked against real DPS maps and DPS exports):
  * Object ids (Plot, Polygon, Wall, Obstacle, Brush...) share one id space,
    Layer and Bunch (group) ids share another, Figure, FxPreset/Fx and
    TextureItemHelper have their own. Unique ids everywhere is always safe.
  * Layer.data -> id of the object the layer shows; Layer.parent -> Bunch id.
  * Bunch 1 is "root"; its "layers" lists layer ids AND sub-group ids, bottom to top.
    A sub-group is a Bunch with parent=1 whose id appears in root.layers.
  * Effects: a layer gets an effect preset with Layer.preset = FxPreset.id
    (presets: long shadow, middle shadow, short shadow, bevel, yellow glow, orange light).
  * Obstacle.begin is NOT the image centre for even-sized objects. Measured in DPS:
    centre = begin + R(angle) . scale * (0.5 if width even else 0, 0.5 if height even else 0)
    with width/height = image px / 200 and angle clockwise in degrees (see draw_offset).
    DPS.obj() takes the CENTRE and does this for you.
  * Object images are drawn at 200 px per square (scale 1), whatever the name says
    (an edited "2x2" door saved at 600x800 px is drawn 3x4).
"""
import json, math, os, copy, re

HERE = os.path.dirname(os.path.abspath(__file__))
PX_PER_SQUARE = 200          # Forgotten Adventures asset resolution

# ---------------------------------------------------------------- catalogue
_catalog = None
_aliases = None
_sizes = None

def sizes():
    """Measured image sizes in squares (sizes.json, built by measure_sizes.py)."""
    global _sizes
    if _sizes is None:
        p = os.path.join(HERE, 'sizes.json')
        _sizes = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}
    return _sizes

def catalog():
    global _catalog
    if _catalog is None:
        p = os.path.join(HERE, 'catalog.json')
        _catalog = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}
    return _catalog

def aliases():
    global _aliases
    if _aliases is None:
        p = os.path.join(HERE, 'aliases.json')
        _aliases = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}
    return _aliases

def resolve(asset):
    """alias or path -> (path, info dict or {})."""
    a = aliases().get(asset, asset)
    if isinstance(a, dict):
        a = a['path']
    info = catalog().get('assets', {}).get(a)
    if info is None and catalog():
        # tolerate old-style paths with an extension that DPS turned into a folder
        alt = re.sub(r'\.(png|jpg|webp)$', '', a)
        info = catalog().get('assets', {}).get(alt)
        if info is not None:
            a = alt
    if info is None and catalog():
        known = {v['collection'] for v in catalog()['assets'].values()}
        parts = a.split('/')
        if len(parts) > 2 and parts[2] in known:
            raise KeyError(f'asset not in library: {asset!r} -> {a!r}')
        _warn(f'{a!r}: collection not catalogued yet, path not checked')
    return a, (info or {})

_warned = set()
def _warn(msg):
    if msg not in _warned:
        _warned.add(msg)
        print('warning:', msg)

def find(*words, kind=None, limit=40):
    """Search the optional catalog.json: find('pillar', 'stone', kind='object')."""
    words = [w.lower() for w in words]
    out = []
    for path, info in catalog().get('assets', {}).items():
        low = path.lower()
        if kind and info.get('kind') != kind:
            continue
        if all(w in low for w in words):
            out.append((path, info))
    return out[:limit]

# ---------------------------------------------------------------- geometry
def offset_for(w, h):
    """Where DPS draws the image centre relative to Obstacle.begin (unrotated footprint)."""
    return (0.5 if round(w) % 2 == 0 else 0.0, 0.5 if round(h) % 2 == 0 else 0.0)

def draw_offset(w, h, angle=0, scale=1.0):
    """Vector from Obstacle.begin to the drawn image centre, measured in DPS (calibration maps):
    centre = begin + R(angle) . (scale * offset_for(w, h)), angle clockwise on screen,
    parity taken from the UNSCALED size (image px / 200)."""
    ox, oy = offset_for(w, h)
    ox, oy = ox * scale, oy * scale
    a = math.radians(angle)
    return ox * math.cos(a) - oy * math.sin(a), ox * math.sin(a) + oy * math.cos(a)

def circle_points(cx, cy, r, n=48, start=0.0):
    return [(cx + r * math.cos(start + 2 * math.pi * i / n), cy + r * math.sin(start + 2 * math.pi * i / n))
            for i in range(n)]

def _pt(x, y):
    return {'x': round(float(x), 4), 'y': round(float(y), 4)}

# ---------------------------------------------------------------- map
DEFAULT_PRESETS = {
    # copied from the user's maps (identical in every file checked)
    'FxPreset': [{'fxs': [4, 5], 'id': 1, 'isOpen': False, 'name': 'long shadow'},
                 {'fxs': [10], 'id': 2, 'isOpen': False, 'name': 'middle shadow'},
                 {'fxs': [15], 'id': 3, 'isOpen': False, 'name': 'short shadow'},
                 {'fxs': [17], 'id': 4, 'isOpen': False, 'name': 'bevel'},
                 {'fxs': [24], 'id': 5, 'isOpen': False, 'name': 'yellow glow'},
                 {'fxs': [26], 'id': 6, 'isOpen': False, 'name': 'orange light'}],
    'GlowOutFx': [{'strength': 1.7, 'id': 4, 'isEnabled': True, 'blur': 6, 'color': 0, 'alpha': 0.75, 'parent': 1},
                  {'strength': 5, 'id': 24, 'isEnabled': True, 'blur': 8, 'color': 8617275, 'alpha': 0.9, 'parent': 5}],
    'DropShadowFx': [{'blur': 14, 'distance': 8, 'id': 5, 'isEnabled': True, 'inner': False, 'color': 0, 'alpha': 0.8, 'parent': 1, 'angle': 40},
                     {'blur': 4, 'distance': 6, 'id': 10, 'isEnabled': True, 'inner': False, 'color': 0, 'alpha': 0.3, 'parent': 2, 'angle': 40},
                     {'blur': 2, 'distance': 3, 'id': 15, 'isEnabled': True, 'inner': False, 'color': 0, 'alpha': 0.2, 'parent': 3, 'angle': 40}],
    'BevelFx': [{'strength': 2, 'shadowAlpha': 0.5, 'highlightColor': 16777215, 'shadowColor': 0, 'isEnabled': True,
                 'highlightAlpha': 0.25, 'blur': 6, 'distance': 4, 'id': 17, 'parent': 4, 'angle': 73}],
    'TintFx': [{'isEnabled': True, 'color': 16752384, 'id': 26, 'parent': 6, 'intensity': 100}],
}

ALL_TABLES = ['GlowInnerFx', 'AbsFx', 'GlowOutFx', 'Token', 'Layer', 'Location', 'Bunch', 'Obstacle',
              'AbsMapObjectTextured', 'Inscription', 'Wall', 'TextureItemHelper', 'Polygon', 'Linea', 'Arc',
              'Light', 'FxPreset', 'Plot', 'AbsLayer', 'Spline', 'Elipse', 'BorderFx', 'Template', 'TintFx',
              'Figure', 'ObjBrush', 'AbsMapObject', 'BevelFx', 'Brush', 'DropShadowFx', 'Puddle']


class DPSMap:
    def __init__(self, name, width, height, back_color=0x282828, grid_alpha=0.1, check_assets=True):
        self.name, self.w, self.h = name, width, height
        self.check = check_assets
        self.T = {k: [] for k in ALL_TABLES}
        for k, v in DEFAULT_PRESETS.items():
            self.T[k] = copy.deepcopy(v)
        self._obj_id = 0          # Plot/Polygon/Wall/Obstacle...
        self._layer_id = 1        # Layer/Bunch (1 = root)
        self._fig_id = 0
        self._helper_id = 0
        self._helpers = {}
        self._count = 0
        self.root = {'opacity': 100, 'layers': [], 'id': 1, 'choosingPreset': False, 'name': 'root', 'invisible': False}
        self.T['Bunch'].append(self.root)
        self._group = self.root
        self.back_color, self.grid_alpha = back_color, grid_alpha
        self.placed = []          # for the preview renderer: (kind, data)
        self.barriers = []        # Roll20 dynamic lighting: {'type': wall|transparent|oneWay, 'points': [...]}
        self.doors = []           # Roll20 doors: {'a': (x, y), 'b': (x, y), 'secret': bool}

    # -- ids
    def _oid(self):
        self._obj_id += 1; return self._obj_id
    def _lid(self):
        self._layer_id += 1; return self._layer_id

    def helper(self, asset):
        path, info = resolve(asset) if self.check else (aliases().get(asset, asset), {})
        if isinstance(path, dict):
            path = path['path']
        if path not in self._helpers:
            self._helper_id += 1
            self._helpers[path] = self._helper_id
            self.T['TextureItemHelper'].append({'id': self._helper_id, 'path': path})
        return self._helpers[path], path, info

    # -- groups (DPS "Bunch"): with m.group('Sol'): ...
    def group(self, name):
        m = self
        class _G:
            def __enter__(s):
                gid = m._lid()
                s.prev = m._group
                s.b = {'opacity': 100, 'layers': [], 'id': gid, 'choosingPreset': False, 'name': name,
                       'invisible': False, 'parent': s.prev['id']}
                m.T['Bunch'].append(s.b)
                s.prev['layers'].append(gid)
                m._group = s.b
                return s.b
            def __exit__(s, *a):
                m._group = s.prev
        return _G()

    def _layer(self, obj_id, kind, path, preset=None, opacity=100):
        self._count += 1
        lid = self._lid()
        short = os.path.basename(path)[:18]
        row = {'opacity': opacity, 'data': obj_id, 'invisible': False, 'id': lid, 'choosingPreset': False,
               'name': f'{kind} {short}... {self._count}', 'parent': self._group['id']}
        if preset:
            row['preset'] = next(p['id'] for p in self.T['FxPreset'] if p['name'] == preset)
        self.T['Layer'].append(row)
        self._group['layers'].append(lid)
        return lid

    # -- drawing primitives
    def plot(self, tex, x0, y0, x1, y1, scale=1, rotation=0, preset=None, opacity=100):
        """Textured rectangle (floor). Corners in squares."""
        hid, path, _ = self.helper(tex)
        oid = self._oid()
        self.T['Plot'].append({'lockedX': 0, 'textureShiftX': 0, 'isLocked': False, 'seed': 0, 'lockedY': 0,
                               'textureShiftY': 0, 'points': [_pt(x0, y0), _pt(x1, y1)], 'textureScale': scale,
                               'textureRotation': rotation, 'id': oid, 'helper': hid})
        self.placed.append(('poly', path, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], opacity, scale))
        return self._layer(oid, 'plot', path, preset, opacity)

    def polygon(self, tex, points, rough=0.02, scale=1, rotation=0, preset=None, opacity=100):
        """Textured polygon; rough (amplitudaK) gives DPS's ragged edge (0 = clean)."""
        hid, path, _ = self.helper(tex)
        self._fig_id += 1
        fid = self._fig_id
        self.T['Figure'].append({'id': fid, 'points': [_pt(x, y) for x, y in points]})
        oid = self._oid()
        self.T['Polygon'].append({'lockedY': 0, 'version': 1, 'isLocked': False, 'lockedX': 0, 'points': [],
                                  'figures': [fid], 'helper': hid, 'holes': [], 'textureShiftX': 0, 'type': 0,
                                  'textureShiftY': 0, 'id': oid, 'isEnded': True, 'textureScale': scale,
                                  'amplitudaK': rough, 'textureRotation': rotation, 'minimumSegment': 0.4, 'seed': 0})
        self.placed.append(('poly', path, list(points), opacity, scale))
        return self._layer(oid, 'polygon', path, preset, opacity)

    def circle(self, tex, cx, cy, r, n=48, **kw):
        return self.polygon(tex, circle_points(cx, cy, r, n), **kw)

    def wall(self, tex, *points, closed=False, thickness=1, blocks=True):
        """Wall polyline: m.wall('wall.brick', (0,0), (5,0), (5,4)). One DPS Wall per segment.
        blocks=True also records it as a Roll20 vision wall (see roll20_command)."""
        hid, path, _ = self.helper(tex)
        pts = list(points) + ([points[0]] if closed else [])
        if blocks:
            self.barrier(*pts)
        ids = []
        for a, b in zip(pts, pts[1:]):
            oid = self._oid()
            self.T['Wall'].append({'points': [_pt(*a), _pt(*b)], 'seed': 0, 'id': oid,
                                   'thickness': thickness, 'helper': hid})
            self.placed.append(('wall', path, [a, b], thickness))
            ids.append(self._layer(oid, 'wall', path))
        return ids

    def obj(self, asset, cx, cy, angle=0, scale=1.0, flipH=False, flipV=False, preset=None, opacity=100,
            size=None):
        """Place an object with its image CENTRE at (cx, cy) squares. angle in degrees (clockwise)."""
        hid, path, info = self.helper(asset)
        w, h = size or sizes().get(path) or info.get('size') or (None, None)
        if w is None:
            _warn(f'size of {path!r} unknown (not in sizes.json, no WxH in its name): assuming 1x1, '
                  'it may land half a square off -> run measure_sizes.py or pass size=(w, h)')
            w, h = 1, 1
        ox, oy = draw_offset(w, h, angle, scale)
        oid = self._oid()
        self.T['Obstacle'].append({'ver': 1, 'seed': 0, 'y': 0, 'x': 0, 'points': [], 'id': oid, 'scale': scale,
                                   'helper': hid, 'angle': angle, 'begin': _pt(cx - ox, cy - oy),
                                   'flipH': flipH, 'flipV': flipV, 'textureIndex': 0})
        self.placed.append(('obj', path, (cx, cy), angle, scale, flipH, flipV, opacity))
        return self._layer(oid, 'object', path, preset, opacity)

    # -- Roll20 dynamic lighting (not drawn in DPS)
    def barrier(self, *points, type='wall', closed=False):
        """Roll20 barrier polyline in squares. type: 'wall' (blocks sight and movement),
        'transparent' (blocks movement only), 'oneWay'."""
        pts = [tuple(p) for p in points] + ([tuple(points[0])] if closed else [])
        self.barriers.append({'type': type, 'points': pts})

    def barrier_circle(self, cx, cy, r, n=16, type='wall'):
        """Closed round barrier, e.g. around a column."""
        self.barrier(*circle_points(cx, cy, r, n), type=type, closed=True)

    def door(self, a, b, secret=False):
        """Roll20 door from a to b (squares), closed by default."""
        self.doors.append({'a': tuple(a), 'b': tuple(b), 'secret': secret})

    def roll20_command(self):
        """Chat command for dps-walls.js: '!dpswalls size=WxH ; W:x,y x,y ; T:... ; D:x,y x,y'.
        Coordinates in squares; no brackets (Roll20 would read [[ as an inline roll)."""
        code = {'wall': 'W', 'transparent': 'T', 'oneWay': 'O'}
        f = lambda v: ('%.3f' % v).rstrip('0').rstrip('.')
        pts = lambda ps: ' '.join(f'{f(x)},{f(y)}' for x, y in ps)
        parts = [f'!dpswalls size={self.w}x{self.h}']
        parts += [f"{code[b['type']]}:{pts(b['points'])}" for b in self.barriers]
        parts += [f"{'S' if d['secret'] else 'D'}:{pts([d['a'], d['b']])}" for d in self.doors]
        return ' ; '.join(parts)

    # -- output
    def to_json(self):
        T = copy.deepcopy(self.T)
        T['Location'] = [{'zoom': 40, 'exportGrid': False, 'selectedLayers': [], 'id': 1, 'hBold': 5, 'vBold': 5,
                          'dpi': 70, 'transparentBack': False, 'backColor': self.back_color,
                          'lastLayerNumber': self._count, 'gridColor': 16777164,
                          'lastGroupNumber': len(T['Bunch']), 'gridAlpha': self.grid_alpha, 'root': 1,
                          'selectedLu': _pt(0, 0), 'useHex': False, 'name': self.name,
                          'selectedRd': _pt(self.w - 1, self.h - 1), 'useDots': False, 'coors': False,
                          'cellSize': 1, 'pageSize': 1, 'snap': True, 'currentBunch': 1, 'half': False}]
        return {'tables': T}

    def save(self, path):
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(self.to_json(), f, separators=(',', ':'), ensure_ascii=False)
        return path


if __name__ == '__main__':
    # python dps_lib.py find pillar stone [--kind object]
    import sys
    args = sys.argv[1:]
    if args[:1] == ['find']:
        kind = None
        if '--kind' in args:
            i = args.index('--kind'); kind = args[i + 1]; del args[i:i + 2]
        for path, info in find(*args[1:], kind=kind, limit=200):
            size = sizes().get(path) or info.get('size')
            print(f"{info['kind']:6s} {str(size):12s} {path}")
