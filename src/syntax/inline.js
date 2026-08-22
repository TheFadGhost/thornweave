/**
 * @file Inline scanning for Thornmark prose (SPEC §2–§4): emphasis,
 * interpolations, links/bullets/statements and block markers.
 */
import { tokenizeExpr } from './lexer.js';
import { ExprParser } from './exprparser.js';

const ESCAPABLE = new Set(['{', '}', '[', ']', '|', '*', '\\']);

export function splitTop(s, seps) {
  const parts = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += s[i + 1] ?? ''; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (depth <= 0 && !'([{'.includes(c) && seps.includes(c)) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function scanBalancedParenFrom(s, start) {
  let depth = 0;
  let quote = null;
  for (let j = start; j < s.length; j++) {
    const c = s[j];
    if (quote) {
      if (c === '\\') { j++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"') { quote = c; continue; }
    if (c === '(') depth++;
    if (c === ')') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function findBalanced(text, from) {
  let depth = 1;
  for (let j = from; j < text.length; j++) {
    const c = text[j];
    if (c === '"') {
      let closed = false;
      j++;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '"') { closed = true; break; }
        j++;
      }
      if (!closed) return -2;
      continue;
    }
    if (c === '{' && text[j + 1] === '{') { depth += 1; j++; continue; }
    if (c === '}' && text[j + 1] === '}') {
      depth -= 1;
      if (depth === 0) return j;
      j++;
      continue;
    }
  }
  return -2;
}

function findCloser(text, from, marker) {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (text.startsWith(marker, j)) return j;
  }
  return -1;
}

function exprOf(src, basePos, collector) {
  try {
    const toks = tokenizeExpr(src, basePos, collector);
    const p = new ExprParser(toks);
    const expr = p.parse();
    const endTok = p.peek();
    if (endTok.k !== 'eof') throw err20(`unexpected '${endTok.v}' after expression`, endTok.pos);
    return expr;
  } catch (e) {
    if (e && e.code === 'TW020') {
      collector.add('error', 'TW020', e.message, e.pos ?? basePos, { help: e.help });
      return null;
    }
    throw e;
  }
}

function err20(message, pos, help) {
  const e = new Error(message);
  e.code = 'TW020';
  e.pos = pos;
  e.help = help;
  return e;
}

function construct(inner, openOff, text, posAt, collector) {
  const trimmed = inner.trim();
  const pos = posAt(openOff);
  let m;
  if ((m = /^if\s+([\s\S]+)$/.exec(trimmed))) {
    const cond = exprOf(m[1], pos, collector) ?? { t: 'bool', v: false };
    return { marker: 'if', cond, pos };
  }
  if ((m = /^elif\s+([\s\S]+)$/.exec(trimmed))) {
    const cond = exprOf(m[1], pos, collector) ?? { t: 'bool', v: false };
    return { marker: 'elif', cond, pos };
  }
  if (/^else$/.test(trimmed)) return { marker: 'else', pos };
  if (/^end$/.test(trimmed)) return { marker: 'end', pos };
  if ((m = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]+)$/.exec(trimmed))) {
    const iter = exprOf(m[2], pos, collector) ?? { t: 'list', items: [] };
    return { marker: 'for', varName: m[1], iter, pos };
  }
  if (/^for\b/.test(trimmed)) {
    collector.add('error', 'TW020', "'{{for' must read {{for name in expression}}", pos, { help: 'example: {{for item in inv()}} … {{end}}' });
    return { marker: 'end', pos };
  }
  if ((m = /^include\s+([\s\S]+)$/.exec(trimmed))) {
    let target = m[1].trim().replace(/^"(.*)"$/, '$1');
    if (!target) {
      collector.add('error', 'TW020', '{{include}} needs a passage name', pos, { help: 'write {{include PassageName}}' });
      target = '';
    }
    return { node: { k: 'include', target, args: null, pos } };
  }
  if ((m = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/.exec(trimmed))) {
    const argParts = splitTop(m[2], [',']);
    const args = [];
    if (!(argParts.length === 1 && argParts[0].trim() === '')) {
      for (const part of argParts) {
        const e = exprOf(part.trim(), pos, collector);
        if (!e) return { node: null };
        args.push(e);
      }
    }
    return { node: { k: 'include', target: m[1], args, pos } };
  }
  const e = exprOf(trimmed, pos, collector);
  if (!e) return { node: null };
  return { node: { k: 'interp', expr: e, pos } };
}

