#!/usr/bin/env node
// DPS Maps — MCP server (stdio) for Dungeon Painter Studio: search the asset library, look at assets,
// read/write maps in the Maps folder and render previews from the real assets.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { DPS } = require('./dps');
const { execFile } = require('child_process');

const VERSION = '0.2.0';
const env = k => (process.env[k] && !/^\$\{/.test(process.env[k]) ? process.env[k] : null);
const dps = new DPS({
    install: env('DPS_INSTALL') || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Dungeon Painter Studio',   // Steam default
    mapsDir: env('DPS_MAPS_DIR') || path.join(os.homedir(), 'Documents')
});

// files this extension wrote: only those may be replaced (the user's own maps never are)
const registryFile = () => path.join(dps.mapsDir, '_dps_tools', 'mcp_written.json');
function registry() { try { return JSON.parse(fs.readFileSync(registryFile(), 'utf8')); } catch (e) { return {}; } }
function remember(name) {
    const r = registry(); r[name] = new Date().toISOString();
    try { fs.mkdirSync(path.dirname(registryFile()), { recursive: true }); fs.writeFileSync(registryFile(), JSON.stringify(r, null, 1)); } catch (e) { /* best effort */ }
}

const text = t => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });
const fail = e => ({ isError: true, content: [{ type: 'text', text: 'Error: ' + (e && e.message ? e.message : String(e)) }] });
const wrap = fn => async args => { try { return await fn(args || {}); } catch (e) { return fail(e); } };

const server = new McpServer({ name: 'dps-maps', version: VERSION });

server.registerTool('dps_info', {
    title: 'DPS: configuration and library summary',
    description: 'Shows the DPS install and Maps folders this server uses and how many floors, walls and objects each asset collection holds.',
    inputSchema: {},
    annotations: { readOnlyHint: true }
}, wrap(async () => text({ version: VERSION, install: dps.install, mapsDir: dps.mapsDir,
    collectionsFound: fs.existsSync(dps.collections), assets: dps.ensureIndex().length, byCollection: dps.collectionsSummary() })));

server.registerTool('dps_find_assets', {
    title: 'DPS: search assets',
    description: 'Search the installed asset library by words in the path (all must match, case-insensitive). ' +
        'Returns DPS paths exactly as a .dps file stores them (TextureItemHelper.path), the kind (floor, wall, object), ' +
        'whether the asset is a folder, and the size in squares measured from the image (200 px per square at scale 1).',
    inputSchema: {
        words: z.string().describe('Space-separated words, e.g. "pillar stone" or "water"'),
        kind: z.enum(['floor', 'wall', 'object']).optional(),
        collection: z.string().optional().describe('Part of a collection name, e.g. "Dungeon Decor"'),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional()
    },
    annotations: { readOnlyHint: true }
}, wrap(async a => {
    const r = dps.search({ words: a.words.split(/\s+/), kind: a.kind, collection: a.collection, limit: a.limit || 40, offset: a.offset || 0 });
    const lines = r.results.map(e => `${e.kind.padEnd(6)} ${e.size ? (e.size[0] + 'x' + e.size[1]).padEnd(10) : '?'.padEnd(10)} ${e.path}${e.folder ? '  (folder)' : ''}`);
    return text(`${r.total} match(es)${r.total > r.results.length ? `, showing ${(a.offset || 0) + 1}-${(a.offset || 0) + r.results.length}` : ''}\n` + lines.join('\n'));
}));

server.registerTool('dps_asset_sheet', {
    title: 'DPS: look at assets',
    description: 'Returns one JPEG with numbered thumbnails of the given assets (DPS paths from dps_find_assets), drawn on grey ' +
        'with faint red lines every square so sizes and footprints are visible, plus a numbered legend. Up to 30 assets.',
    inputSchema: {
        paths: z.array(z.string()).min(1).max(30),
        cell: z.number().int().min(100).max(400).optional().describe('Thumbnail cell size in px (default 220)'),
        columns: z.number().int().min(1).max(8).optional()
    },
    annotations: { readOnlyHint: true }
}, wrap(async a => {
    const s = dps.sheet(a.paths, a.cell || 220, a.columns || 5);
    return { content: [{ type: 'image', data: Buffer.from(s.jpeg).toString('base64'), mimeType: 'image/jpeg' }, { type: 'text', text: s.legend }] };
}));

