"""Tests of dps_lib (no DPS needed):  python -m unittest discover -s tests   (from dps/generator)"""
import json, math, os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import dps_lib
from dps_lib import DPSMap, draw_offset, offset_for


class Offsets(unittest.TestCase):
    """DPS draws an object's centre at begin + R(angle) . scale . (0.5 if width even, 0.5 if height even)."""

    def test_parity(self):
        self.assertEqual(offset_for(1, 1), (0.0, 0.0))
        self.assertEqual(offset_for(2, 3), (0.5, 0.0))
        self.assertEqual(offset_for(4, 6), (0.5, 0.5))

    def test_rotation_and_scale(self):
        dx, dy = draw_offset(2, 2, 90, 2.0)            # (0.5, 0.5) * 2, turned 90 degrees clockwise
        self.assertAlmostEqual(dx, -1.0)
        self.assertAlmostEqual(dy, 1.0)
        self.assertEqual(draw_offset(3, 3, 37, 1.5), (0.0, 0.0))


class MapFile(unittest.TestCase):
    def build(self):
        m = DPSMap('test', 10, 8)
        with m.group('Sol'):
            m.plot('floor.rock_tiles', 0, 0, 10, 8)
        with m.group('Murs'):
            m.wall('wall.brick', (0, 0), (10, 0))
            m.wall('wall.rock_low', (0, 4), (4, 4), blocks=False)
        m.obj('door.double', 5, 0, size=(2, 2))            # centre (5, 0) -> begin (4.5, -0.5)
        m.door((4, 0), (6, 0))
        m.barrier_circle(2, 2, 0.5, n=8, type='transparent')
        return m

    def test_tables_and_layers(self):
        m = self.build()
        t = m.to_json()['tables']
        self.assertEqual(len(t['Plot']), 1)
        self.assertEqual(len(t['Wall']), 2)
        ob = t['Obstacle'][0]
        self.assertEqual(ob['begin'], {'x': 4.5, 'y': -0.5})
        root = next(b for b in t['Bunch'] if b['id'] == 1)
        groups = [b for b in t['Bunch'] if b.get('parent') == 1]
        self.assertEqual([g['name'] for g in groups], ['Sol', 'Murs'])
        self.assertEqual(root['layers'][:2], [g['id'] for g in groups])
        layer_data = {l['data'] for l in t['Layer']}
        for k in ('Plot', 'Wall', 'Obstacle'):
            for o in t[k]:
                self.assertIn(o['id'], layer_data)
        paths = {h['path'] for h in t['TextureItemHelper']}
        self.assertTrue(all(p.startswith('data/collections/') for p in paths))

    def test_roll20_command(self):
        cmd = self.build().roll20_command()
        self.assertTrue(cmd.startswith('!dpswalls size=10x8 ; '))
        self.assertNotIn('[', cmd)                       # Roll20 would read [[ as an inline roll
        parts = cmd.split(' ; ')[1:]
        self.assertEqual([p[0] for p in parts], ['W', 'T', 'D'])   # the low wall does not block sight
        self.assertEqual(parts[0], 'W:0,0 10,0')
        self.assertEqual(parts[-1], 'D:4,0 6,0')

    def test_save(self):
        with tempfile.TemporaryDirectory() as d:
            p = self.build().save(os.path.join(d, 'test.dps'))
            with open(p, encoding='utf-8') as f:
                data = json.load(f)
            self.assertEqual(data['tables']['Location'][0]['name'], 'test')


if __name__ == '__main__':
    unittest.main()
