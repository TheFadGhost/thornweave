import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createStoryServer } from '../../src/server.js';

test('play server serves story.json, index and static assets in-process', async (t) => {
  const handler = createStoryServer('stories/example.thorn', { watch: false, debug: true });
  const server = createServer(handler);
  await new Promise((ok) => server.listen(0, ok));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const payload = await (await fetch(`${base}/story.json`)).json();
  assert.equal(payload.ok, true);
  assert.equal(payload.debug, true);
  assert.ok(Object.keys(payload.story.passages).length >= 2);

  const page = await (await fetch(base)).text();
  assert.match(page, /\/player\/app\.js/);
  assert.match(page, /<!doctype html>/i);

  const app = await fetch(`${base}/player/app.js`);
  assert.equal(app.status, 200);
  const css = await fetch(`${base}/player/styles/tokens.css`);
  assert.equal(css.status, 200);
  assert.match(await css.text(), /--bg:/);

  const missing = await fetch(`${base}/nope.js`);
  assert.equal(missing.status, 404);
});

test('server rejects story files that do not exist with a clean error', async () => {
  const handler = createStoryServer('stories/does-not-exist.thorn', {});
  const server = createServer(handler);
  await new Promise((ok) => server.listen(0, ok));
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/story.json`);
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.match(body.message, /not found/);
  server.closeAllConnections(); await new Promise((ok) => server.close(ok));
});
