/**
 * @file Thornmark story parser (SPEC §1–§6, §12) -> StoryIR contracts in ./ast.js.
 */
import { tokenizeExpr } from './lexer.js';
import { ExprParser } from './exprparser.js';
import { scanInline, parseBulletLine, parseStatement } from './inline.js';
import { linkId, FORMAT_VERSION, resolveStart } from './ast.js';

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseStory(sourceText, fileName = 'story.thorn') {
  const diags = [];
  const collector = {
    add(severity, code, message, pos, extra = {}) {
      diags.push({
        severity,
        code,
        message,
        file: fileName,
        line: pos?.line ?? 1,
        col: pos?.col ?? 1,
        ...(extra.endCol ? { endCol: extra.endCol } : {}),
        ...(extra.help ? { help: extra.help } : {}),
      });
    },
    has: (code) => diags.some((d) => d.code === code),
  };
  const lines = sourceText.split(/\r?\n/);
  const meta = { title: stem(fileName), author: '', description: '', start: '', show: [], seed: null };
  const varsInit = {};
  const metaUnknown = [];
  let idx = 0;

  if ((lines[0] ?? '').trim() === '---') {
    idx = parseFrontmatter(lines, meta, varsInit, metaUnknown, collector);
  }

  const passages = {};
  const order = [];
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.trim() === '') { idx++; continue; }
    const hm = /^==+(.*)$/.exec(line);
    if (!hm) {
      collector.add('error', 'TW020', 'prose appears before any passage header', { line: idx + 1, col: 1 }, { help: 'start the file with == Passage Name == or frontmatter' });
      while (idx < lines.length && !/^==+/.test(lines[idx])) idx++;
      continue;
    }
    idx = parsePassage(lines, idx, passages, order, collector);
  }

  meta.start = meta.start || resolveStart({ meta, passages, order });
  sortDiags(diags);
  const story = {
    formatVersion: FORMAT_VERSION,
    meta: { ...meta, metaUnknown },
    varsInit,
    passages,
    order,
  };
  return { story, diagnostics: diags };
}

function stem(f) {
  const base = f.split(/[\\/]/).pop() ?? f;
  return base.replace(/\.[^.]+$/, '');
}

function sortDiags(ds) {
  ds.sort((a, b) => a.line - b.line || a.col - b.col || a.code.localeCompare(b.code));
}

/* ------------------------- frontmatter ------------------------- */

function parseFrontmatter(lines, meta, varsInit, metaUnknown, collector) {
  const seen = new Set();
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') { i++; break; }
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) {
      collector.add('warning', 'TW016', `cannot read frontmatter line '${line.trim()}'`, { line: i + 1, col: 1 });
      continue;
    }
    const key = m[1];
    let value = m[2].trim();
    if (seen.has(key)) collector.add('warning', 'TW016', `frontmatter key '${key}' is set twice; keeping the last value`, { line: i + 1, col: 1 });
    seen.add(key);
    if (key === 'vars') {
      i = readBlockEntries(lines, i, (name, litSrc, ln) => {
        const tv = literalValue(litSrc, { line: ln, col: name.length + 4 }, collector);
        if (tv) varsInit[name] = tv;
      }, (badLine, ln) => collector.add('error', 'TW016', `variable entries must read 'name = value'`, { line: ln, col: 1 }));
      continue;
    }
    if (key === 'show') {
      if (value === '') {
        const items = [];
        i = readBlockEntries(lines, i, (name, _v, _ln) => items.push(name));
        meta.show = items;
      } else {
        meta.show = value.split(',').map((x) => x.trim()).filter(Boolean);
      }
      continue;
    }
    switch (key) {
      case 'title': case 'author': case 'description': case 'start':
        meta[key] = unquote(value); break;
      case 'format':
        if (value !== '1') collector.add('error', 'TW016', `this story claims Thornmark format ${value}; this compiler implements format 1`, { line: i + 1, col: 1 });
        break;
      case 'seed': {
        const n = Number(value);
        if (/^\d+$/.test(value)) meta.seed = n >>> 0;
        else collector.add('warning', 'TW016', 'seed should be a whole number', { line: i + 1, col: 1 });
        break;
      }
      default:
        metaUnknown.push(key);
        collector.add('warning', 'TW016', `unknown frontmatter key '${key}'`, { line: i + 1, col: 1 }, { help: 'known keys: title, author, description, start, format, show, seed, vars' });
    }
  }
  return i;
}

