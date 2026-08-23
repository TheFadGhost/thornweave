/**
 * @file Node filesystem save storage (CLI tools). Browser players pass a
 * localStorage adapter instead.
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fault } from './model.js';

function safeKey(k) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(k)) throw fault('internal', `bad save key '${k}'`);
  return `${k}.json`;
}

export function nodeStorage(dir) {
  return {
    get(key) {
      try {
        return readFileSync(join(dir, safeKey(key)), 'utf8');
      } catch {
        return null;
      }
    },
    set(key, val) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, safeKey(key)), val, 'utf8');
    },
    delete(key) {
      try { unlinkSync(join(dir, safeKey(key))); } catch {}
    },
    keys() {
      try {
        return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
      } catch {
        return [];
      }
    },
  };
}
