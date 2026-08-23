/**
 * @file Self-contained offline HTML export (PLAN feature 10). Inlines the
 * compiled story, the theme CSS, and the bundled player. The result performs
 * zero network requests — verified by tests/export.test.js.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '../tools/bundle.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(p) {
  return readFileSync(join(ROOT, p), 'utf8');
}

function themeCss() {
  return ['player/styles/tokens.css', 'player/styles/base.css', 'player/styles/components.css']
    .map((p) => read(p))
    .join('\n\n');
}

export function buildExport(storyPayload, title = 'A Thornweave Story') {
  const app = bundle('player/app.js', { offline: true });
  const safeTitle = String(title).replace(/[<>&]/g, '');
  const embedded = JSON.stringify(JSON.stringify(storyPayload))
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
${themeCss()}
</style>
</head>
<body>
<div id="app" class="app"></div>
<noscript>This story needs JavaScript to play.</noscript>
<script>
(function () {
  var t = 'light';
  try { t = window.localStorage.getItem('tw.theme') || t; } catch (e) {}
  document.documentElement.dataset.theme = t;
})();
window.__THORN_STORY__ = ${embedded};
window.__THORN_OFFLINE__ = true;
</script>
<script>
${app.code}
</script>
</body>
</html>
`;
}

export function writeExport(storyPayload, outPath, title) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buildExport(storyPayload, title), 'utf8');
}
