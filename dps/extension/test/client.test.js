// End-to-end test of the DPS Maps MCP server, self-contained: it builds a tiny fake asset library and Maps
// folder in a temp dir, starts the server over stdio and calls every tool.
//   node test/client.test.js [server entry, default src/index.js]
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

function png(file, w, h, rgba) {
    const p = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) { p.data.set(rgba, i * 4); }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, PNG.sync.write(p));
}

// --- fake DPS install and Maps folder
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dps-mcp-test-'));
const install = path.join(tmp, 'Dungeon Painter Studio');
const maps = path.join(tmp, 'Maps');
const coll = path.join(install, 'data', 'collections', 'Test Pack');
png(path.join(coll, 'floors', 'Stone 8x8', 'img.png'), 400, 400, [100, 100, 100, 255]);   // folder asset
png(path.join(coll, 'objects', 'Blocks', 'Red Block 2x2.png'), 400, 400, [220, 0, 0, 255]);
png(path.join(coll, 'objects', 'Blocks', 'Blue Dot.png'), 200, 200, [0, 0, 220, 255]);
png(path.join(coll, 'walls', 'Plain-wall.png'), 400, 60, [0, 200, 0, 255]);
fs.mkdirSync(maps, { recursive: true });

const P = rel => 'data/collections/Test Pack/' + rel;
const layer = (id, data) => ({ id, data, parent: 1, opacity: 100, invisible: false, name: 'l' + id });
const testMap = {
    tables: {
        Location: [{ id: 1, root: 1, name: 'test', dpi: 70 }],
        Bunch: [{ id: 1, name: 'root', opacity: 100, layers: [10, 11, 12, 13], invisible: false }],
        TextureItemHelper: [{ id: 1, path: P('floors/Stone 8x8') }, { id: 2, path: P('objects/Blocks/Red Block 2x2.png') },
                            { id: 3, path: P('objects/Blocks/Blue Dot.png') }, { id: 4, path: P('walls/Plain-wall.png') }],
        Plot: [{ id: 1, helper: 1, points: [{ x: 0, y: 0 }, { x: 6, y: 6 }], textureScale: 1 }],
        // even-sized object: DPS draws its centre half a square right/down of begin -> centre (2.5, 2.5)
        Obstacle: [{ id: 2, helper: 2, begin: { x: 2, y: 2 }, angle: 0, scale: 1 },
                   { id: 3, helper: 3, begin: { x: 5, y: 1 }, angle: 0, scale: 1 }],
        Wall: [{ id: 4, helper: 4, thickness: 1, points: [{ x: 0, y: 5 }, { x: 6, y: 5 }] }],
        Layer: [layer(10, 1), layer(11, 2), layer(12, 3), layer(13, 4)]
    }
};
fs.writeFileSync(path.join(maps, 'mine.dps'), JSON.stringify(testMap));            // a "user" map

