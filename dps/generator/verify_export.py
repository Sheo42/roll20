"""Check a DPS export against the generator: where did DPS draw each object vs the intended centre?
Usage: python verify_export.py map.dps "map(WxH).jpg" <DPS install folder, the one containing data/collections>
       (or set DPS_INSTALL instead of the third argument)
Needs numpy, pillow, opencv-python. Objects on busy backgrounds can give false alarms - look at them."""
import json, sys, os, math, cv2, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dps_lib import draw_offset, sizes
if len(sys.argv) < 3 or (len(sys.argv) < 4 and not os.environ.get('DPS_INSTALL')):
    sys.exit(__doc__)
ROOT = (sys.argv[3] if len(sys.argv) > 3 else os.environ['DPS_INSTALL']).rstrip('/\\') + '/'
dps, jpg = sys.argv[1], sys.argv[2]
exp = np.array(Image.open(jpg).convert('RGB')).astype(np.float32)
PX = 70
d = json.load(open(dps))['tables']
helpers = {h['id']: h['path'] for h in d['TextureItemHelper']}
worst = 0
for o in d['Obstacle']:
    path = helpers[o['helper']]
    f = ROOT + path + ('/img.png' if os.path.isdir(ROOT + path) else '')
    im = Image.open(f).convert('RGBA'); w, h = im.size
    s = o['scale']
    im = im.resize((max(1, round(w / 200 * PX * s)), max(1, round(h / 200 * PX * s))), Image.LANCZOS)
    if o['angle']:
        im = im.rotate(-o['angle'], expand=True)
    ox, oy = draw_offset(w / 200, h / 200, o['angle'], s)
    want = (o['begin']['x'] + ox, o['begin']['y'] + oy)
    # search a window around the intended spot
    x0 = int(max(0, (want[0]) * PX - im.size[0] / 2 - 2 * PX)); y0 = int(max(0, want[1] * PX - im.size[1] / 2 - 2 * PX))
    win = exp[y0:y0 + im.size[1] + 4 * PX, x0:x0 + im.size[0] + 4 * PX]
    a = np.array(im).astype(np.float32)
    if win.shape[0] < a.shape[0] or win.shape[1] < a.shape[1]:
        continue
    mask = (a[:, :, 3:] > 128).astype(np.float32).repeat(3, 2)
    r = cv2.matchTemplate(win, a[:, :, :3], cv2.TM_SQDIFF, mask=mask)
    _, _, loc, _ = cv2.minMaxLoc(r)
    got = ((x0 + loc[0] + im.size[0] / 2) / PX, (y0 + loc[1] + im.size[1] / 2) / PX)
    err = math.dist(got, want); worst = max(worst, err)
    if err > 0.1:
        print(f'{os.path.basename(path)[:30]:30s} want {want[0]:.2f},{want[1]:.2f}  got {got[0]:.2f},{got[1]:.2f}  err {err:.2f}')
print('objects', len(d['Obstacle']), 'worst error (squares)', round(worst, 3))
