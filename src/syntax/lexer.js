/**
 * @file Expression tokenizer + position helpers for Thornmark (SPEC §5, §12).
 */
import { fault } from '../state/model.js';

export const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '(', ')', '[', ']', ',', '?', ':', '!', '='];

/**
 * @typedef {object} Tok
 * @property {string} k   'num'|'str'|'ident'|'kw'|'op'|'eof'
 * @property {*} v
 * @property {number} pos offset within source
 * @property {number} end exclusive end offset
 */

/** Tokenize an expression source fragment. Throws TW020-style ParseError.
 *  `collector` (optional) receives TW012 warnings for suspicious escapes. */
export function tokenizeExpr(src, basePos = { line: 1, col: 1 }, collector = null) {
  const toks = [];
  let i = 0;
  const colOf = (off) => basePos.col + off;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    const pos = { line: basePos.line, col: colOf(i) };
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j++;
      if (src[j] === '.' ) { j++; while (j < src.length && /[0-9]/.test(src[j])) j++; }
      const raw = src.slice(i, j).replace(/_/g, '');
      const v = Number(raw);
      if (!Number.isFinite(v)) throw parseErr(`'${raw}' is not a valid number`, pos);
      toks.push({ k: 'num', v, pos, end: colOf(j) }); i = j; continue;
    }
    if (c === '"') {
      let j = i + 1; let out = '';
      let closed = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') {
          const e = src[j + 1];
          if (e === 'n') out += '\n';
          else if (e === 't') out += '\t';
          else if (e === '"') out += '"';
          else if (e === '\\') out += '\\';
          else {
            out += '\\' + e;
            if (collector) collector.add('warning', 'TW012', `suspicious escape '\\${e}' in string`, pos, { help: "valid escapes are \\n \\t \\\" \\\\" });
          }
          j += 2; continue;
        }
        if (d === '"') { closed = true; j++; break; }
        out += d; j++;
      }
      if (!closed) throw parseErr('unterminated string (missing closing ")', pos, { help: 'add the closing quote' });
      toks.push({ k: 'str', v: out, pos, end: colOf(j) }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j);
      toks.push({ k: KEYWORDS.has(w) ? 'kw' : 'ident', v: w, pos, end: colOf(j) });
      i = j; continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) { toks.push({ k: 'op', v: op, pos, end: colOf(i + op.length) }); i += op.length; continue; }
    if (c === '{' || c === '}') throw parseErr(`unexpected '${c}' inside expression`, pos, { help: 'check braces — expressions live between {{ }}' });
    throw parseErr(`unexpected character '${c}'`, pos, { help: 'remove or escape this character' });
  }
  toks.push({ k: 'eof', v: null, pos: { line: basePos.line, col: colOf(src.length) }, end: colOf(src.length) });
  return toks;
}

export function parseErr(message, pos, extra = {}) {
  const e = fault('parse', message, pos);
  e.code = 'TW020';
  Object.assign(e, extra);
  return e;
}
