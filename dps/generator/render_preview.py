"""Approximate preview of a DPSMap, composited from the real asset images.

Not DPS's renderer: floors are tiled from the texture image (or its _preview), objects are drawn at
200 px/square scaled to the output resolution, walls are the wall strip tiled along the segment.
Good enough to check layout, scale and overlaps before opening the map in DPS.

    from render_preview import render
    render(m, asset_root, 'preview.jpg', px=35)

asset_root = folder that mirrors the DPS install (contains data/collections/...).
"""
import os, math, re
from PIL import Image, ImageDraw

def _img_path(root, path):
    p = os.path.join(root, path)
    if os.path.isdir(p):
        for name in ('img.png', '_preview.png'):
            if os.path.exists(os.path.join(p, name)):
                return os.path.join(p, name)
        return None
    return p if os.path.exists(p) else None

_cache = {}
def _load(root, path):
    if path not in _cache:
        f = _img_path(root, path)
        _cache[path] = Image.open(f).convert('RGBA') if f else None
    return _cache[path]

def _tile_squares(path, img):
    m = re.findall(r'(\d+)x(\d+)', os.path.basename(path))
    if m:
        return int(m[-1][0])
    if img is not None and img.size[0] >= 400:
        return img.size[0] / 200
    return 8

def render(m, root, out, px=35, grid=True, missing_color=(255, 0, 255, 160)):
    W, H = int(m.w * px), int(m.h * px)
    canvas = Image.new('RGBA', (W, H), (40, 40, 40, 255))
    missing = set()
    for item in m.placed:
        kind, path = item[0], item[1]
        img = _load(root, path)
        if kind == 'poly':
            pts, opacity, scale = item[2], item[3], item[4]
            sq = _tile_squares(path, img) * scale
            tile_px = max(1, int(sq * px))
            layer = Image.new('RGBA', (W, H))
            if img is None:
                missing.add(path); layer.paste(missing_color, (0, 0, W, H))
            else:
                t = img.resize((tile_px, tile_px))
                for x in range(0, W, tile_px):
                    for y in range(0, H, tile_px):
                        layer.paste(t, (x, y))
            mask = Image.new('L', (W, H), 0)
            ImageDraw.Draw(mask).polygon([(x * px, y * px) for x, y in pts], fill=int(255 * opacity / 100))
            from PIL import ImageChops
            layer.putalpha(ImageChops.multiply(layer.getchannel('A'), mask))
            canvas.alpha_composite(layer)
        elif kind == 'wall':
            (a, b), th = item[2], item[3]
            if img is None:
                missing.add(path); continue
            L = math.dist(a, b)
            if L == 0:
                continue
            hpx = max(2, int(img.size[1] / 200 * px * th))
            strip = Image.new('RGBA', (max(1, int(L * px) + hpx), hpx))
            seg = img.resize((max(1, int(img.size[0] / 200 * px)), hpx))
            for x in range(0, strip.size[0], seg.size[0]):
                strip.paste(seg, (x, 0))
            ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
            rot = strip.rotate(-ang, expand=True, resample=Image.BICUBIC)
            cx, cy = (a[0] + b[0]) / 2 * px, (a[1] + b[1]) / 2 * px
            canvas.alpha_composite(rot, (int(cx - rot.size[0] / 2), int(cy - rot.size[1] / 2)))
        elif kind == 'obj':
            (cx, cy), angle, scale, fh, fv, opacity = item[2], item[3], item[4], item[5], item[6], item[7]
            if img is None:
                missing.add(path)
                d = ImageDraw.Draw(canvas)
                d.ellipse([cx * px - px / 2, cy * px - px / 2, cx * px + px / 2, cy * px + px / 2], fill=missing_color)
                continue
            w = max(1, int(img.size[0] / 200 * px * scale)); h = max(1, int(img.size[1] / 200 * px * scale))
            o = img.resize((w, h), Image.LANCZOS)
            if fh: o = o.transpose(Image.FLIP_LEFT_RIGHT)
            if fv: o = o.transpose(Image.FLIP_TOP_BOTTOM)
            if angle:
                o = o.rotate(-angle, expand=True, resample=Image.BICUBIC)
            if opacity < 100:
                o.putalpha(o.getchannel('A').point(lambda v: int(v * opacity / 100)))
            canvas.alpha_composite(o, (int(cx * px - o.size[0] / 2), int(cy * px - o.size[1] / 2)))
    if grid:
        g = Image.new('RGBA', (W, H)); d = ImageDraw.Draw(g)
        for x in range(0, m.w + 1):
            d.line([(x * px, 0), (x * px, H)], fill=(255, 255, 255, 28))
        for y in range(0, m.h + 1):
            d.line([(0, y * px), (W, y * px)], fill=(255, 255, 255, 28))
        canvas.alpha_composite(g)
    canvas.convert('RGB').save(out, quality=88)
    return sorted(missing)
