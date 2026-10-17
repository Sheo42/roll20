// node tests/dps-walls.test.js : tests sans dépendance de scripts/dps-walls.js (géométrie pure + flux complet avec un faux Roll20)
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const W = require('../scripts/dps-walls.js');

let n = 0;
function t(name, fn) { fn(); n += 1; console.log('ok', name); }

// ------------------------------------------------------------------ pure logic
t('parse points', () => {
    assert.deepStrictEqual(W.parsePoints(' 1,2  3.5,-4 '), [[1, 2], [3.5, -4]]);
    assert.throws(() => W.parsePoints('1;2'));
});

t('parse command', () => {
    const p = W.parseCommand('size=42x42 ; W:0,0 2,0 2,2 ; T:1,1 3,3 ; D:20,10 22,10 ; S:5,5 5,7 ; O:0,0 1,0');
    assert.deepStrictEqual(p.size, { w: 42, h: 42 });
    assert.deepStrictEqual(p.items.map(i => i.kind), ['wall', 'transparent', 'door', 'secret', 'oneWay']);
    assert.throws(() => W.parseCommand('D:1,1 2,2 3,3'));
    assert.throws(() => W.parseCommand('W:1,1'));
    assert.throws(() => W.parseCommand('X:1,1 2,2'));
});

t('html entities from chat are decoded', () => {
    assert.strictEqual(W.decodeEntities('a&amp;b&quot;'), 'a&b"');
});

t('pathv2: centre and relative points', () => {
    const p = W.pathv2Props([[16, 26], [16, 34], [18, 34]]);
    assert.strictEqual(p.shape, 'pol');
    assert.strictEqual(p.x, 17 * 70);
    assert.strictEqual(p.y, 30 * 70);
    assert.deepStrictEqual(JSON.parse(p.points), [[0, 0], [0, 560], [140, 560]]);
});

t('legacy path: left/top centre, M then L', () => {
    const p = W.legacyPathProps([[0, 0], [2, 0], [2, 1]]);
    assert.strictEqual(p.left, 70); assert.strictEqual(p.top, 35);
    assert.strictEqual(p.width, 140); assert.strictEqual(p.height, 70);
    assert.deepStrictEqual(JSON.parse(p.path), [['M', 0, 0], ['L', 140, 0], ['L', 140, 70]]);
});

t('door: inverted y axis, handles around the centre', () => {
    const d = W.doorProps([[20, 10], [22, 10]]);
    assert.strictEqual(d.x, 21 * 70);
    assert.strictEqual(d.y, -700);
    assert.deepStrictEqual(d.path, { handle0: { x: -70, y: 0 }, handle1: { x: 70, y: 0 } });
    const v = W.doorProps([[5, 5], [5, 7]]);         // vertical door: top handle has positive y
    assert.deepStrictEqual(v.path, { handle0: { x: 0, y: 70 }, handle1: { x: 0, y: -70 } });
});

// ------------------------------------------------------------------ fake Roll20
function fakeRoll20(release) {
    const objs = {}; let nextId = 1; const handlers = {}; const chats = [];
    function mk(type, props) {
        const id = 'id' + (nextId++);
        const data = Object.assign({ _id: id, _type: type }, props);
        const o = {
            id, get: k => data[k], set: kv => Object.assign(data, kv),
            remove: () => { delete objs[id]; }, _data: data
        };
        objs[id] = o; return o;
    }
    const page = mk('page', { width: 25, height: 25 });
    const player = mk('player', { _lastpage: page.id });
    const ctx = {
        state: {}, log: () => {}, Object, JSON, Math, String, Error, parseFloat, isFinite,
        on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
        getObj: (type, id) => (objs[id] && objs[id].get('_type') === type ? objs[id] : undefined),
        createObj: (type, props) => mk(type, props),
        sendChat: (who, txt) => chats.push(txt),
        playerIsGM: id => id === player.id,
        toBack: () => {},
        Campaign: () => ({ get: k => (k === 'release' ? release : k === 'playerpageid' ? page.id : undefined) })
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'dps-walls.js'), 'utf8'), ctx);
    const send = content => handlers['chat:message'].forEach(f => f({ type: 'api', content, who: 'Sheo (GM)', playerid: player.id }));
    const of = type => Object.values(objs).filter(o => o.get('_type') === type);
    return { send, of, chats, page, ctx, player };
}

const CMD = fs.readFileSync(path.join(__dirname, 'fixtures', 'ermitage_v4.roll20.txt'), 'utf8').trim();

t('jumpgate: draws pathv2 walls and doors, sets the page size', () => {
    const R = fakeRoll20('jumpgate');
    R.send(CMD);
    assert.match(R.chats.at(-1), /walls 15, transparent 1, one-way 0, doors 3, secret doors 0, page 42x42/);
    assert.strictEqual(R.of('pathv2').length, 16);
    assert.strictEqual(R.of('door').length, 3);
    assert.strictEqual(R.page.get('width'), 42);
    const layers = new Set(R.of('pathv2').map(p => p.get('layer')));
    assert.deepStrictEqual([...layers], ['walls']);
    const types = R.of('pathv2').map(p => p.get('barrierType')).sort();
    assert.strictEqual(types.filter(x => x === 'transparent').length, 1);
    // tower door lands on the grid line y = 10 squares, x 20..22
    const towerDoor = R.of('door').find(d => d.get('y') === -700);
    assert.ok(towerDoor, 'tower door at y=10');
    assert.strictEqual(towerDoor.get('x'), 1470);
    assert.strictEqual(towerDoor.get('isOpen'), false);
});

t('running again replaces, clear removes', () => {
    const R = fakeRoll20('jumpgate');
    R.send(CMD); R.send(CMD);
    assert.strictEqual(R.of('pathv2').length, 16);
    assert.strictEqual(R.of('door').length, 3);
    assert.match(R.chats.at(-1), /replaced 19/);
    R.send('!dpswalls clear');
    assert.strictEqual(R.of('pathv2').length + R.of('door').length, 0);
    assert.match(R.chats.at(-1), /removed 19/);
});

t('legacy game: uses classic paths', () => {
    const R = fakeRoll20('legacy');
    R.send('!dpswalls W:0,0 1,0');
    assert.strictEqual(R.of('path').length, 1);
    assert.strictEqual(R.of('pathv2').length, 0);
});

t('image goes on the map layer, page-sized, thumb url; kept when walls are redrawn', () => {
    const R = fakeRoll20('jumpgate');
    R.send('!dpswalls size=42x42 ; W:0,0 1,0');
    R.send('!dpswalls img https://s3.amazonaws.com/files.d20.io/images/1/abc/original.jpg?123');
    const g = R.of('graphic')[0];
    assert.strictEqual(g.get('layer'), 'map');
    assert.strictEqual(g.get('width'), 2940);
    assert.strictEqual(g.get('left'), 1470);
    assert.match(g.get('imgsrc'), /\/thumb\.jpg\?123$/);
    R.send('!dpswalls W:0,0 2,0');
    assert.strictEqual(R.of('graphic').length, 1);
});

t('non-GM and bad input', () => {
    const R = fakeRoll20('jumpgate');
    R.ctx.playerIsGM = () => false;
    R.send('!dpswalls W:0,0 1,0');
    assert.strictEqual(R.of('pathv2').length, 0);
    R.ctx.playerIsGM = id => id === R.player.id;
    R.send('!dpswalls W:0,0');
    assert.match(R.chats.at(-1), /error/);
});

console.log(n, 'tests passed');
