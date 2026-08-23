/**
 * @file Story fingerprint (SPEC §7 identity support): a sha1 over the
 * compiled StoryIR with every positional/display detail stripped, so saves
 * bind to story *content*, never to whitespace or caret coordinates
 * (src/state/model.js consumes the hex digest as `storyHash`).
 *
 * Stripped everywhere, recursively: `pos`, `line`, `col`, `endCol`, and
 * passage-level `words`. Array order (including links[].id order) is kept —
 * choice identity is ordinal-based, so reordering is a content change.
 */

import { sha1Hex } from '../state/sha1.js';

const STRIP = new Set(['pos', 'line', 'col', 'endCol', 'words']);

/** Rebuild the value without any stripped keys; input is not mutated. */
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (STRIP.has(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return value;
}

/** Canonical JSON: object keys sorted at every level, arrays in order. */
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

/**
 * @param {import('../syntax/ast.js').StoryIR} story
 * @returns {string} 40-char lowercase sha1 hex
 */
export function storyFingerprint(story) {
  return sha1Hex(canonicalize(strip(story)));
}