export function scanInline(text, posAt, collector) {
  const out = [];
  let buf = '';
  const flush = () => {
    if (buf !== '') {
      out.push({ node: { k: 'text', v: buf.replace(/\r/g, '') } });
      buf = '';
    }
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length && ESCAPABLE.has(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (c === '{' && text[i + 1] === '{') {
      const close = findBalanced(text, i + 2);
      if (close === -2) {
        flush();
        collector.add('error', 'TW020', "'{{' opens a construct that is never closed with '}}'", posAt(i), { help: 'close the construct, e.g. {{end}} — quote marks must balance inside it' });
        buf += text.slice(i);
        i = text.length;
        continue;
      }
      if (close === -1) { buf += '{{'; i += 2; continue; }
      flush();
      const item = construct(text.slice(i + 2, close), i, text, posAt, collector);
      out.push(item);
      i = close + 2;
      continue;
    }
    if (c === '[' && text[i + 1] === '[') {
      const close = text.indexOf(']]', i + 2);
      if (close === -1) { buf += '[['; i += 2; continue; }
      flush();
      const node = parseLinkContent(text.slice(i + 2, close), posAt(i), collector);
      out.push({ node });
      i = close + 2;
      continue;
    }
    if (c === '*' && text[i + 1] === '*') {
      const close = findCloser(text, i + 2, '**');
      if (close === -1) { buf += '**'; i += 2; continue; }
      flush();
      const kids = scanInline(text.slice(i + 2, close), (off) => posAt(off + i + 2), collector)
        .filter((x) => x.node).map((x) => x.node);
      out.push({ node: { k: 'strong', kids } });
      i = close + 2;
      continue;
    }
    if (c === '*') {
      const close = findCloser(text, i + 1, '*');
      if (close === -1) { buf += '*'; i++; continue; }
      flush();
      const kids = scanInline(text.slice(i + 1, close), (off) => posAt(off + i + 1), collector)
        .filter((x) => x.node).map((x) => x.node);
      out.push({ node: { k: 'em', kids } });
      i = close + 1;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

function parseAttrPiece(piece, pos, collector, isBullet) {
  const p = piece.trim();
  if (p === 'once') return { once: true };
  let m;
  if ((m = /^time\s*=\s*(\d+)$/.exec(p))) {
    const n = Number(m[1]);
    if (n < 1 || n > 120) {
      collector.add('error', 'TW015', `time must be an integer between 1 and 120 seconds (got ${m[1]})`, pos, { help: 'example: time=8' });
      return { time: 0 };
    }
    return { time: n };
  }
  if ((m = /^timeout\s*->\s*([\s\S]+)$/.exec(p))) return { timeout: m[1].trim() };
  if ((m = /^if\s+([\s\S]+)$/.exec(p)) && isBullet) {
    return { ifExpr: exprOf(m[1], pos, collector) };
  }
  collector.add('error', 'TW015', `unknown attribute '${p}'`, pos, {
    help: isBullet
      ? 'valid attributes: once | if expression | time=N | timeout -> Passage'
      : "valid attributes: once | time=N | timeout -> Passage ('if' belongs on bullet choices)",
  });
  return {};
}

export function applyAttrs(node, pieces, pos, collector, isBullet) {
  for (const piece of pieces) {
    const got = parseAttrPiece(piece, pos, collector, isBullet);
    if (got.once) node.attrs.once = true;
    if (got.time) node.attrs.time = got.time;
    if (got.timeout) node.attrs.timeout = got.timeout;
    if (got.ifExpr) node.attrs.ifExpr = got.ifExpr;
  }
  if (node.attrs.timeout && !node.attrs.time) {
    collector.add('error', 'TW015', "'timeout' requires a timed choice: add time=N", pos, { help: "example: [[Wait -> Hold | time=8, timeout -> Dusk]]" });
  }
}

function displayNodes(src, posAt, collector, baseOff) {
  return scanInline(src, (off) => posAt(off + baseOff), collector)
    .filter((x) => x.node && x.node.k !== 'link' && x.node.k !== 'choice')
    .map((x) => x.node);
}

export function parseLinkContent(content, pos, collector) {
  const parts = splitTop(content, ['|']);
  const main = parts[0];
  const fwdIdx = main.indexOf(' -> ');
  const revIdx = main.indexOf(' <- ');
  let displaySrc;
  let target;
  let arrowCol = pos.col + 2;
  if (fwdIdx >= 0 && (revIdx === -1 || fwdIdx <= revIdx)) {
    displaySrc = main.slice(0, fwdIdx);
    target = main.slice(fwdIdx + 4).trim();
    arrowCol += fwdIdx + 1;
  } else if (revIdx >= 0) {
    target = main.slice(0, revIdx).trim();
    displaySrc = main.slice(revIdx + 4);
    arrowCol += revIdx + 1;
  } else {
    displaySrc = main;
    target = main.trim();
  }
  if (target === '' && (fwdIdx >= 0 || revIdx >= 0)) {
    collector.add('error', 'TW020', 'link has no destination after the arrow', { line: pos.line, col: arrowCol }, { help: 'write [[display -> Target]]' });
  }
  const node = {
    k: 'link',
    id: '',
    display: displaySrc.trim() === '' ? [{ k: 'text', v: target }] : displayNodes(displaySrc, () => pos, collector, 0),
    target,
    attrs: { once: false, time: 0, timeout: null },
    pos,
  };
  node.pos = pos;
  if (parts.length > 1) applyAttrs(node, splitTop(parts.slice(1).join('|'), [',', ';']), pos, collector, false);
  return node;
}

export function parseBulletLine(rawLine, linePos, posAt, collector) {
  let s = rawLine.replace(/^(\s*)\*\s+/, '$1');
  void linePos;
  const baseOff = rawLine.length - s.length;
  const posShift = (fn) => (off) => fn(off + baseOff);
  const attrs = { once: false, time: 0, timeout: null, ifExpr: null };
  let attrConsumed = 0;
  const lead = /^\s*/.exec(s)[0].length;
  if (s[lead] === '(') {
    const close = scanBalancedParenFrom(s, lead);
    if (close !== -1) {
      const inner = s.slice(lead + 1, close);
      if (inner.trim() !== '') {
        const pieces = splitTop(inner, [',', ';']);
        const knownAll = pieces.every((p) => /^(once|time\s*=|timeout\s*->|if\s)/.test(p.trim()));
        if (knownAll) {
          const probe = { k: 'choice', attrs };
          applyAttrs(probe, pieces, linePos, collector, true);
          attrConsumed = close + 1;
          while (s[attrConsumed] === ' ') attrConsumed++;
        }
      }
    }
  }
  s = s.slice(attrConsumed);
  const arrowIdx = s.indexOf(' -> ');
  if (arrowIdx === -1) {
    collector.add('error', 'TW020', "bulleted choice needs an arrow to a destination", linePos, {
      help: 'write * Display text -> Target',
    });
    return null;
  }
  const displaySrc = s.slice(0, arrowIdx).trim();
  const target = s.slice(arrowIdx + 4).trim();
  const node = {
    k: 'choice',
    id: '',
    display: displaySrc === '' ? [{ k: 'text', v: target }] : displayNodes(displaySrc, posShift(posAt), collector, baseOff + arrowIdx),
    target,
    attrs,
    pos: linePos,
  };
  return node;
}

export function parseStatement(restSrc, restOffset, posAt, collector, lineStartPos) {
  const src = restSrc;
  const kwMatch = /^\s*(set|unset|take|drop|push)\b/.exec(src);
  if (!kwMatch) {
    collector.add('error', 'TW020', `statements begin with set, unset, take, drop or push (found '${src.trim().split(/\s/)[0] ?? ''}')`, lineStartPos, {
      help: 'example: ~ set gold = gold + 1',
    });
    return null;
  }
  const kind = kwMatch[1];
  const after = src.slice(kwMatch[0].length);
  const relBase = (offInAfter) => posAt(kwMatch[0].length + offInAfter);
  try {
    const toks = tokenizeExpr(after.trim(), posAt(restOffset + kwMatch[0].length), collector);
    const p = new ExprParser(toks);
    if (kind === 'set') {
      const nameTok = p.peek();
      if (nameTok.k !== 'ident') throw err20('set needs a variable name', nameTok.pos);
      p.next();
      if (!p.eat('op', '=')) throw err20("expected '=' after variable name in set", p.peek().pos, { help: '~ set name = expression' });
      const expr = p.parse();
      expectEnd(p);
      return { k: 'set', name: nameTok.v, expr, pos: lineStartPos };
    }
    if (kind === 'unset') {
      const nameTok = p.peek();
      if (nameTok.k !== 'ident') throw err20('unset needs a variable name', nameTok.pos);
      p.next();
      expectEnd(p);
      return { k: 'unset', name: nameTok.v, pos: lineStartPos };
    }
    if (kind === 'take' || kind === 'drop') {
      const item = p.parse();
      let count = null;
      if (p.eat(',')) count = p.parse();
      expectEnd(p);
      return { k: kind, item, count, pos: lineStartPos };
    }
    const nameTok = p.peek();
    if (nameTok.k !== 'ident') throw err20('push needs a list variable name', nameTok.pos);
    p.next();
    p.eat(',');
    const expr = p.parse();
    expectEnd(p);
    return { k: 'push', name: nameTok.v, expr, pos: lineStartPos };
  } catch (e) {
    if (e && e.code === 'TW020') {
      collector.add('error', 'TW020', e.message, e.pos ?? lineStartPos, { help: e.help });
      return null;
    }
    throw e;
  }
}

function expectEnd(p) {
  const t = p.peek();
  if (t.k !== 'eof') throw err20(`unexpected '${t.v}' after statement`, t.pos, { help: 'one statement per ~ line' });
}
