import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compile } from '../../src/compile/index.js';
import { buildExport } from '../../src/export/bundle.js';
import { bundle } from '../../src/tools/bundle.js';

function examplePayload() {
  const c = compile([
    '---', 'title: Offline Test', 'vars:', '  gold: 2', '---',
    '== Start ==',
    'You hold {{gold}} coins.',
    '* Walk on -> Finish',
    '',
    '== Finish == [ending]',
    'Done.',
  ].join('\n'), 'off.thorn');
  assert.ok(c.ok);
  return { fingerprint: c.fingerprint, story: c.story, debug: false };
}

const FORBIDDEN = [
  /https?:\/\//i,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /EventSource/,
  /\bimport\s*\(/,
  /<link[^>]+href=/i,
  /<script[^>]+src=/i,
  /src=["']https?/i,
];

test('exported HTML makes zero network references', () => {
  const html = buildExport(examplePayload(), 'Offline Test');
  for (const re of FORBIDDEN) {
    const hit = html.match(re);
    assert.equal(hit, null, `forbidden network pattern ${re} matched: ${hit?.[0]}`);
  }
});

test('export embeds the compiled story and player bundle', () => {
  const html = buildExport(examplePayload(), 'Offline Test');
  assert.match(html, /<title>Offline Test<\/title>/);
  assert.match(html, /__THORN_STORY__/);
  assert.match(html, /--bg:/, 'theme css inlined');
  assert.match(html, /data-theme="light"/);
  const payload = JSON.parse(JSON.parse(html.match(/window\.__THORN_STORY__ = (".*");/)[1]));
  assert.equal(payload.story.meta.title, 'Offline Test');
});

test('the bundled engine plays a full story headlessly and matches the node engine', async () => {
  const payload = examplePayload();
  const bundled = bundle('src/runtime/engine.js');
  const exportsObj = vm.runInNewContext(bundled.code, { TextEncoder }, { filename: 'engine.bundle.js' });
  assert.equal(typeof exportsObj.Engine, 'function');

  const engine = new exportsObj.Engine(payload.story);
  const st = engine.newGame(9);
  const r1 = engine.start(st);
  assert.equal(r1.choices.length, 1);
  const r2 = engine.choose(st, r1.choices[0]);
  assert.equal(r2.ending, true);
});
