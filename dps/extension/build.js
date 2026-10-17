// Bundles src/ into pkg/ (one JS file + the PowerShell driver + default click points + manifest).
'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const out = path.join(__dirname, 'pkg');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'server'), { recursive: true });
esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src', 'index.js')], bundle: true, platform: 'node', target: 'node18',
                    outfile: path.join(out, 'server', 'index.js'), logLevel: 'warning' });
for (const f of ['dps_ui.ps1', 'dps_ui.json']) { fs.copyFileSync(path.join(__dirname, 'src', f), path.join(out, 'server', f)); }
fs.copyFileSync(path.join(__dirname, 'manifest.json'), path.join(out, 'manifest.json'));
console.log('built', out);
