// Dungeon Painter Studio helpers: asset index, search, sizes, picture sheets, map files, preview render.
'use strict';
const fs = require('fs');
const path = require('path');
const im = require('./imaging');

const PX_PER_SQUARE = 200;            // Forgotten Adventures assets: 200 px per square at scale 1
const IMG_EXT = /\.(png|jpe?g|webp)$/i;

class DPS {
    constructor(opts) {
        this.install = opts.install;                  // folder that contains data/collections
        this.mapsDir = opts.mapsDir;                  // where .dps maps live
        this.collections = path.join(this.install, 'data', 'collections');
        this.index = null;                            // [{path, kind, collection, category, folder}]
        this.sizeCache = new Map();
        this.imgCache = new Map();
    }

    // ------------------------------------------------------------------ paths and safety
    abs(rel) {                                        // 'data/collections/...' -> absolute, refusing escapes
        const p = path.resolve(this.install, rel.replace(/\\/g, '/'));
        if (!p.startsWith(path.resolve(this.collections))) { throw new Error('path outside the DPS collections: ' + rel); }
        return p;
    }
    mapPath(name) {
        if (!/^[^\\/:*?"<>|]+\.(dps|jpg|jpeg|png|txt)$/i.test(name) || name.includes('..')) {
            throw new Error('give a plain file name in the Maps folder, e.g. "maCarte.dps"');
        }
        return path.join(this.mapsDir, name);
    }
    // image file of an asset: the png itself, or img.png inside an asset folder
    assetImageFile(rel) {
        let p = this.abs(rel);
        if (!fs.existsSync(p) && IMG_EXT.test(p)) {             // DPS turns edited pngs into folders
            const alt = p.replace(IMG_EXT, '');
            if (fs.existsSync(alt)) { p = alt; }
        }
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
            for (const n of ['img.png', 'img.jpg', '_preview.png']) {
                if (fs.existsSync(path.join(p, n))) { return path.join(p, n); }
            }
            return null;
        }
        return fs.existsSync(p) ? p : null;
    }

    // ------------------------------------------------------------------ index
    buildIndex() {
        const out = [];
        const walk = (dir, relParts) => {
            let entries;
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
            const names = new Set(entries.map(e => e.name));
            const isAssetFolder = relParts.length >= 3 && (names.has('img.png') || names.has('img.jpg'));
            if (isAssetFolder) { out.push(this.entry(relParts, true)); return; }
            for (const e of entries) {
                if (e.isDirectory()) { walk(path.join(dir, e.name), relParts.concat(e.name)); }
                else if (IMG_EXT.test(e.name) && !/^(img|_preview|preview)\.(png|jpg)$/i.test(e.name) && relParts.length >= 2) {
                    out.push(this.entry(relParts.concat(e.name), false));
                }
            }
        };
        walk(this.collections, []);
        this.index = out.filter(e => e.kind);
        return this.index;
    }
    entry(parts, folder) {
        const top = (parts[1] || '').toLowerCase();
        const kind = top === 'floors' ? 'floor' : top === 'walls' ? 'wall' : (top === 'objects' || top === 'fa_assets') ? 'object' : null;
        return { path: 'data/collections/' + parts.join('/'), kind, collection: parts[0], category: parts.slice(1, -1).join('/'), folder };
    }
    ensureIndex() { return this.index || this.buildIndex(); }

    // size in squares [w, h] from the image header (cached)
    size(rel) {
        if (this.sizeCache.has(rel)) { return this.sizeCache.get(rel); }
        const f = this.assetImageFile(rel);
        const px = f ? im.imageSize(f) : null;
        const sq = px ? [Math.round(px[0] / PX_PER_SQUARE * 100) / 100, Math.round(px[1] / PX_PER_SQUARE * 100) / 100] : null;
        this.sizeCache.set(rel, sq);
        return sq;
    }

    search({ words = [], kind, collection, limit = 40, offset = 0 }) {
        const idx = this.ensureIndex();
        const ws = words.map(w => w.toLowerCase()).filter(Boolean);
        const coll = collection ? collection.toLowerCase() : null;
        const hits = idx.filter(e => (!kind || e.kind === kind) && (!coll || e.collection.toLowerCase().includes(coll)) &&
            ws.every(w => e.path.toLowerCase().includes(w)));
        return { total: hits.length, results: hits.slice(offset, offset + limit).map(e => Object.assign({}, e, { size: this.size(e.path) })) };
    }

