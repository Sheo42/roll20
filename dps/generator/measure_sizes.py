"""Record image sizes (in squares, 200 px/square) of every asset image found under an asset root
that mirrors the DPS install. Writes sizes.json used by dps_lib to centre objects correctly.
Usage: python measure_sizes.py <folder containing data/collections>"""
import os, sys, json
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
root = sys.argv[1]
out_p = os.path.join(here, 'sizes.json')
sizes = json.load(open(out_p)) if os.path.exists(out_p) else {}
for dp, dn, fn in os.walk(os.path.join(root, 'data', 'collections')):
    for f in fn:
        if not f.lower().endswith('.png') or f == '_preview.png':
            continue
        full = os.path.join(dp, f)
        rel = os.path.relpath(full, root).replace('\\', '/')
        if f == 'img.png':
            rel = rel.rsplit('/', 1)[0]
        w, h = Image.open(full).size
        sizes[rel] = [round(w / 200, 2), round(h / 200, 2)]
json.dump(dict(sorted(sizes.items())), open(out_p, 'w'), indent=0)
print(len(sizes), 'sizes')
