// Small pure-JS raster helpers (no native modules): decode PNG/JPEG, box resize, transformed draw,
// textured polygon fill, wall strips, JPEG encode, tiny digit font for labels.
'use strict';
const fs = require('fs');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

function decodeImage(file) {
    const buf = fs.readFileSync(file);
    if (buf[0] === 0x89 && buf[1] === 0x50) {
        const png = PNG.sync.read(buf);
        return { w: png.width, h: png.height, data: png.data };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
        const j = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
        return { w: j.width, h: j.height, data: j.data };
    }
    throw new Error('unsupported image format (only PNG and JPEG): ' + file);
}

// Size from the header only (fast). Returns [w, h] in px or null.
function imageSize(file) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const b = Buffer.alloc(64 * 1024);
        const n = fs.readSync(fd, b, 0, b.length, 0);
        if (b[0] === 0x89 && b[1] === 0x50 && b.toString('ascii', 12, 16) === 'IHDR') {
            return [b.readUInt32BE(16), b.readUInt32BE(20)];
        }
        if (b[0] === 0xff && b[1] === 0xd8) {
            let i = 2;
            while (i + 9 < n) {
                if (b[i] !== 0xff) { i += 1; continue; }
                const marker = b[i + 1];
                const len = b.readUInt16BE(i + 2);
                if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                    return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
                }
                i += 2 + len;
            }
        }
        if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
            const kind = b.toString('ascii', 12, 16);
            if (kind === 'VP8X') { return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]; }
            if (kind === 'VP8 ') { return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]; }
            if (kind === 'VP8L') {
                const v = b.readUInt32LE(21);
                return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)];
            }
        }
        return null;
    } catch (e) {
        return null;
    } finally {
        if (fd !== undefined) { fs.closeSync(fd); }
    }
}

function newImage(w, h, rgba) {
    const data = new Uint8ClampedArray(w * h * 4);
    if (rgba) {
        for (let i = 0; i < w * h; i++) { data.set(rgba, i * 4); }
    }
    return { w, h, data };
}

// Area-average resize (good for downscaling), bilinear-ish for upscaling via the same weights.
function resize(img, nw, nh) {
    nw = Math.max(1, Math.round(nw)); nh = Math.max(1, Math.round(nh));
    if (nw === img.w && nh === img.h) { return img; }
    const out = newImage(nw, nh);
    const sx = img.w / nw, sy = img.h / nh;
    const src = img.data, dst = out.data;
    for (let y = 0; y < nh; y++) {
        const y0 = y * sy, y1 = y0 + sy;
        for (let x = 0; x < nw; x++) {
            const x0 = x * sx, x1 = x0 + sx;
            let r = 0, g = 0, b = 0, a = 0, wsum = 0;
            for (let yy = Math.floor(y0); yy < Math.min(img.h, Math.ceil(y1)); yy++) {
                const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
                if (wy <= 0) { continue; }
                for (let xx = Math.floor(x0); xx < Math.min(img.w, Math.ceil(x1)); xx++) {
                    const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
                    if (wx <= 0) { continue; }
                    const w = wx * wy, i = (yy * img.w + xx) * 4, al = src[i + 3] * w;
                    r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; wsum += w;
                }
            }
            const o = (y * nw + x) * 4;
            if (a > 0) { dst[o] = r / a; dst[o + 1] = g / a; dst[o + 2] = b / a; }
            dst[o + 3] = wsum ? a / wsum : 0;
        }
    }
    return out;
}

function blendPixel(dst, o, r, g, b, a) {          // a in 0..1, source-over
    if (a <= 0) { return; }
    const da = dst[o + 3] / 255, oa = a + da * (1 - a);
    if (oa <= 0) { return; }
    dst[o] = (r * a + dst[o] * da * (1 - a)) / oa;
    dst[o + 1] = (g * a + dst[o + 1] * da * (1 - a)) / oa;
    dst[o + 2] = (b * a + dst[o + 2] * da * (1 - a)) / oa;
    dst[o + 3] = oa * 255;
}