    collectionsSummary() {
        const idx = this.ensureIndex(), by = {};
        for (const e of idx) {
            by[e.collection] = by[e.collection] || { floor: 0, wall: 0, object: 0 };
            by[e.collection][e.kind] += 1;
        }
        return by;
    }

    loadImage(rel) {
        if (this.imgCache.has(rel)) { return this.imgCache.get(rel); }
        const f = this.assetImageFile(rel);
        let img = null;
        if (f && !/\.webp$/i.test(f)) {
            try { img = im.decodeImage(f); } catch (e) { img = null; }
        }
        if (this.imgCache.size > 300) { this.imgCache.clear(); }
        this.imgCache.set(rel, img);
        return img;
    }

    // ------------------------------------------------------------------ picture sheet
    // Numbered thumbnails on a grey background with 1-square grid lines; returns {jpeg, legend}.
    sheet(paths, cell = 220, cols = 5) {
        const n = paths.length, rows = Math.ceil(n / cols);
        const canvas = im.newImage(cols * cell, rows * cell, [70, 70, 70, 255]);
        const legend = [];
        paths.forEach((rel, i) => {
            const x0 = (i % cols) * cell, y0 = Math.floor(i / cols) * cell;
            im.fillRect(canvas, x0 + 4, y0 + 4, cell - 8, cell - 8, [115, 115, 115, 255]);
            const img = this.loadImage(rel);
            const sz = this.size(rel);
            legend.push(`${i + 1}. ${rel}${sz ? `  (${sz[0]}x${sz[1]} sq)` : ''}${img ? '' : '  [no preview]'}`);
            if (!img) { return; }
            const box = cell - 16, k = Math.min(box / img.w, box / img.h);
            const t = im.resize(img, img.w * k, img.h * k);
            const ox = x0 + 8 + Math.floor((box - t.w) / 2), oy = y0 + 8 + Math.floor((box - t.h) / 2);
            im.drawTransformed(canvas, t, ox + t.w / 2, oy + t.h / 2, 0, false, false, 1);
            const sqPx = PX_PER_SQUARE * k;                          // grid: one line per square
            if (sqPx >= 6) {
                for (let gx = 0; gx <= t.w + 0.5; gx += sqPx) { im.drawLine(canvas, [ox + gx, oy], [ox + gx, oy + t.h], [255, 60, 60, 110], 1); }
                for (let gy = 0; gy <= t.h + 0.5; gy += sqPx) { im.drawLine(canvas, [ox, oy + gy], [ox + t.w, oy + gy], [255, 60, 60, 110], 1); }
            }
            im.drawNumber(canvas, i + 1, x0 + 10, y0 + 10, 3);
        });
        return { jpeg: im.encodeJpeg(canvas, 82), legend: legend.join('\n') };
    }