(async () => {
    const entry = process.argv[2] || path.join(__dirname, '..', 'src', 'index.js');
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'ignore',
        env: Object.assign({}, process.env, { DPS_INSTALL: install, DPS_MAPS_DIR: maps }) });
    const c = new Client({ name: 'test', version: '1' });
    await c.connect(transport);
    let n = 0;
    const ok = (name, fn) => fn().then(() => { n += 1; console.log('ok', name); });
    const call = (name, args) => c.callTool({ name, arguments: args || {} });
    const txt = r => r.content.filter(x => x.type === 'text').map(x => x.text).join('\n');
    const image = r => {
        const i = r.content.find(x => x.type === 'image');
        assert.ok(i, 'an image is returned');
        return jpeg.decode(Buffer.from(i.data, 'base64'), { useTArray: true });
    };
    const pixel = (img, x, y) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 40);

    await ok('tools are listed', async () => {
        const tools = (await c.listTools()).tools.map(t => t.name).sort();
        assert.deepStrictEqual(tools, ['dps_asset_sheet', 'dps_export', 'dps_find_assets', 'dps_info', 'dps_list_maps',
            'dps_preview', 'dps_read_map', 'dps_reindex', 'dps_window', 'dps_write_file']);
    });
    await ok('info counts the library', async () => {
        const info = JSON.parse(txt(await call('dps_info')));
        assert.deepStrictEqual(info.byCollection['Test Pack'], { floor: 1, wall: 1, object: 2 });
    });
    await ok('search returns DPS paths, kinds and measured sizes', async () => {
        const t = txt(await call('dps_find_assets', { words: 'red block', kind: 'object' }));
        assert.match(t, /^1 match/);
        assert.match(t, /object 2x2\s+data\/collections\/Test Pack\/objects\/Blocks\/Red Block 2x2\.png/);
        assert.match(txt(await call('dps_find_assets', { words: 'stone' })), /floor\s+2x2\s+.*Stone 8x8\s+\(folder\)/);
    });
    await ok('asset sheet has an image and a legend', async () => {
        const r = await call('dps_asset_sheet', { paths: [P('objects/Blocks/Blue Dot.png'), P('missing.png')] });
        image(r);
        assert.match(txt(r), /1\. .*Blue Dot\.png\s+\(1x1 sq\)/);
        assert.match(txt(r), /2\. .*missing\.png\s+\[no preview\]/);
    });
    await ok('list and read maps; paths outside the Maps folder are refused', async () => {
        assert.match(txt(await call('dps_list_maps')), /mine\.dps/);
        assert.match(txt(await call('dps_read_map', { name: 'mine.dps' })), /"Obstacle": 2/);
        assert.ok((await call('dps_read_map', { name: '../x.dps' })).isError);
    });
    await ok('preview places objects with DPS\'s even-size offset', async () => {
        const r = await call('dps_preview', { name: 'mine.dps', px: 20 });
        assert.match(txt(r), /6x6 squares/);
        const img = image(r);
        assert.strictEqual(img.width, 120);
        assert.ok(near(pixel(img, 50, 50), [220, 0, 0]), 'red block centre at (2.5, 2.5)');
        assert.ok(near(pixel(img, 66, 66), [220, 0, 0]), 'red block reaches 3.5');
        assert.ok(near(pixel(img, 26, 26), [100, 100, 100]), 'floor left of the block (it starts at 1.5)');
        assert.ok(near(pixel(img, 100, 20), [0, 0, 220]), 'odd-sized object centred on begin (5, 1)');
        assert.ok(near(pixel(img, 60, 100), [0, 200, 0]), 'wall along y = 5');
    });
    await ok('preview draws Roll20 walls on top', async () => {
        const img = image(await call('dps_preview', { name: 'mine.dps', px: 20, walls: '!dpswalls W:0,1 6,1' }));
        assert.ok(near(pixel(img, 10, 20), [255, 40, 40]), 'red wall line at y = 1');
    });
    await ok('writing never replaces the user\'s files, only its own', async () => {
        const content = JSON.stringify(testMap);
        assert.ok((await call('dps_write_file', { name: 'mine.dps', content })).isError);
        assert.ok((await call('dps_write_file', { name: 'mine.dps', content, replace: true })).isError);
        assert.ok(!(await call('dps_write_file', { name: 'new.dps', content })).isError);
        assert.ok((await call('dps_write_file', { name: 'new.dps', content })).isError);
        assert.ok(!(await call('dps_write_file', { name: 'new.dps', content, replace: true })).isError);
        assert.ok((await call('dps_write_file', { name: 'bad.dps', content: '{"x":1}' })).isError);
        assert.ok((await call('dps_write_file', { name: 'sub/evil.dps', content })).isError);
        assert.strictEqual(fs.readFileSync(path.join(maps, 'new.dps'), 'utf8'), content);
    });
    await ok('export and window tools need Windows (or report a clear error)', async () => {
        const r = await call('dps_export', { name: 'mine.dps', test: true });
        if (process.platform !== 'win32') { assert.ok(r.isError); assert.match(txt(r), /Windows/); }
        assert.ok((await call('dps_export', { name: 'nope.dps' })).isError);
    });
    await c.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(n, 'checks passed');
})().catch(e => { console.error(e); process.exit(1); });
