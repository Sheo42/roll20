"""L'Ermitage de la Lame Veillante — 42 x 42 squares.

Air dome at the bottom of a lake: deep water outside, a ring of lighter water (the water wall),
a quarry-rock floor inside. North: stone pillar with a spiral stair. Centre: the lists (circular
arena ~13 squares across). South: small chapel = hall of oaths (altar, 4 columns, double door
facing the arena) + reliquary behind the altar (pedestal, small chest). Rubble as cover.

Run:  python maps/ermitage_lame_veillante.py [output.dps]
      (default: ermitageLameVeillante_v4.dps in $DPS_MAPS_DIR, or in the current folder)
"""
import math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from dps_lib import DPSMap, circle_points

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('DPS_MAPS_DIR', '.'), 'ermitageLameVeillante_v4.dps')

N = 42
CX = CY = 21                 # dome centre
R_WATERWALL = 20.0           # outer edge of the light-water ring
R_DOME = 18.8                # dry floor
PILLAR = (21, 7)             # stone pillar (tower) centre: on a grid corner, so the stair lines up
R_PILLAR = math.sqrt(10)     # wall radius: the 2-square doorway then sits exactly on y = 10, x 20-22
ARENA = (21, 17.0); R_ARENA = 6.5
HALL = (16, 26, 26, 34)      # x0, y0, x1, y1
RELIQ = (18, 34, 24, 38)


