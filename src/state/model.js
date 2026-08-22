/**
 * @file State model contract (SPEC §6, §8, §9). The serialized form is the
 * wire format for saves, rewind snapshots, and determinism hashes.
 */
import { createHash } from 'node:crypto';
import { FORMAT_VERSION } from '../syntax/ast.js';

/**
 * Runtime state. `vars` holds values; `vtypes` their declared types.
 * @typedef {object} GameState
 * @property {number} v            schema version
 * @property {string} storyHash    sha1 of compiled story JSON — save binding
 * @property {number} seed
 * @property {number} rngWord      mulberry32 mutable word (SPEC §9)
 * @property {number} turn
 * @property {string} current      current passage name
 * @property {Object<string, *>} vars
 * @property {Object<string, 'number'|'string'|'boolean'|'list'>} vtypes
 * @property {Object<string, number>} inv       item -> count >= 0
 * @property {Object<string, number>} visited   passage -> entries
 * @property {Object<string, boolean>} consumed once-link ids (SPEC §7)
 */

/** @returns {GameState} */
export function createState(storyHash, seed, meta) {
  const vars = {};
  const vtypes = {};
  for (const [name, tv] of Object.entries(meta?.varsInit ?? {})) {
    vars[name] = cloneValue(tv.v);
    vtypes[name] = tv.t;
  }
  return {
    v: 1,
    storyHash,
    seed: seed >>> 0,
    rngWord: seed >>> 0,
    turn: 0,
    current: '',
    vars,
    vtypes,
    inv: {},
    visited: {},
    consumed: {},
  };
}

export function serializeState(st) {
  return JSON.stringify(stable(st));
}

/** @returns {GameState} throws Fault('save-corrupt') on bad input */
export function deserializeState(json) {
  let raw;
  try { raw = JSON.parse(json); } catch { throw fault('save-corrupt', 'save is not valid JSON'); }
  if (!raw || typeof raw !== 'object') throw fault('save-corrupt', 'save is not an object');
  if (raw.v !== 1) throw fault('save-version', `save schema version ${raw.v} not supported (expected 1)`);
  for (const k of ['storyHash', 'seed', 'rngWord', 'turn', 'current', 'vars', 'vtypes', 'inv', 'visited', 'consumed']) {
    if (!(k in raw)) throw fault('save-corrupt', `save missing field '${k}'`);
  }
  if (typeof raw.storyHash !== 'string' || typeof raw.current !== 'string')
    throw fault('save-corrupt', 'save fields have wrong types');
  return structuredClone(raw);
}

/** Binds a save to a story; mismatch must be rejected cleanly by loaders. */
export function stateMatchesStory(st, storyHash) {
  return st.storyHash === storyHash;
}

/** Deterministic hash of full state (SPEC §9 tests). */
export function stateHash(st) {
  return createHash('sha256').update(serializeState(st)).digest('hex');
}

export function deepClone(st) {
  return structuredClone(st);
}

function cloneValue(v) {
  if (Array.isArray(v)) return v.map(cloneValue);
  return v;
}

/** Key-order-stable stringify for hashing/serialization. */
function stable(x) {
  if (Array.isArray(x)) return x.map(stable);
  if (x && typeof x === 'object') {
    const out = {};
    for (const k of Object.keys(x).sort()) out[k] = stable(x[k]);
    return out;
  }
  return x;
}

export function fault(kind, message, pos) {
  const e = new Error(message);
  e.fault = kind;         // 'runtime' | 'save-*' | 'story-missing' | …
  e.pos = pos ?? null;
  return e;
}