function sampleBilinear(img, u, v) {           // u, v in pixels of img; returns [r,g,b,a]
    const x0 = Math.floor(u - 0.5), y0 = Math.floor(v - 0.5);
    const fx = u - 0.5 - x0, fy = v - 0.5 - y0;
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < 2; j++) {
        const yy = Math.min(img.h - 1, Math.max(0, y0 + j));
        const wy = j ? fy : 1 - fy;
        for (let i = 0; i < 2; i++) {
            const xx = Math.min(img.w - 1, Math.max(0, x0 + i));
            const w = (i ? fx : 1 - fx) * wy, k = (yy * img.w + xx) * 4, al = img.data[k + 3] * w;
            r += img.data[k] * al; g += img.data[k + 1] * al; b += img.data[k + 2] * al; a += al;
        }
    }
    return a > 0 ? [r / a, g / a, b / a, a] : [0, 0, 0, 0];
}

// Draw img (already resized to wPx x hPx) centred at (cx, cy), rotated clockwise by angleDeg.
function drawTransformed(canvas, img, cx, cy, angleDeg, flipH, flipV, opacity) {
    const a = angleDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const hw = img.w / 2, hh = img.h / 2;
    const ex = Math.abs(c) * hw + Math.abs(s) * hh, ey = Math.abs(s) * hw + Math.abs(c) * hh;
    const xmin = Math.max(0, Math.floor(cx - ex)), xmax = Math.min(canvas.w - 1, Math.ceil(cx + ex));
    const ymin = Math.max(0, Math.floor(cy - ey)), ymax = Math.min(canvas.h - 1, Math.ceil(cy + ey));
    const op = opacity === undefined ? 1 : opacity;
    for (let y = ymin; y <= ymax; y++) {
        for (let x = xmin; x <= xmax; x++) {
            const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
            let u = c * dx + s * dy, v = -s * dx + c * dy;          // inverse rotation
            if (u < -hw || u >= hw || v < -hh || v >= hh) { continue; }
            if (flipH) { u = -u; }
            if (flipV) { v = -v; }
            const p = sampleBilinear(img, u + hw, v + hh);
            blendPixel(canvas.data, (y * canvas.w + x) * 4, p[0], p[1], p[2], p[3] / 255 * op);
        }
    }
}

function polygonCrossings(poly, y) {
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y)) { xs.push(xi + (y - yi) * (xj - xi) / (yj - yi)); }
    }
    return xs.sort((p, q) => p - q);
}

// Fill polygon (canvas px) with a texture tiled every tilePx pixels (texture pre-resized to tilePx).
function fillTexturedPolygon(canvas, poly, tex, opacity) {
    let ymin = Infinity, ymax = -Infinity;
    for (const [, y] of poly) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
    ymin = Math.max(0, Math.floor(ymin)); ymax = Math.min(canvas.h - 1, Math.ceil(ymax));
    const op = opacity === undefined ? 1 : opacity;
    for (let y = ymin; y <= ymax; y++) {
        const xs = polygonCrossings(poly, y + 0.5);
        for (let k = 0; k + 1 < xs.length; k += 2) {
            const x0 = Math.max(0, Math.ceil(xs[k] - 0.5)), x1 = Math.min(canvas.w - 1, Math.floor(xs[k + 1] - 0.5));
            const ty = ((y % tex.h) + tex.h) % tex.h;
            for (let x = x0; x <= x1; x++) {
                const t = (ty * tex.w + (x % tex.w)) * 4;
                blendPixel(canvas.data, (y * canvas.w + x) * 4, tex.data[t], tex.data[t + 1], tex.data[t + 2], tex.data[t + 3] / 255 * op);
            }
        }
    }
}