function readBlockEntries(lines, i, onEntry, onBad) {
  let j = i + 1;
  for (; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() === '' ) continue;
    if (!/^\s/.test(l)) break;
    const em = /^\s+([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.+)$/.exec(l);
    if (em) onEntry(em[1], em[2].trim(), j + 1);
    else if (onBad) onBad(l, j + 1);
  }
  return j - 1 < lines.length ? j - 1 : j;
}

function unquote(v) {
  const m = /^"(.*)"$/.exec(v);
  return m ? m[1] : v;
}

function literalValue(src, pos, collector) {
  try {
    const toks = tokenizeExpr(src, pos, collector);
    const expr = new ExprParser(toks).parse();
    if (isLiteral(expr)) return { t: typeOfLiteral(expr), v: literalOf(expr) };
    collector.add('error', 'TW016', 'starting variables must be plain values (number, "string", true/false, [list])', pos);
    return null;
  } catch (e) {
    if (e && e.code === 'TW020') {
      collector.add('error', 'TW016', `'${src}' is not a valid starting value: ${e.message}`, pos);
      return null;
    }
    throw e;
  }
}

function isLiteral(e) {
  if (!e || typeof e !== 'object') return false;
  if (['num', 'str', 'bool'].includes(e.t)) return true;
  if (e.t === 'list') return e.items.every(isLiteral);
  return false;
}
function typeOfLiteral(e) {
  if (e.t === 'num') return 'number';
  if (e.t === 'str') return 'string';
  if (e.t === 'bool') return 'boolean';
  return 'list';
}
function literalOf(e) {
  if (e.t === 'list') return e.items.map(literalOf);
  return e.v;
}

/* ------------------------- passages ------------------------- */

function parsePassage(lines, idx, passages, order, collector) {
  const headerLineNo = idx + 1;
  let rest = /^==+(.*)$/.exec(lines[idx])[1];
  let params = [];
  let tags = [];
  for (let guard = 0; guard < 6; guard++) {
    let peeled = false;
    let m;
    if ((m = /\(([^()]*)\)\s*$/.exec(rest))) {
      params = m[1].split(',').map((p) => p.trim()).filter(Boolean);
      rest = rest.slice(0, m.index);
      peeled = true;
    } else if ((m = /\[([^\[\]]*)\]\s*$/.exec(rest))) {
      tags = m[1].split(/\s+/).filter(Boolean);
      rest = rest.slice(0, m.index);
      peeled = true;
    } else if ((m = /\s*=+\s*$/.exec(rest))) {
      rest = rest.slice(0, m.index);
      peeled = true;
    }
    if (!peeled) break;
  }
  for (const p of params) {
    if (!IDENT_RE.test(p)) {
      collector.add('error', 'TW020', `macro parameter '${p}' must be a name`, { line: headerLineNo, col: 4 }, { help: 'example: == Wound(level) ==' });
    }
  }
  if (new Set(params).size !== params.length) {
    collector.add('error', 'TW020', 'duplicate macro parameter in passage header', { line: headerLineNo, col: 4 });
  }
  const name = rest.trim();
  if (name === '') {
    collector.add('error', 'TW013', 'passage header has no name', { line: headerLineNo, col: 4 }, { help: 'write == Passage Name ==' });
  }
  if (Object.prototype.hasOwnProperty.call(passages, name)) {
    collector.add('error', 'TW009', `two passages are named '${name}'`, { line: headerLineNo, col: 4 }, { help: 'passage names must be unique' });
  }
  idx++;
  const body = collectBody(lines, idx, headerLineNo, name, collector, params);
  idx = body.nextIdx;
  const passage = {
    name,
    tags,
    params,
    nodes: body.nodes,
    line: headerLineNo,
    links: [],
    words: 0,
  };
  assignOrdinals(passage);
  passage.words = countWords(passage.nodes);
  if (!Object.prototype.hasOwnProperty.call(passages, name)) {
    passages[name] = passage;
    order.push(name);
  }
  return idx;
}

