/**
 * @file Local reading server (`play`) and live-reload preview (`watch`).
 * Serves the player app plus the compiled story; watch adds SSE reload.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFile } from './compile/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function serveStatic(res, urlPath) {
  const abs = resolve(ROOT, '.' + urlPath);
  if (abs !== ROOT && !abs.startsWith(ROOT + '\\') && !abs.startsWith(ROOT + '/')) {
    res.writeHead(403).end('forbidden');
    return true;
  }
  try {
    const info = await stat(abs);
    if (!info.isFile()) return false;
    res.writeHead(200, { 'content-type': MIME[extname(abs)] ?? 'application/octet-stream' });
    readFile(abs, (e, buf) => {
      if (e) res.end();
      else res.end(buf);
    });
    return true;
  } catch {
    return false;
  }
}

function storyPayload(file) {
  return compileFile(file).then((c) => {
    if (!c.ok) {
      const err = new Error('story has errors');
      err.payload = { ok: false, diagnostics: c.diagnostics };
      throw err;
    }
    return {
      ok: true,
      fingerprint: c.fingerprint,
      story: c.story,
      sourceText: c.sourceText,
    };
  });
}

export async function cmdPlay(flags, c) {
  return serve(flags, c, { watch: false });
}

export async function cmdWatch(flags, c) {
  return serve(flags, c, { watch: true });
}

export function createStoryServer(file, { watch = false, debug = false } = {}) {
  const clients = new Set();
  let current = null;
  let dirty = true;

  const getPayload = async () => {
    if (!dirty && current) return current;
    current = await storyPayload(file);
    dirty = false;
    return current;
  };

  const invalidate = () => {
    dirty = true;
    for (const res of clients) res.write('event: reload\ndata: {}\n\n');
  };

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://thornweave.local');
    try {
      if (url.pathname === '/events' && watch) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write('retry: 500\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname === '/story.json') {
        const payload = await getPayload();
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ...payload, debug }));
        return;
      }
      const served = await serveStatic(res, url.pathname === '/' ? '/player/index.html' : url.pathname);
      if (!served) {
        res.writeHead(404).end('not found');
      }
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ ok: false, message: e.message, diagnostics: e.payload?.diagnostics ?? [] }));
    }
  };
  handler.invalidate = invalidate;
  handler.getPayload = getPayload;
  return handler;
}

async function serve(flags, c, { watch }) {
  const file = flags._[0];
  if (!file) {
    console.error('usage: thornweave play <story.thorn>');
    return 2;
  }
  const port = flags.port || 7337;
  const debug = !!flags.debug;

  const handlerRef = createStoryServer(file, { watch, debug });
  let watcher = null;
  if (watch) {
    const { watch: fsWatch } = await import('node:fs');
    watcher = fsWatch(file, () => handlerRef.invalidate());
  }

  const server = createServer(handlerRef);
  server.on('close', () => { if (watcher) watcher.close(); });
  process.once('SIGINT', () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });

  await new Promise((ok) => server.listen(port, ok));
  console.log(c.bold(`thornweave ${watch ? 'preview' : 'player'}`) + c.dim(` — ${watch ? 'live-reload on save' : 'reading server'}`));
  console.log(`open ${c.cyan(`http://localhost:${port}`)}${debug ? c.dim('   (debug tools enabled)') : ''}`);
  console.log(c.dim('ctrl-c to stop'));
  return 0;
}
