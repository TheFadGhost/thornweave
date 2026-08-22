/**
 * @file Runtime values and coercion rules (SPEC §4.1, §5.3, §6). Every story
 * value is a number, string, boolean, or list (array) thereof.
 */
import { fault } from '../state/model.js';

/**
 * @param {*} v story value
 * @returns {'number'|'string'|'boolean'|'list'}
 */
export function typeOf(v) {
  if (Array.isArray(v)) return 'list';
  switch (typeof v) {
    case 'number': return 'number';
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    default: throw fault('runtime', `unsupported value type '${v === null ? 'null' : typeof v}'`);
  }
}

/**
 * Truthiness (SPEC §5.3): false, 0, "", [] are falsy; everything else truthy.
 * NaN is a number distinct from 0 and therefore truthy.
 * @param {*} v
 * @returns {boolean}
 */
export function truthy(v) {
  if (v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Renders a value per §4.1: canonical decimal numbers (integers without a
 * decimal point), raw strings, true/false, lists as '[a, b, c]' recursively.
 * @param {*} v
 * @returns {string}
 */
export function renderValue(v) {
  const t = typeOf(v);
  if (t === 'string') return v;
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'list') return `[${v.map(renderValue).join(', ')}]`;
  return String(v);
}

/**
 * Same-type deep equality; cross-type equality is false, never an error.
 * Lists compare element-wise, recursively.
 * @param {*} a @param {*} b
 * @returns {boolean}
 */
export function equals(a, b) {
  const ta = typeOf(a);
  if (ta !== typeOf(b)) return false;
  if (ta === 'list') {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!equals(a[i], b[i])) return false;
    }
    return true;
  }
  return a === b;
}

/**
 * SPEC `+`: number+number adds; string on either side concatenates using the
 * §4.1 rendering; list+list concatenates; any other combination faults.
 * @param {*} l @param {*} r
 * @returns {*}
 */
export function addValues(l, r) {
  const lt = typeOf(l);
  const rt = typeOf(r);
  if (lt === 'string' || rt === 'string') return renderValue(l) + renderValue(r);
  if (lt === 'number' && rt === 'number') return l + r;
  if (lt === 'list' && rt === 'list') return [...l, ...r];
  throw fault('runtime', `operator '+' cannot combine ${lt} and ${rt}`);
}