function collectBody(lines, startIdx, headerLineNo, passageName, collector, params) {
  void headerLineNo;
  void passageName;
  void params;
  const root = { type: 'root', curBucket: { kids: [], para: [] } };
  const frames = [root];
  const curB = () => frames[frames.length - 1].curBucket;
  const LOGIC = new Set(['set', 'unset', 'take', 'drop', 'push']);
  const buf = [];
  let idx = startIdx;

  const flushBuf = () => {
    if (buf.length === 0) return;
    const entries = buf.splice(0, buf.length);
    for (const entry of entries) {
      if (entry.stmt) { processNode(entry.stmt); continue; }
      if (entry.raw === undefined) continue;
      const lineNo = entry.line;
      const posAt = () => ({ line: lineNo, col: 1 });
      for (const item of scanInline(entry.raw, posAt, collector)) processItem(item);
    }
  };

  function finishBucket(b) {
    if (b.para.length === 0) return;
    const kids = b.para;
    const first = kids[0];
    const last = kids[kids.length - 1];
    if (first.k === 'text') first.v = first.v.replace(/^\s+/, '');
    if (last.k === 'text') last.v = last.v.replace(/\s+$/, '');
    const alive = kids.filter((n) => !(n.k === 'text' && n.v === ''));
    b.para = [];
    if (alive.length === 0) return;
    const visible = alive.filter((n) => !LOGIC.has(n.k));
    if (visible.length === 0) {
      b.kids.push(...alive);
      return;
    }
    b.kids.push({ k: 'p', kids: alive });
  }

  function pushProse(node) {
    const b = curB();
    const L = b.para[b.para.length - 1];
    if (L && L.k === 'text' && node.k === 'text') {
      L.v = L.v.replace(/\s+$/, '') + ' ' + node.v.replace(/^\s+/, '');
    } else {
      b.para.push(node);
    }
  }

  function processItem(item) {
    if (item.node) return processNode(item.node);
    handleMarker(item);
  }

  function processNode(node) {
    if (node.k === 'choice' || node.k === 'break') {
      finishBucket(curB());
      curB().kids.push(node);
      return;
    }
    pushProse(node);
  }

  function buildFrame(f) {
    return f.type === 'if'
      ? { k: 'if', branches: f.branches.map((b) => ({ cond: b.cond, nodes: b.kids })), elseNodes: f.elseKids ?? [] }
      : { k: 'for', varName: f.varName, iter: f.iter, nodes: f.bucket.kids };
  }

  function attachBuilt(f) {
    const pb = curB();
    if (f.inline) pb.para.push(buildFrame(f));
    else { finishBucket(pb); pb.kids.push(buildFrame(f)); }
  }

  function stray(mk) {
    collector.add('error', 'TW020', `'{{${mk.marker}}}' without a matching '{{if}}' or '{{for}}'`, mk.pos, { help: 'every {{if}}/{{for}} needs its own {{end}}' });
  }

  function handleMarker(mk) {
    const f = frames[frames.length - 1];
    if (mk.marker === 'if' || mk.marker === 'for') {
      const inline = f.curBucket.para.length > 0;
      if (!inline) finishBucket(f.curBucket);
      const nf = { type: mk.marker, inline, openerPos: mk.pos };
      if (mk.marker === 'if') {
        nf.branches = [{ cond: mk.cond, kids: [], para: [] }];
        nf.elseKids = null;
        nf.curBucket = nf.branches[0];
      } else {
        nf.varName = mk.varName;
        nf.iter = mk.iter;
        nf.bucket = { kids: [], para: [] };
        nf.curBucket = nf.bucket;
      }
      frames.push(nf);
      return;
    }
    if (mk.marker === 'elif') {
      if (f.type !== 'if' || f.elseKids) return stray(mk);
      finishBucket(f.curBucket);
      f.branches.push({ cond: mk.cond, kids: [], para: [] });
      f.curBucket = f.branches[f.branches.length - 1];
      return;
    }
    if (mk.marker === 'else') {
      if (f.type !== 'if' || f.elseKids) return stray(mk);
      finishBucket(f.curBucket);
      f.elseKids = [];
      f.curBucket = { kids: f.elseKids, para: [] };
      return;
    }
    if (mk.marker === 'end') {
      if (f.type === 'root') return stray(mk);
      finishBucket(f.curBucket);
      frames.pop();
      attachBuilt(f);
    }
  }

  while (idx < lines.length) {
    const line = lines[idx];
    const lineNo = idx + 1;
    if (/^==+/.test(line)) break;
    if (line.trim() === '') { flushBuf(); finishBucket(curB()); idx++; continue; }
    const trimmed = line.trim();
    if (trimmed.startsWith('%%')) { idx++; continue; }
    if (trimmed.startsWith('~')) {
      flushBuf();
      const indent = line.length - line.trimStart().length;
      const stmt = parseStatement(trimmed.slice(1), 0, () => ({ line: lineNo, col: indent + 2 }), collector, { line: lineNo, col: indent + 1 });
      if (stmt) processNode(stmt);
      idx++;
      continue;
    }
    if (/^\*\s/.test(trimmed)) {
      flushBuf();
      finishBucket(curB());
      const baseCol = line.length - line.trimStart().length + 1;
      const node = parseBulletLine(trimmed, { line: lineNo, col: baseCol }, () => ({ line: lineNo, col: baseCol }), collector);
      if (node) processNode(node);
      idx++;
      continue;
    }
    if (/^(?:·\s·\s·|\*\*\*)$/.test(trimmed)) {
      flushBuf();
      finishBucket(curB());
      curB().kids.push({ k: 'break' });
      idx++;
      continue;
    }
    buf.push({ raw: line, line: lineNo });
    idx++;
  }
  flushBuf();
  while (frames.length > 1) {
    const f = frames.pop();
    collector.add('error', 'TW020', `{{${f.type}}} opened here is never closed`, f.openerPos, { help: `add {{end}} to close the ${f.type === 'if' ? 'conditional' : 'loop'}` });
    finishBucket(f.curBucket);
    curB().kids.push(buildFrame(f));
  }
  finishBucket(root.curBucket);
  return { nodes: root.curBucket.kids, nextIdx: idx };
}

function assignOrdinals(passage) {
  let ord = 0;
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.k === 'link' || n.k === 'choice') {
        n.id = linkId(passage.name, ord++);
        passage.links.push({ target: n.target, attrs: { ...n.attrs }, line: n.pos.line, col: n.pos.col, id: n.id });
        continue;
      }
      if (n.k === 'p' || n.k === 'em' || n.k === 'strong') walk(n.kids);
      else if (n.k === 'if') {
        for (const b of n.branches) walk(b.nodes);
        walk(n.elseNodes);
      } else if (n.k === 'for') walk(n.nodes);
    }
  };
  walk(passage.nodes);
}

function countWords(nodes) {
  let total = 0;
  const walk = (ns) => {
    for (const n of ns) {
      if (n.k === 'text') total += (n.v.match(/\S+/g) ?? []).length;
      else if (n.k === 'p' || n.k === 'em' || n.k === 'strong') walk(n.kids);
      else if (n.k === 'if') {
        for (const b of n.branches) walk(b.nodes);
        walk(n.elseNodes);
      } else if (n.k === 'for') walk(n.nodes);
    }
  };
  walk(nodes);
  return total;
}
