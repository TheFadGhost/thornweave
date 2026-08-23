/**
 * @file Permanent WCAG 2.x contrast verification against docs/DESIGN.md
 * "Colour tokens by role": parses hex values out of player/styles/tokens.css
 * for every [data-theme] block and asserts, in ALL FOUR themes:
 *   ink/bg >= 7, ink-muted/bg >= 4.5, link/bg >= 4.5,
 *   link-visited/bg >= 4.5, countdown/bg >= 4.5, focus/bg >= 3.
 * Zero dependencies. sRGB, 8-bit hex, WCAG relative-luminance formula.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKENS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'player', 'styles', 'tokens.css');

/** Parse each [data-theme="x"] block into a map of custom-property -> lowercase #rrggbb. */
export function parseThemeBlocks(cssText) {
  const themes = {};
  const blockRe = /\[data-theme=["']([a-z-]+)["']\]\s*\{([^}]*)\}/g;
  let block;
  while ((block = blockRe.exec(cssText)) !== null) {
    const vars = {};
    const varRe = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
    let v;
    while ((v = varRe.exec(block[2])) !== null) vars[v[1]] = v[2].toLowerCase();
    themes[block[1]] = vars;
  }
  return themes;
}

/** Linearise one 8-bit sRGB channel per WCAG 2.x definition. */
function linear(channel8) {
  const c = channel8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of an #rrggbb colour. */
export function luminance(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  assert.ok(m, `not a 6-digit hex colour: ${hex}`);
  const h = m[1];
  const r = linear(parseInt(h.slice(0, 2), 16));
  const g = linear(parseInt(h.slice(2, 4), 16));
  const b = linear(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colours. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const REQUIRED_PAIRS = [
  { token: '--ink', against: '--bg', min: 7 },
  { token: '--ink-muted', against: '--bg', min: 4.5 },
  { token: '--link', against: '--bg', min: 4.5 },
  { token: '--link-visited', against: '--bg', min: 4.5 },
  { token: '--countdown', against: '--bg', min: 4.5 },
  { token: '--focus', against: '--bg', min: 3 },
];

const THEMES = ['light', 'dark', 'sepia', 'contrast'];
const themes = parseThemeBlocks(readFileSync(TOKENS_PATH, 'utf8'));

test('tokens.css defines all four themes required by DESIGN.md', () => {
  for (const t of THEMES) {
    assert.ok(themes[t], `[data-theme="${t}"] block missing from ${TOKENS_PATH}`);
  }
});

for (const theme of THEMES) {
  test(`theme "${theme}" meets DESIGN.md contrast requirements`, () => {
    const vars = themes[theme];
    assert.ok(vars, `no parsed variables for theme "${theme}"`);
    for (const { token, against, min } of REQUIRED_PAIRS) {
      assert.ok(vars[token], `${token} missing in theme "${theme}"`);
      assert.ok(vars[against], `${against} missing in theme "${theme}"`);
      const ratio = contrastRatio(vars[token], vars[against]);
      assert.ok(
        ratio >= min,
        `${theme}: ${token} (${vars[token]}) on ${against} (${vars[against]}) = ${ratio.toFixed(2)}:1, requires >= ${min}:1`,
      );
    }
  });
}
