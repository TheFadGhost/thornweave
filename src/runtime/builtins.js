/**
 * @file Built-in function table (SPEC §5.4). Each entry: { min, max, params,
 * fn } where min/max bound the arity (max null = unbounded) and params lists
 * the expected type per argument ('number'|'string'|'boolean'|'list'|null for
 * any); the last entry repeats for variadic calls. Arity/type enforcement is
 * done by the call dispatcher in expressions.js.
 */
import { fault } from '../state/model.js';
import { renderValue, truthy } from './values.js';

function asciiUpper(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 97 && c <= 122 ? String.fromCharCode(c - 32) : s[i];
  }
  return out;
}

function asciiLower(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i];
  }
  return out;
}

const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/**
 * @typedef {object} Builtin
 * @property {number} min
 * @property {(number|null)} max
 * @property {Array<'number'|'string'|'boolean'|'list'|null>} params
 * @property {(env: *, ...args: *) => *} fn
 */

/** @type {Object<string, Builtin>} */
export const BUILTINS = {
  visited: {
    min: 1, max: 1, params: ['string'],
    fn(env, name) { return env.ctx.visited(name); },
  },
  seen: {
    min: 1, max: 1, params: ['string'],
    fn(env, name) { return Boolean(env.ctx.seen(name)); },
  },
  has: {
    min: 1, max: 1, params: ['string'],
    fn(env, item) { return Boolean(env.ctx.has(item)); },
  },
  count: {
    min: 1, max: 1, params: ['string'],
    fn(env, item) { return env.ctx.count(item); },
  },
  inv: {
    min: 0, max: 0, params: [],
    fn(env) { return Array.from(env.ctx.inv()); },
  },
  turns: {
    min: 0, max: 0, params: [],
    fn(env) { return env.ctx.turns(); },
  },
  random: {
    min: 2, max: 2, params: ['number', 'number'],
    fn(env, a, b) {
      if (!(b >= a)) throw fault('runtime', `'random' requires a <= b (got ${a}, ${b})`);
      return env.rng.int(a, b);
    },
  },
  pick: {
    min: 1, max: 1, params: ['list'],
    fn(env, list) {
      if (list.length === 0) throw fault('runtime', 'cannot pick from an empty list');
      return env.rng.pick(list);
    },
  },
  range: {
    min: 2, max: 2, params: ['number', 'number'],
    fn(_env, a, b) {
      if (!Number.isInteger(a) || !Number.isInteger(b))
        throw fault('runtime', `'range' requires integer bounds (got ${a}, ${b})`);
      const out = [];
      for (let i = a; i < b; i++) out.push(i);
      return out;
    },
  },
  len: {
    min: 1, max: 1, params: [null],
    fn(_env, x) {
      if (typeof x === 'string') return x.length;
      if (Array.isArray(x)) return x.length;
      throw fault('runtime', "'len' expects a string or a list");
    },
  },
  upper: {
    min: 1, max: 1, params: ['string'],
    fn(_env, s) { return asciiUpper(s); },
  },
  lower: {
    min: 1, max: 1, params: ['string'],
    fn(_env, s) { return asciiLower(s); },
  },
  floor: {
    min: 1, max: 1, params: ['number'],
    fn(_env, n) { return Math.floor(n); },
  },
  ceil: {
    min: 1, max: 1, params: ['number'],
    fn(_env, n) { return Math.ceil(n); },
  },
  abs: {
    min: 1, max: 1, params: ['number'],
    fn(_env, n) { return Math.abs(n); },
  },
  min: {
    min: 1, max: null, params: ['number'],
    fn(_env, ...args) { return Math.min(...args); },
  },
  max: {
    min: 1, max: null, params: ['number'],
    fn(_env, ...args) { return Math.max(...args); },
  },
  str: {
    min: 1, max: 1, params: [null],
    fn(_env, x) { return renderValue(x); },
  },
  num: {
    min: 1, max: 1, params: ['string'],
    fn(_env, s) {
      if (!DECIMAL.test(s)) throw fault('runtime', `cannot parse '${s}' as a number`);
      return Number(s);
    },
  },
  bool: {
    min: 1, max: 1, params: [null],
    fn(_env, x) { return truthy(x); },
  },
};
