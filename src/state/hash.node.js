/**
 * @file Node-only state hashing (SPEC §9 determinism tests). Kept apart from
 * the browser-safe model so player/export bundles never pull node:crypto.
 */
import { createHash } from 'node:crypto';
import { serializeState } from './model.js';

export function stateHash(st) {
  return createHash('sha256').update(serializeState(st)).digest('hex');
}
