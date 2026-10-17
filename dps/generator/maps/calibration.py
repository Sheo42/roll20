"""Calibration map: objects of several sizes drawn inside thin outlines of where dps_lib expects
the full image to land. Open in DPS: every image should fill its outline exactly.
Top row angle 0, bottom row angle 90 (the outline is then rotated too)."""
import os, sys, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from dps_lib import DPSMap, sizes, resolve

m = DPSMap('calibrationDPS', 30, 14)
m.plot('floor.rock_smooth', 0, 0, 30, 14)
items = ['brazier', 'pillar.round_runes', 'rubble.3x2', 'stairs.spiral_a', 'altar.stone_large', 'door.metal_double']
x = 2.0
for key in items:
    path, info = resolve(key)
    w, h = sizes().get(path) or info.get('size')
    for row, ang in ((0, 0), (1, 90)):
        cx, cy = x + w / 2, 3.5 + row * 6.5
        ww, hh = (w, h) if ang == 0 else (h, w)
        cx = x + ww / 2
        m.obj(key, cx, cy, angle=ang)
        m.wall('wall.wood_b', (cx - ww / 2, cy - hh / 2), (cx + ww / 2, cy - hh / 2), (cx + ww / 2, cy + hh / 2),
               (cx - ww / 2, cy + hh / 2), closed=True)
    x += max(w, h) + 1
OUT = sys.argv[1] if len(sys.argv) > 1 else 'calibrationDPS.dps'
m.save(OUT); print('saved', OUT, x)
