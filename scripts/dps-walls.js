// dps-walls.js — draw Roll20 dynamic-lighting walls and doors from a DPS map export.
//
// Commands (GM only, act on the page the GM is currently on):
//   !dpswalls size=42x42 ; W:x,y x,y ... ; T:x,y ... ; D:x,y x,y
//       size=WxH  sets the page size in squares (optional)
//       W:  wall polyline (blocks sight and movement)
//       T:  transparent barrier (blocks movement, not sight)
//       O:  one-way barrier
//       D:  door between two points (closed)   S: secret door
//     Coordinates are in squares (70 px). No brackets: Roll20 would read [[ as an inline roll.
//     Running it again first removes what it drew before on that page.
//   !dpswalls clear      removes the walls and doors this script drew on the page
//   !dpswalls img <url>  puts that image (from your art library) on the map layer, page-sized
//
// The command line is written by the DPS generator (dps_lib.py, DPSMap.roll20_command()).
var DPSWalls = (function () {
    'use strict';
    var SQ = 70;
    var CODES = { W: 'wall', T: 'transparent', O: 'oneWay', D: 'door', S: 'secret' };

    function decodeEntities(s) {
        return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    }

    // "x,y x,y" -> [[x,y],...] in squares
    function parsePoints(txt) {
        var pts = [];
        String(txt).trim().split(/\s+/).forEach(function (pair) {
            if (!pair) { return; }
            var xy = pair.split(',');
            var x = parseFloat(xy[0]), y = parseFloat(xy[1]);
            if (xy.length !== 2 || !isFinite(x) || !isFinite(y)) { throw new Error('bad point "' + pair + '"'); }
            pts.push([x, y]);
        });
        return pts;
    }

    // whole command (without "!dpswalls") -> {size:{w,h}|null, items:[{kind, points}]}
    function parseCommand(body) {
        var out = { size: null, items: [] };
        decodeEntities(body).split(';').forEach(function (part) {
            part = part.trim();
            if (!part) { return; }
            var m = /^size\s*=\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i.exec(part);
            if (m) { out.size = { w: parseFloat(m[1]), h: parseFloat(m[2]) }; return; }
            m = /^([WTODS])\s*:(.*)$/.exec(part);
            if (!m) { throw new Error('cannot read "' + part.slice(0, 40) + '"'); }
            var pts = parsePoints(m[2]);
            var kind = CODES[m[1]];
            if ((kind === 'door' || kind === 'secret') && pts.length !== 2) { throw new Error('a door needs 2 points'); }
            if (pts.length < 2) { throw new Error('a barrier needs at least 2 points'); }
            out.items.push({ kind: kind, points: pts });
        });
        return out;
    }

    function bbox(ptsPx) {
        var xs = ptsPx.map(function (p) { return p[0]; }), ys = ptsPx.map(function (p) { return p[1]; });
        return { minx: Math.min.apply(null, xs), maxx: Math.max.apply(null, xs),
                 miny: Math.min.apply(null, ys), maxy: Math.max.apply(null, ys) };
    }
    function r2(v) { return Math.round(v * 100) / 100 + 0; }   // + 0 turns -0 into 0

    // pathv2 (Jumpgate): x,y = bounding-box centre, points relative to the box's top-left corner
    function pathv2Props(ptsSq) {
        var px = ptsSq.map(function (p) { return [p[0] * SQ, p[1] * SQ]; });
        var b = bbox(px);
        return {
            shape: 'pol',
            x: r2((b.minx + b.maxx) / 2), y: r2((b.miny + b.maxy) / 2),
            points: JSON.stringify(px.map(function (p) { return [r2(p[0] - b.minx), r2(p[1] - b.miny)]; }))
        };
    }

    // legacy path: left/top = box centre, path commands relative to the box's top-left corner
    function legacyPathProps(ptsSq) {
        var px = ptsSq.map(function (p) { return [p[0] * SQ, p[1] * SQ]; });
        var b = bbox(px);
        return {
            left: r2((b.minx + b.maxx) / 2), top: r2((b.miny + b.maxy) / 2),
            width: r2(b.maxx - b.minx), height: r2(b.maxy - b.miny),
            path: JSON.stringify(px.map(function (p, i) { return [i ? 'L' : 'M', r2(p[0] - b.minx), r2(p[1] - b.miny)]; }))
        };
    }

    // door: x,y = centre with the y axis inverted (y = -top); handles are offsets, y inverted too
    function doorProps(ptsSq) {
        var a = [ptsSq[0][0] * SQ, ptsSq[0][1] * SQ], b = [ptsSq[1][0] * SQ, ptsSq[1][1] * SQ];
        var cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
        return {
            x: r2(cx), y: r2(-cy),
            path: { handle0: { x: r2(a[0] - cx), y: r2(-(a[1] - cy)) },
                    handle1: { x: r2(b[0] - cx), y: r2(-(b[1] - cy)) } }
        };
    }

    var api = { parseCommand: parseCommand, parsePoints: parsePoints, pathv2Props: pathv2Props,
                legacyPathProps: legacyPathProps, doorProps: doorProps, decodeEntities: decodeEntities, SQ: SQ };
    if (typeof module !== 'undefined') { module.exports = api; }
    if (typeof on !== 'function') { return api; }

    // ------------------------------------------------------------------ Roll20 part
    var STROKE = { wall: '#ff0000', transparent: '#00bfff', oneWay: '#ffaa00' };

    function store() {
        if (!state.DPSWalls) { state.DPSWalls = { pages: {} }; }
        return state.DPSWalls;
    }
    function reply(who, txt) {
        sendChat('DPS walls', '/w "' + String(who).replace(' (GM)', '') + '" ' + txt, null, { noarchive: true });
    }
    function gmPage(playerid) {
        var p = getObj('player', playerid);
        return (p && p.get('_lastpage')) || Campaign().get('playerpageid');
    }
    function isJumpgate() {
        var r = Campaign().get('release');
        return r === 'jumpgate';
    }

    function clearPage(pageid) {
        var list = store().pages[pageid] || [];
        var n = 0;
        list.forEach(function (ref) {
            var o = getObj(ref.type, ref.id);
            if (o) { o.remove(); n += 1; }
        });
        delete store().pages[pageid];
        return n;
    }

    function draw(pageid, parsed) {
        var made = [], counts = { wall: 0, transparent: 0, oneWay: 0, door: 0, secret: 0 };
        var page = getObj('page', pageid);
        if (parsed.size && page) {
            page.set({ width: parsed.size.w, height: parsed.size.h });
        }
        var v2 = isJumpgate();
        parsed.items.forEach(function (it) {
            var o;
            if (it.kind === 'door' || it.kind === 'secret') {
                var d = doorProps(it.points);
                o = createObj('door', { pageid: pageid, x: d.x, y: d.y, path: d.path,
                                        isOpen: false, isLocked: false, isSecret: it.kind === 'secret' });
                if (o) { made.push({ type: 'door', id: o.id }); }
            } else {
                var base = { pageid: pageid, layer: 'walls', stroke: STROKE[it.kind], stroke_width: 5,
                             fill: 'transparent', barrierType: it.kind };
                if (v2) {
                    o = createObj('pathv2', Object.assign(base, pathv2Props(it.points)));
                    if (o) { made.push({ type: 'pathv2', id: o.id }); }
                } else {
                    o = createObj('path', Object.assign(base, legacyPathProps(it.points)));
                    if (o) { made.push({ type: 'path', id: o.id }); }
                }
            }
            if (o) { counts[it.kind] += 1; }
        });
        store().pages[pageid] = (store().pages[pageid] || []).concat(made);
        return counts;
    }

    function putImage(pageid, url) {
        var page = getObj('page', pageid);
        var w = page.get('width') * SQ, h = page.get('height') * SQ;
        var src = url.replace(/\/(med|original|max)\.(png|jpg|jpeg|gif|webp)/, '/thumb.$2');
        var g = createObj('graphic', { pageid: pageid, layer: 'map', imgsrc: src, left: w / 2, top: h / 2,
                                       width: w, height: h, name: 'DPS map' });
        if (g) {
            toBack(g);
            store().pages[pageid] = (store().pages[pageid] || []).concat([{ type: 'graphic', id: g.id }]);
        }
        return g;
    }

    on('chat:message', function (msg) {
        if (msg.type !== 'api' || !/^!dpswalls\b/i.test(msg.content)) { return; }
        if (!playerIsGM(msg.playerid)) { return; }
        var body = msg.content.replace(/^!dpswalls\s*/i, '');
        var pageid = gmPage(msg.playerid);
        try {
            if (/^clear\b/i.test(body)) {
                reply(msg.who, 'removed ' + clearPage(pageid) + ' objects');
                return;
            }
            var mImg = /^img\s+(\S+)/i.exec(body);
            if (mImg) {
                var g = putImage(pageid, decodeEntities(mImg[1]));
                reply(msg.who, g ? 'map image placed' : 'could not place the image (it must be in your art library)');
                return;
            }
            var parsed = parseCommand(body);
            // drawing again replaces the previous walls and doors, but keeps the image
            var keep = (store().pages[pageid] || []).filter(function (r) { return r.type === 'graphic'; });
            var old = (store().pages[pageid] || []).filter(function (r) { return r.type !== 'graphic'; });
            old.forEach(function (ref) { var o = getObj(ref.type, ref.id); if (o) { o.remove(); } });
            store().pages[pageid] = keep;
            var c = draw(pageid, parsed);
            reply(msg.who, 'walls ' + c.wall + ', transparent ' + c.transparent + ', one-way ' + c.oneWay +
                  ', doors ' + c.door + ', secret doors ' + c.secret + (parsed.size ? ', page ' + parsed.size.w + 'x' + parsed.size.h : '') +
                  (old.length ? ' (replaced ' + old.length + ')' : ''));
        } catch (e) {
            reply(msg.who, 'error: ' + e.message);
        }
    });

    on('ready', function () { store(); log('dps-walls ready'); });
    return api;
}());