server.registerTool('dps_list_maps', {
    title: 'DPS: list maps',
    description: 'Lists .dps maps, exported .jpg files and .roll20.txt wall lines in the Maps folder, optionally filtered by part of the name.',
    inputSchema: { filter: z.string().optional() },
    annotations: { readOnlyHint: true }
}, wrap(async a => text(dps.listMaps(a.filter))));

server.registerTool('dps_read_map', {
    title: 'DPS: read a map',
    description: 'Reads a .dps map from the Maps folder. By default returns a summary (object counts, layer groups, assets used); ' +
        'raw=true returns the full JSON text.',
    inputSchema: { name: z.string().describe('File name in the Maps folder, e.g. "caveau.dps"'), raw: z.boolean().optional() },
    annotations: { readOnlyHint: true }
}, wrap(async a => {
    if (a.raw) { return text(fs.readFileSync(dps.mapPath(a.name), 'utf8')); }
    return text(dps.summarize(dps.readMap(a.name)));
}));

server.registerTool('dps_write_file', {
    title: 'DPS: save a map or wall line',
    description: 'Writes a .dps map (JSON text) or a .roll20.txt wall line into the Maps folder. Never replaces a file the user made: ' +
        'an existing name is refused unless this server wrote that file earlier and replace=true.',
    inputSchema: {
        name: z.string().describe('New file name, e.g. "crypte_v2.dps"'),
        content: z.string(),
        replace: z.boolean().optional().describe('Replace a file this server wrote before')
    },
    annotations: { destructiveHint: false }
}, wrap(async a => {
    const mine = !!registry()[a.name];
    if (a.replace && !mine) { throw new Error(`${a.name} was not written by this server, so it will not be replaced. Use a new name.`); }
    const r = dps.writeFile(a.name, a.content, !!(a.replace && mine));
    remember(a.name);
    return text(r);
}));

server.registerTool('dps_preview', {
    title: 'DPS: preview a map',
    description: 'Renders a .dps map from the real asset images (floors, polygons, walls, objects in layer order; effects, lights, ' +
        'brushes and text are not drawn) and returns a JPEG. Give the name of a map in the Maps folder, or its JSON as content. ' +
        'Objects are placed with DPS\'s own rule, so positions match a DPS export.',
    inputSchema: {
        name: z.string().optional(),
        content: z.string().optional(),
        px: z.number().int().min(6).max(70).optional().describe('Pixels per square (default 24)'),
        grid: z.boolean().optional(),
        walls: z.string().optional().describe('Overlay Roll20 walls: name of a .roll20.txt file in the Maps folder, or the line itself'),
        region: z.array(z.number()).length(4).optional().describe('Only this area, in squares: [x, y, width, height]')
    },
    annotations: { readOnlyHint: true }
}, wrap(async a => {
    if (!a.name && !a.content) { throw new Error('give name or content'); }
    const map = a.content ? JSON.parse(a.content) : dps.readMap(a.name);
    let barriers = null;
    if (a.walls) { barriers = /\.txt$/i.test(a.walls) ? fs.readFileSync(dps.mapPath(a.walls), 'utf8') : a.walls; }
    const opts = { grid: !!a.grid, barriers };
    if (a.region) { [opts.originX, opts.originY, opts.width, opts.height] = a.region; }
    const r = dps.render(map, a.px || 24, opts);
    const notes = [`${r.width}x${r.height} squares at ${a.px || 24} px/square`];
    if (Object.keys(r.skipped).length) { notes.push('not drawn: ' + JSON.stringify(r.skipped)); }
    if (r.missing.length) { notes.push('missing images: ' + r.missing.join(', ')); }
    return { content: [{ type: 'image', data: Buffer.from(r.jpeg).toString('base64'), mimeType: 'image/jpeg' }, { type: 'text', text: notes.join('\n') }] };
}));