    // ------------------------------------------------------------------ maps
    listMaps(filter) {
        const f = (filter || '').toLowerCase();
        return fs.readdirSync(this.mapsDir, { withFileTypes: true })
            .filter(e => e.isFile() && /\.(dps|jpg|roll20\.txt)$/i.test(e.name) && e.name.toLowerCase().includes(f))
            .map(e => { const st = fs.statSync(path.join(this.mapsDir, e.name)); return { name: e.name, bytes: st.size, modified: st.mtime.toISOString() }; })
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    readMap(name) { return JSON.parse(fs.readFileSync(this.mapPath(name), 'utf8')); }

    summarize(dps) {
        const T = dps.tables || {};
        const counts = {};
        for (const [k, v] of Object.entries(T)) { if (Array.isArray(v) && v.length) { counts[k] = v.length; } }
        const loc = (T.Location || [])[0] || {};
        const helpers = (T.TextureItemHelper || []).map(h => h.path);
        const groups = (T.Bunch || []).map(b => b.name);
        return { name: loc.name, dpi: loc.dpi, counts, groups, assets: helpers };
    }

    writeFile(name, content, overwrite) {
        const p = this.mapPath(name);
        if (fs.existsSync(p) && !overwrite) {
            throw new Error(`${name} already exists in the Maps folder: choose a new name (e.g. a _v2 suffix). Existing maps are never overwritten.`);
        }
        if (/\.dps$/i.test(name)) {
            const d = JSON.parse(content);
            if (!d || typeof d.tables !== 'object') { throw new Error('not a DPS map: the JSON has no "tables"'); }
        }
        fs.writeFileSync(p, content, 'utf8');
        return { path: p, bytes: fs.statSync(p).size };
    }

    // area DPS exports: bounding box of floors, polygons and walls in whole squares (the Location
    // selection is only the editor's last selection). Objects only if there is nothing else.
    extent(dps) {
        const T = dps.tables || {};
        const figures = new Map((T.Figure || []).map(f => [f.id, f]));
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        const grow = (x, y) => { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); };
        for (const o of T.Plot || []) { for (const p of o.points || []) { grow(p.x, p.y); } }
        for (const o of T.Polygon || []) {
            for (const fid of o.figures || []) { const f = figures.get(fid); if (f) { for (const p of f.points) { grow(p.x, p.y); } } }
            for (const p of o.points || []) { grow(p.x, p.y); }
        }
        for (const o of T.Wall || []) { for (const p of o.points || []) { grow(p.x, p.y); } }
        if (!isFinite(bx0)) { for (const o of T.Obstacle || []) { if (o.begin) { grow(o.begin.x - 0.5, o.begin.y - 0.5); grow(o.begin.x + 0.5, o.begin.y + 0.5); } } }
        if (!isFinite(bx0)) { bx0 = 0; by0 = 0; bx1 = 10; by1 = 10; }
        const x = Math.floor(bx0 + 1e-6), y = Math.floor(by0 + 1e-6);
        return { x, y, w: Math.max(1, Math.ceil(bx1 - 1e-6) - x), h: Math.max(1, Math.ceil(by1 - 1e-6) - y) };
    }