def build():
    m = DPSMap('ermitageLameVeillante_v4', N, N)

    # ------------------------------------------------------------------ water & floor
    with m.group('Eau et sol'):
        m.plot('floor.water_deep', 0, 0, N, N)
        m.circle('floor.water_bright', CX, CY, R_WATERWALL, n=72, rough=0.03)
        m.circle('floor.rock_cracks', CX, CY, R_DOME, n=72, rough=0.03)
        # Roll20: the water wall lets sight through but stops movement
        m.barrier_circle(CX, CY, R_DOME + 0.1, n=48, type='transparent')

    # ------------------------------------------------------------------ the pillar (north)
    with m.group('Pilier'):
        px, py = PILLAR
        # round tower drawn with the wall tool (same brick as the chapel), floor inside,
        # a 2-square doorway to the south (towards the lists) with the door set in the gap
        m.circle('floor.rock_tiles', px, py, R_PILLAR + 0.05, n=48, rough=0.0)
        half = math.asin(1.0 / R_PILLAR)                          # half-angle of a 2-square gap
        a0, a1 = math.pi / 2 + half, math.pi / 2 - half + 2 * math.pi
        nseg = 24
        ring = [(px + R_PILLAR * math.cos(a0 + (a1 - a0) * i / nseg),
                 py + R_PILLAR * math.sin(a0 + (a1 - a0) * i / nseg)) for i in range(nseg + 1)]
        m.wall('wall.brick', *ring)
        # spiral stair on the grid: three quarter-ring pieces (outer radius 2, inner radius 1 square)
        # around the tower centre, open quadrant to the south-west, a round pillar as the central post.
        # The piece's curve centre sits at (+1, +0.5) squares from its image centre (scale 0.5, angle 0,
        # curve in the north-west quadrant); rotating clockwise moves it to NE, SE.
        S = 0.5
        for ang in (0, 90, 180):
            a = math.radians(ang)
            vx, vy = 1.0 * math.cos(a) - 0.5 * math.sin(a), 1.0 * math.sin(a) + 0.5 * math.cos(a)
            m.obj('stairs.turn_rock', px - vx, py - vy, angle=ang, scale=S)
        m.obj('pillar.round_carved', px, py, scale=1.9)           # central post
        m.obj('door.double', px, py + R_PILLAR * math.cos(half))  # door in the gap, facing the lists
        dy = py + R_PILLAR * math.cos(half)
        m.door((px - 1, dy), (px + 1, dy))                        # Roll20 door in the gap
        m.barrier_circle(px, py, 0.75, n=12)                      # the central post blocks sight

    # ------------------------------------------------------------------ the lists (centre)
    with m.group('Lice'):
        ax, ay = ARENA
        m.circle('floor.dirt', ax, ay, R_ARENA, n=60, rough=0.0, opacity=65)
        # low fieldstone barrier, open north (to the pillar) and south (to the chapel)
        n = 28
        step = 2 * math.pi / n
        pts = circle_points(ax, ay, R_ARENA + 0.1, n, start=-math.pi / 2 - step)
        for i in range(n):
            if i in (0, 1, 14, 15):                               # ~3-square openings, N and S
                continue
            m.wall('wall.rock_low', pts[i], pts[(i + 1) % n], blocks=False)   # low wall: no sight block
        # carved pillars flanking both entrances
        for a_c in (-math.pi / 2, math.pi / 2):
            for sgn in (-1, 1):
                a = a_c + sgn * 1.15 * step
                m.obj('pillar.round_carved', ax + (R_ARENA + 0.1) * math.cos(a), ay + (R_ARENA + 0.1) * math.sin(a))
                m.barrier_circle(ax + (R_ARENA + 0.1) * math.cos(a), ay + (R_ARENA + 0.1) * math.sin(a), 0.4, n=8)
        m.obj('weapon.longsword', ax, ay, scale=2.5)            # sword emblem inlaid in the centre

    # ------------------------------------------------------------------ the chapel (south)
    with m.group('Chapelle'):
        x0, y0, x1, y1 = HALL
        rx0, ry0, rx1, ry1 = RELIQ
        m.plot('floor.marble_dark', x0, y0, x1, y1)
        m.plot('floor.marble_dark', rx0, ry0, rx1, ry1)
        mid = (x0 + x1) / 2
        # hall walls, double-door gap (2 squares) in the north wall
        m.wall('wall.brick', (mid - 1, y0), (x0, y0), (x0, y1), (rx0, y1))
        m.wall('wall.brick', (mid + 1, y0), (x1, y0), (x1, y1), (rx1, y1))
        # partition hall / reliquary with a 2-square doorway, then the reliquary
        m.wall('wall.brick', (rx0, ry0), (mid - 1, ry0))
        m.wall('wall.brick', (mid + 1, ry0), (rx1, ry0))
        m.wall('wall.brick', (rx0, ry0), (rx0, ry1), (rx1, ry1), (rx1, ry0))
        m.obj('door.double', mid, y0)                             # hall of oaths, facing the lists
        m.obj('door.double_b', mid, ry0)                          # reliquary door behind the altar
        m.door((mid - 1, y0), (mid + 1, y0))                      # Roll20 doors
        m.door((mid - 1, ry0), (mid + 1, ry0))

        # hall of oaths
        for cx, cy in ((x0 + 1.5, y0 + 2), (x1 - 1.5, y0 + 2), (x0 + 1.5, y1 - 3), (x1 - 1.5, y1 - 3)):
            m.obj('pillar.octagon', cx, cy)
            m.barrier_circle(cx, cy, 0.4, n=8)
        m.obj('altar.stone_large', mid, y1 - 2.2)
        m.obj('altar.runner_red', mid, y1 - 2.2)
        m.obj('brazier', x0 + 1, y1 - 1)
        m.obj('brazier', x1 - 1, y1 - 1)
        m.obj('brazier', mid - 2.5, y0 - 0.8)                     # outside, flanking the door
        m.obj('brazier', mid + 2.5, y0 - 0.8)

        # reliquary
        m.obj('platform.runes', mid, ry0 + 2.1, scale=0.5)        # rune-carved pedestal (2.5 squares)
        m.obj('weapon.longsword', mid, ry0 + 2.1, angle=90, scale=0.9)   # the watchful blade, resting on it
        m.obj('chest.dark', rx1 - 0.9, ry0 + 1.0, angle=-90)  # small chest against the wall

    # ------------------------------------------------------------------ rubble (cover) & water-wall rocks
    with m.group('Décombres'):
        for key, x, y, a in [('rubble.3x3', 8.5, 11.5, 15), ('rubble.3x2', 33.5, 11, -10), ('rubble.2x2', 7, 18, 0),
                             ('rubble.4x3', 35, 20, 80), ('rubble.3x3', 9, 28.5, 40), ('rubble.3x2', 33, 30.5, 10),
                             ('rubble.2x2', 13, 33.5, 60), ('rubble.2x2', 29.5, 35, -30), ('rubble.3x2', 28.5, 7, 100),
                             ('rubble.2x2', 14, 5.5, 20)]:
            m.obj(key, x, y, angle=a)
        for key, deg, s in [('water_rock.1', 200, 0.5), ('water_rock.5', 330, 0.45), ('water_rock.10', 60, 0.5),
                            ('water_rock.1', 125, 0.4)]:
            a = math.radians(deg)
            m.obj(key, CX + 19.6 * math.cos(a), CY + 19.6 * math.sin(a), angle=deg, scale=s)
    return m


if __name__ == '__main__':
    m = build()
    print('saved', m.save(OUT), '-', m._count, 'layers')
    cmd = os.path.splitext(OUT)[0] + '.roll20.txt'
    open(cmd, 'w', encoding='utf-8').write(m.roll20_command())
    print('Roll20 walls command:', cmd, len(m.roll20_command()), 'chars')