// ------------------------------------------------------------------ driving the DPS window (Windows only)
const toolsDir = () => path.join(dps.mapsDir, '_dps_tools', 'mcp');
// click points: <Maps>/_dps_tools/mcp/dps_ui.json if present, else the default shipped with the extension
const pointsFile = () => { const p = path.join(toolsDir(), 'dps_ui.json'); return fs.existsSync(p) ? p : path.join(__dirname, 'dps_ui.json'); };
function uiScript() {                               // a copy in _dps_tools\mcp overrides the bundled script
    const over = path.join(toolsDir(), 'dps_ui.ps1');
    return fs.existsSync(over) ? over : path.join(__dirname, 'dps_ui.ps1');
}
function runUi(args, timeoutMs) {
    if (process.platform !== 'win32') { return Promise.reject(new Error('driving DPS needs Windows')); }
    const exe = path.join(dps.install, 'DPS.exe');
    const argv = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', uiScript(), '-Exe', exe].concat(args);
    return new Promise((resolve, reject) => {
        execFile('powershell.exe', argv, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
            const line = String(stdout || '').trim().split(/\r?\n/).filter(l => l.startsWith('{')).pop();
            if (line) { try { return resolve(JSON.parse(line)); } catch (e) { /* fall through */ } }
            reject(new Error((err ? err.message + '\n' : '') + String(stderr || stdout || '').slice(0, 1500)));
        });
    });
}

server.registerTool('dps_window', {
    title: 'DPS: window information',
    description: 'Reports whether Dungeon Painter Studio is running and its window geometry in physical pixels (window, client area, ' +
        'DPI, screen), whether it is in front, and any open Windows dialogs. Sends no clicks or keys. Used to calibrate dps_export.',
    inputSchema: {},
    annotations: { readOnlyHint: true }
}, wrap(async () => text(await runUi(['-Action', 'window'], 30000))));

server.registerTool('dps_export', {
    title: 'DPS: open a map and export the JPG',
    description: 'Opens a .dps map from the Maps folder in Dungeon Painter Studio and exports it as JPG (DPS\'s own render), saved as ' +
        '"name(WxH).jpg" in the Maps folder, or in _dps_tools\\export_tests with test=true. Takes the mouse and keyboard for about ' +
        '15-60 s: the user should not touch the PC meanwhile. Closes the map open in DPS without saving it. Starts DPS if needed. ' +
        'Never overwrites an existing export unless this server wrote it and replace=true. dry_run=true only reports the click points.',
    inputSchema: {
        name: z.string().describe('Map file name in the Maps folder, e.g. "crypte_v2.dps"'),
        test: z.boolean().optional(),
        replace: z.boolean().optional(),
        load_wait: z.number().int().min(1).max(60).optional().describe('Seconds to let DPS load the map (default 5)'),
        dry_run: z.boolean().optional()
    }
}, wrap(async a => {
    if (!fs.existsSync(pointsFile())) { throw new Error('not calibrated yet: ' + pointsFile() + ' is missing'); }
    const mapFile = dps.mapPath(a.name);
    if (!fs.existsSync(mapFile)) { throw new Error('no such map: ' + a.name); }
    const ext = dps.extent(dps.readMap(a.name));
    const outName = a.name.replace(/\.dps$/i, '') + `(${ext.w}x${ext.h}).jpg`;
    const outDir = a.test ? path.join(dps.mapsDir, '_dps_tools', 'export_tests') : dps.mapsDir;
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, outName);
    const key = (a.test ? '_dps_tools/export_tests/' : '') + outName;
    if (fs.existsSync(out) && !a.dry_run) {
        if (!(a.replace && registry()[key])) { throw new Error(`${out} already exists and will not be overwritten` + (registry()[key] ? ' (pass replace=true)' : '')); }
        fs.unlinkSync(out);
    }
    const args = ['-Action', 'export', '-MapPath', mapFile, '-OutPath', out, '-PointsFile', pointsFile(), '-LoadWait', String(a.load_wait || 5)];
    if (a.dry_run) { args.push('-DryRun'); }
    const r = await runUi(args, 300000);
    if (r.ok && !a.dry_run) { remember(key); }
    return text(r);
}));

server.registerTool('dps_reindex', {
    title: 'DPS: rescan the asset library',
    description: 'Rescans data/collections, e.g. after installing a new asset pack.',
    inputSchema: {},
    annotations: { readOnlyHint: true }
}, wrap(async () => { dps.sizeCache.clear(); return text(`${dps.buildIndex().length} assets indexed`); }));

// Always start: Claude's built-in Node may load this file through a launcher, so require.main is not this module.
server.connect(new StdioServerTransport()).catch(e => { console.error(e); process.exit(1); });
console.error(`dps-maps ${VERSION} ready (install: ${dps.install}, maps: ${dps.mapsDir})`);