// Wall strip: tex (pre-resized: height = wall thickness in px) repeated along segment a->b, centred on it.
function drawWall(canvas, a, b, tex) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.5) { return; }
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, hh = tex.h / 2, ext = hh * 0.6;
    const xmin = Math.max(0, Math.floor(Math.min(a[0], b[0]) - hh - ext)), xmax = Math.min(canvas.w - 1, Math.ceil(Math.max(a[0], b[0]) + hh + ext));
    const ymin = Math.max(0, Math.floor(Math.min(a[1], b[1]) - hh - ext)), ymax = Math.min(canvas.h - 1, Math.ceil(Math.max(a[1], b[1]) + hh + ext));
    for (let y = ymin; y <= ymax; y++) {
        for (let x = xmin; x <= xmax; x++) {
            const dx = x + 0.5 - a[0], dy = y + 0.5 - a[1];
            const u = dx * ux + dy * uy, v = -dx * uy + dy * ux;
            if (u < -ext || u > L + ext || v < -hh || v >= hh) { continue; }
            const tu = ((Math.floor(u + ext) % tex.w) + tex.w) % tex.w, tv = Math.min(tex.h - 1, Math.floor(v + hh));
            const t = (tv * tex.w + tu) * 4;
            blendPixel(canvas.data, (y * canvas.w + x) * 4, tex.data[t], tex.data[t + 1], tex.data[t + 2], tex.data[t + 3] / 255);
        }
    }
}

function drawLine(canvas, a, b, rgba, width) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, steps = Math.ceil(L), r = (width || 1) / 2;
    for (let i = 0; i <= steps; i++) {
        const x = a[0] + (b[0] - a[0]) * i / steps, y = a[1] + (b[1] - a[1]) * i / steps;
        for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) {
            for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
                if (xx < 0 || yy < 0 || xx >= canvas.w || yy >= canvas.h) { continue; }
                blendPixel(canvas.data, (yy * canvas.w + xx) * 4, rgba[0], rgba[1], rgba[2], rgba[3] / 255);
            }
        }
    }
}

function fillRect(canvas, x0, y0, w, h, rgba) {
    for (let y = Math.max(0, y0); y < Math.min(canvas.h, y0 + h); y++) {
        for (let x = Math.max(0, x0); x < Math.min(canvas.w, x0 + w); x++) {
            blendPixel(canvas.data, (y * canvas.w + x) * 4, rgba[0], rgba[1], rgba[2], rgba[3] / 255);
        }
    }
}

// 3x5 digit font
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
                '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
function drawNumber(canvas, n, x, y, scale) {
    const s = String(n), sc = scale || 3;
    fillRect(canvas, x - sc, y - sc, s.length * 4 * sc + sc, 7 * sc, [0, 0, 0, 200]);
    for (let k = 0; k < s.length; k++) {
        const g = DIGITS[+s[k]];
        for (let i = 0; i < 15; i++) {
            if (g[i] === '1') { fillRect(canvas, x + k * 4 * sc + (i % 3) * sc, y + Math.floor(i / 3) * sc, sc, sc, [255, 230, 0, 255]); }
        }
    }
}

function encodeJpeg(canvas, quality, bg) {
    const out = Buffer.alloc(canvas.w * canvas.h * 4);
    const back = bg || [40, 40, 40];
    for (let i = 0; i < canvas.w * canvas.h; i++) {
        const a = canvas.data[i * 4 + 3] / 255;
        out[i * 4] = canvas.data[i * 4] * a + back[0] * (1 - a);
        out[i * 4 + 1] = canvas.data[i * 4 + 1] * a + back[1] * (1 - a);
        out[i * 4 + 2] = canvas.data[i * 4 + 2] * a + back[2] * (1 - a);
        out[i * 4 + 3] = 255;
    }
    return jpeg.encode({ data: out, width: canvas.w, height: canvas.h }, quality || 85).data;
}

module.exports = { decodeImage, imageSize, newImage, resize, drawTransformed, fillTexturedPolygon, drawWall,
                   drawLine, fillRect, drawNumber, encodeJpeg, blendPixel };