    // ------------------------------------------------------------------ preview render
    render(dps, pxPerSquare = 24, opts = {}) {
        const T = dps.tables || {};
        const loc = (T.Location || [])[0] || {};
        const helpers = new Map((T.TextureItemHelper || []).map(h => [h.id, h.path]));
        const objects = new Map();
        for (const k of ['Plot', 'Polygon', 'Wall', 'Obstacle']) { for (const o of T[k] || []) { objects.set(o.id, { k, o }); } }
        const figures = new Map((T.Figure || []).map(f => [f.id, f]));
        const layers = new Map((T.Layer || []).map(l => [l.id, l]));
        const bunches = new Map((T.Bunch || []).map(b => [b.id, b]));

        const ext = this.extent(dps);
        const ox = opts.originX !== undefined ? opts.originX : ext.x;
        const oy = opts.originY !== undefined ? opts.originY : ext.y;
        const W = opts.width || ext.w, H = opts.height || ext.h;
        const px = pxPerSquare, P = (x, y) => [(x - ox) * px, (y - oy) * px];
        const canvas = im.newImage(Math.round(W * px), Math.round(H * px), [40, 40, 40, 255]);
        const skipped = {}, missing = new Set();

        const order = [];                                 // [layer, effectiveOpacity] bottom -> top
        const visit = (bunch, op) => {
            if (!bunch || bunch.invisible) { return; }
            for (const id of bunch.layers || []) {
                if (bunches.has(id) && !layers.has(id)) { const b = bunches.get(id); visit(b, op * (b.opacity === undefined ? 100 : b.opacity) / 100); }
                else if (layers.has(id)) { const l = layers.get(id); if (!l.invisible) { order.push([l, op * (l.opacity === undefined ? 100 : l.opacity) / 100]); } }
            }
        };
        visit(bunches.get(loc.root || 1), 1);

        const tileSquares = (rel, img) => {
            const m = path.basename(rel).match(/(\d+)\s*x\s*(\d+)/gi);
            if (m) { return parseInt(m[m.length - 1], 10); }
            return img && img.w >= 400 ? img.w / PX_PER_SQUARE : 8;
        };

        for (const [layer, op] of order) {
            const ref = objects.get(layer.data);
            if (!ref) { continue; }
            const { k, o } = ref, rel = helpers.get(o.helper);
            const img = rel ? this.loadImage(rel) : null;
            if (!img) { if (rel) { missing.add(rel); } continue; }
            if (k === 'Plot' || k === 'Polygon') {
                let pts;
                if (k === 'Plot') {
                    const [a, b] = o.points;
                    pts = [[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]];
                } else {
                    const f = figures.get((o.figures || [])[0]);
                    pts = f ? f.points.map(p => [p.x, p.y]) : (o.points || []).map(p => [p.x, p.y]);
                }
                if (pts.length < 3) { continue; }
                const tilePx = Math.max(2, tileSquares(rel, img) * (o.textureScale || 1) * px);
                const tex = im.resize(img, tilePx, tilePx * img.h / img.w);
                im.fillTexturedPolygon(canvas, pts.map(p => P(p[0], p[1])), tex, op);
            } else if (k === 'Wall') {
                const [a, b] = o.points;
                const th = Math.max(2, img.h / PX_PER_SQUARE * (o.thickness || 1) * px);
                const tex = im.resize(img, img.w / PX_PER_SQUARE * px, th);
                im.drawWall(canvas, P(a.x, a.y), P(b.x, b.y), tex);
            } else if (k === 'Obstacle') {
                const s = o.scale || 1, w = img.w / PX_PER_SQUARE, h = img.h / PX_PER_SQUARE;
                const [dx, dy] = drawOffset(w, h, o.angle || 0, s);
                const c = P(o.begin.x + dx, o.begin.y + dy);
                const t = im.resize(img, w * s * px, h * s * px);
                im.drawTransformed(canvas, t, c[0], c[1], o.angle || 0, !!o.flipH, !!o.flipV, op);
            }
        }
        for (const k of Object.keys(T)) {
            if (['Brush', 'Arc', 'Elipse', 'Spline', 'Linea', 'Puddle', 'Light', 'Inscription', 'Token'].includes(k) && (T[k] || []).length) {
                skipped[k] = T[k].length;
            }
        }
        if (opts.grid) {
            for (let x = 0; x <= W; x++) { im.drawLine(canvas, [x * px, 0], [x * px, H * px], [255, 255, 255, 40], 1); }
            for (let y = 0; y <= H; y++) { im.drawLine(canvas, [0, y * px], [W * px, y * px], [255, 255, 255, 40], 1); }
        }
        if (opts.barriers) {                               // overlay Roll20 walls from a .roll20.txt line
            for (const b of parseRoll20(opts.barriers)) {
                const col = b.kind === 'W' ? [255, 40, 40, 230] : b.kind === 'T' ? [40, 200, 255, 230] : [255, 160, 0, 255];
                for (let i = 0; i + 1 < b.points.length; i++) { im.drawLine(canvas, P(...b.points[i]), P(...b.points[i + 1]), col, Math.max(2, px / 10)); }
            }
        }
        return { jpeg: im.encodeJpeg(canvas, 85), width: W, height: H, skipped, missing: [...missing] };
    }
}

// DPS draws an object's image centre at begin + R(angle) . scale . (0.5 if width even, 0.5 if height even)
// (width/height = image px / 200, unscaled; angle clockwise). Measured on calibration exports.
function drawOffset(w, h, angle, scale) {
    const ox = (Math.round(w) % 2 === 0 ? 0.5 : 0) * scale, oy = (Math.round(h) % 2 === 0 ? 0.5 : 0) * scale;
    const a = angle * Math.PI / 180;
    return [ox * Math.cos(a) - oy * Math.sin(a), ox * Math.sin(a) + oy * Math.cos(a)];
}

function parseRoll20(line) {
    return String(line).replace(/^!dpswalls\s*/i, '').split(';').map(s => s.trim())
        .map(s => /^([WTODS])\s*:(.*)$/.exec(s)).filter(Boolean)
        .map(m => ({ kind: m[1], points: m[2].trim().split(/\s+/).map(p => p.split(',').map(Number)) }));
}

module.exports = { DPS, drawOffset, parseRoll20, PX_PER_SQUARE };
