/**
 * @file Semantic analysis over the StoryIR (SPEC §10 catalog). Zero
 * dependencies beyond the shared builtin table and the diagnostic sorter.
 *
 * Stated approximations (SPEC §10):
 * - Reachability uses the structural graph only: every link is an edge,
 *   conditionals and `if` expressions are ignored; include/macro-call edges
 *   are followed because spliced passages do render. Parameterised passages
 *   (macros) are invoked, not navigated, so they are exempt from
 *   unreachability/dead-end reporting entirely.
 * - Read-before-set is a conservative may-be-unset dataflow per passage:
 *   frontmatter vars and macro parameters start set; `~set` marks definitely
 *   set afterwards; branch merge = intersection of definite sets.
 * - Type checking is straight-line only: literal assignments propagate
 *   constant types through sequential statements, with no path sensitivity
 *   (branch merges keep the pre-branch binding unless every branch agrees).
 */

import { BUILTINS } from '../runtime/builtins.js';
import { LOOP_CAP } from '../syntax/ast.js';
import { sortDiagnostics } from './diagnostics.js';

const LITERAL_TYPE = { num: 'number', str: 'string', bool: 'boolean', list: 'list' };
const NAME_CONVENTION = /^[A-Za-z0-9 _-]+$/;

/**
 * Pre-order walk over an expression AST (src/syntax/ast.js shapes). Visits
 * every node including the root, then descends into children.
 * @param {import('../syntax/ast.js').ASTExpr} expr
 * @param {(node: import('../syntax/ast.js').ASTExpr) => void} visit
 */
export function walkExpr(expr, visit) {
  if (!expr || typeof expr.t !== 'string') return;
  visit(expr);
  switch (expr.t) {
    case 'bin':
      walkExpr(expr.l, visit);
      walkExpr(expr.r, visit);
      break;
    case 'un':
      walkExpr(expr.e, visit);
      break;
    case 'ternary':
      walkExpr(expr.c, visit);
      walkExpr(expr.a, visit);
      walkExpr(expr.b, visit);
      break;
    case 'call':
      for (const a of expr.args) walkExpr(a, visit);
      break;
    case 'list':
      for (const item of expr.items) walkExpr(item, visit);
      break;
    default:
      break;
  }
}

/** @returns {import('../syntax/ast.js').Diagnostic[]} sorted */
export function checkStory(story, _sourceText, fileName = 'story.thorn') {
  const ds = [];
  const push = (severity, code, message, line, col, endCol, help) => {
    const d = { severity, code, message, file: fileName, line, col };
    if (endCol != null) d.endCol = endCol;
    if (help != null) d.help = help;
    ds.push(d);
  };

  const order = story.order ?? [];
  const passages = story.passages ?? {};
  const names = order.filter((n) => Object.prototype.hasOwnProperty.call(passages, n));
  const nameSet = new Set(names);

  // ---- TW013 / TW009: empty and duplicate passage names ------------------
  const seen = new Set();
  for (const name of order) {
    const p = passages[name];
    if (!p) continue;
    if (name === '') {
      push('error', 'TW013', "passage has an empty name", p.line, 4, 4,
        "name the passage, e.g. '== Crossroads =='");
      continue;
    }
    if (seen.has(name)) {
      push('error', 'TW009', `duplicate passage name '${name}'`, p.line, 1,
        undefined, 'each passage needs a unique name');
    }
    seen.add(name);
  }

  // ---- TW016: unknown frontmatter keys -----------------------------------
  for (const entry of story.metaUnknown ?? []) {
    const key = typeof entry === 'string' ? entry : entry.key;
    if (!key) continue;
    const line = typeof entry === 'object' && entry.line ? entry.line : 1;
    const col = typeof entry === 'object' && entry.col ? entry.col : 1;
    push('warning', 'TW016', `unknown frontmatter key '${key}'`, line, col,
      col + key.length,
      "known keys: title, author, description, start, format, show, vars, seed");
  }

  // ---- TW010: start passage ----------------------------------------------
  const startName = story.meta?.start ?? '';
  let startOk = false;
  if (!startName || !nameSet.has(startName)) {
    const msg = !startName
      ? "no start passage: frontmatter 'start' is missing or empty"
      : `start passage '${startName}' does not exist`;
    push('error', 'TW010', msg, 1, 1, undefined,
      "set 'start: Name' in the frontmatter or tag a passage with '[start]'");
  } else {
    startOk = true;
  }

  // ---- TW001 / TW002: link targets ----------------------------------------
  const nearestName = (target, lineOf) => {
    let best = null;
    let bestDist = 4;
    for (const n of names) {
      if (n === '' || n.toLowerCase() === target.toLowerCase()) continue;
      const dist = levenshtein(target, n, bestDist);
      if (dist < bestDist) { bestDist = dist; best = n; }
    }
    return bestDist <= 3 && best ? { name: best, line: lineOf(best) } : null;
  };

  const lineOfName = new Map(names.map((n) => [n, passages[n].line]));
  const checkTarget = (target, attrs, line, col) => {
    if (!target) return;
    if (nameSet.has(target)) return;
    const where = attrs === 'timeout' ? ' (timeout target)' : '';
    const caseMatch = names.find(
      (n) => n !== '' && n.toLowerCase() === target.toLowerCase() && n !== target,
    );
    if (caseMatch) {
      push('error', 'TW002',
        `link target '${target}' differs only by case from passage '${caseMatch}'${where}`,
        line, col, col + target.length,
        `passage names are case-sensitive; use '${caseMatch}'`);
      return;
    }
    const near = nearestName(target, (n) => lineOfName.get(n));
    const help = near
      ? `'${target}' is not defined. Did you mean '${near.name}' (line ${near.line})?`
      : `'${target}' is not defined. Check the passage names in this story.`;
    push('error', 'TW001', `link points to passage '${target}', which does not exist${where}`,
      line, col, col + target.length, help);
  };

  for (const name of names) {
    for (const l of passages[name].links ?? []) {
      checkTarget(l.target, 'link', l.line, l.col);
      if (l.attrs?.timeout) {
        checkTarget(l.attrs.timeout, 'timeout', l.line, l.col);
      }
    }
  }

  // ---- Include graph (edges for reachability + TW011 cycle detection) -----
  const includeEdges = new Map(); // name -> [{to, pos}]
  const collectIncludeEdges = () => {
    const scanExpr = (expr, onCall) => walkExpr(expr, onCall);
    for (const name of names) {
      const p = passages[name];
      const edges = includeEdges.get(name) ?? [];
      const addEdge = (to, pos) => {
        if (to && nameSet.has(to)) edges.push({ to, pos });
      };
      const onCall = (expr) => {
        if (expr.t === 'call' && nameSet.has(expr.name) &&
            (passages[expr.name].params?.length ?? 0) > 0) {
          addEdge(expr.name, expr.pos);
        }
      };
      const scanNodes = (nodes) => {
        for (const nd of nodes) {
          switch (nd.k) {
            case 'em': case 'strong': scanNodes(nd.kids); break;
            case 'interp': scanExpr(nd.expr, onCall); break;
            case 'if':
              for (const b of nd.branches) { scanExpr(b.cond, onCall); scanNodes(b.nodes); }
              if (nd.elseNodes) scanNodes(nd.elseNodes);
              break;
            case 'for': scanExpr(nd.iter, onCall); scanNodes(nd.nodes); break;
            case 'set': scanExpr(nd.expr, onCall); break;
            case 'take': case 'drop':
              scanExpr(nd.item, onCall);
              if (nd.count) scanExpr(nd.count, onCall);
              break;
            case 'push': scanExpr(nd.expr, onCall); break;
            case 'include': addEdge(nd.target, nd.pos); break;
            case 'link': scanNodes(nd.display); break;
            case 'choice':
              scanNodes(nd.display);
              if (nd.attrs?.ifExpr) scanExpr(nd.attrs.ifExpr, onCall);
              break;
            default: break;
          }
        }
      };
      scanNodes(p.nodes ?? []);
      includeEdges.set(name, edges);
    }
  };

  // ---- TW003 / TW004 / TW014: reachability + dead ends --------------------
  collectIncludeEdges();
  const reachable = new Set();
  if (startOk) {
    const queue = [startName];
    reachable.add(startName);
    while (queue.length > 0) {
      const cur = queue.shift();
      const p = passages[cur];
      for (const l of p.links ?? []) {
        if (nameSet.has(l.target) && !reachable.has(l.target)) {
          reachable.add(l.target);
          queue.push(l.target);
        }
      }
      for (const e of includeEdges.get(cur) ?? []) {
        if (!reachable.has(e.to)) { reachable.add(e.to); queue.push(e.to); }
      }
    }
  }

  for (const name of names) {
    const p = passages[name];
    if ((p.params?.length ?? 0) > 0) continue; // macros are invoked, not navigated
    if (!startOk || reachable.has(name) || name === startName) continue;
    if ((p.tags ?? []).includes('ending')) {
      push('note', 'TW004', `ending passage '${name}' is not structurally reachable`,
        p.line, 1, undefined,
        `an '[ending]' tag does not link to '${name}'; link it from a reachable passage or drop the tag`);
    } else {
      push('warning', 'TW003', `passage '${name}' is unreachable from the start passage`,
        p.line, 1, undefined,
        'reachability ignores conditional choices (stated approximation); link it from a reachable passage or remove it');
    }
  }

  for (const name of names) {
    const p = passages[name];
    if ((p.params?.length ?? 0) > 0) continue;
    if ((p.tags ?? []).includes('ending')) continue;
    if ((p.links ?? []).length === 0) {
      push('warning', 'TW014', `passage '${name}' is a dead end (no outgoing choices)`,
        p.line, 1, undefined,
        `add a choice or link, or tag the passage '[ending]' if it ends the story`);
    }
  }

  // ---- TW011: unbreakable include/macro recursion --------------------------
  {
    const color = new Map(); // 1 grey, 2 black
    const path = [];
    const dfs = (u) => {
      color.set(u, 1);
      path.push(u);
      for (const e of includeEdges.get(u) ?? []) {
        const state = color.get(e.to);
        if (state === 1) {
          const at = path.indexOf(e.to);
          const cyc = [...path.slice(at), e.to];
          push('error', 'TW011',
            `unbreakable include recursion: ${cyc.join(' -> ')}`,
            e.pos?.line ?? passages[u].line, e.pos?.col ?? 1, undefined,
            `guard the include with '{{if}}' or restructure it; runtime include depth is capped at 32`);
        } else if (!state) {
          dfs(e.to);
        }
      }
      path.pop();
      color.set(u, 2);
    };
    for (const name of names) if (!color.get(name)) dfs(name);
  }

  // ---- TW015: timed-choice attributes --------------------------------------
  for (const name of names) {
    const links = passages[name].links ?? [];
    const hasUntimedSibling = links.some((l) => !l.attrs?.time);
    for (const l of links) {
      const a = l.attrs ?? {};
      if (a.time && (a.time < 1 || a.time > 120)) {
        push('error', 'TW015', `'time=${a.time}' must be between 1 and 120 seconds`,
          l.line, l.col, l.col + String(a.time).length + 5,
          'timers longer than two minutes are almost always mistakes');
      }
      if (a.timeout && !a.time) {
        push('error', 'TW015', "'timeout' requires 'time=N' on the same choice",
          l.line, l.col, l.col + l.target.length,
          "add 'time=N' before 'timeout -> Passage'");
      }
      if (a.time >= 1 && a.time <= 120 && !a.timeout && !hasUntimedSibling) {
        push('warning', 'TW015',
          `timed choice '${l.target}' has no timeout target and no untimed sibling to fall back to`,
          l.line, l.col, l.col + l.target.length,
          `add 'timeout -> Passage' to this choice, or provide an untimed choice in '${name}'`);
      }
    }
  }

  // ---- TW017: naming-convention lint ---------------------------------------
  {
    const judged = names.filter((n) => n !== '');
    const violators = judged.filter((n) => !NAME_CONVENTION.test(n));
    if (violators.length > 0 && violators.length <= judged.length * 0.4) {
      const pct = Math.round(((judged.length - violators.length) / judged.length) * 100);
      for (const n of violators) {
        push('note', 'TW017',
          `passage name '${n}' uses characters outside the naming convention used by ${pct}% of passages`,
          passages[n].line, 4, 4 + n.length,
          "most passages use letters, digits, space, '-' or '_'; prefer kebab-case-style names");
      }
    }
  }

  // ---- Per-passage semantic pass: TW005/TW006/TW007/TW008/TW019 ------------
  const allAssigned = collectAssignedNames(story, names);
  for (const name of names) {
    const p = passages[name];
    const st = {
      defs: new Set(Object.keys(story.varsInit ?? {})),
      types: {},
      reported: new Set(),
      passage: p,
      story,
      push: (...args) => push(...args),
    };
    for (const [k, tv] of Object.entries(story.varsInit ?? {})) st.types[k] = tv.t;
    for (const param of p.params ?? []) st.defs.add(param);
    walkNodes(p.nodes ?? [], st);
  }

  return sortDiagnostics(ds);
}

// ---------------------------------------------------------------------------
// Expression-level checks
// ---------------------------------------------------------------------------

/** Static type of an expression when provable (literal or known variable). */
function inferType(expr, types) {
  if (!expr) return null;
  if (LITERAL_TYPE[expr.t]) return LITERAL_TYPE[expr.t];
  if (expr.t === 'var') return types[expr.name] ?? null;
  return null;
}

function checkExpr(expr, st) {
  walkExpr(expr, (v) => {
    switch (v.t) {
      case 'var': checkVarRead(v, st); break;
      case 'bin': checkBinop(v, st); break;
      case 'un':
        if (v.op === '-') {
          const t = inferType(v.e, st.types);
          if (t && t !== 'number') {
            st.push('error', 'TW006', `operator '-' requires numbers (got ${t})`,
              v.pos.line, v.pos.col, v.pos.col + 1,
              "'-' negates numbers; convert strings with num() first");
          }
        }
        break;
      case 'call': checkCall(v, st); break;
      default: break;
    }
  });
}

function checkVarRead(node, st) {
  if (st.defs.has(node.name) || st.reported.has(node.name)) return;
  st.reported.add(node.name); // first read site per variable per passage
  const ever = st.allAssigned?.has(node.name);
  const help = ever
    ? `'${node.name}' may be unset here; declare it in frontmatter 'vars:' or '~set ${node.name} = …' earlier in the passage`
    : `'${node.name}' is never assigned anywhere in this story; add it to frontmatter 'vars:' or create it with '~set ${node.name} = …'`;
  st.push('warning', 'TW005',
    `variable '${node.name}' may be read before being set`,
    node.pos.line, node.pos.col, node.pos.col + node.name.length, help);
}

function checkBinop(node, st) {
  const tl = inferType(node.l, st.types);
  const tr = inferType(node.r, st.types);
  if (!tl || !tr) return;
  let bad = false;
  let msg = '';
  switch (node.op) {
    case '+':
      bad = tl !== 'string' && tr !== 'string' &&
            !(tl === 'number' && tr === 'number') &&
            !(tl === 'list' && tr === 'list');
      msg = `operator '+' cannot combine ${tl} and ${tr}`;
      break;
    case '-': case '*': case '%': case '/':
      bad = tl !== 'number' || tr !== 'number';
      msg = `operator '${node.op}' requires numbers (got ${tl}, ${tr})`;
      break;
    case '<': case '<=': case '>': case '>=':
      bad = !((tl === 'number' && tr === 'number') || (tl === 'string' && tr === 'string'));
      msg = `relational '${node.op}' needs two numbers or two strings (got ${tl}, ${tr})`;
      break;
    default:
      return; // ==/!= are cross-type-false by SPEC §5.3, never an error; logic ops take anything
  }
  if (!bad) return;
  st.push('error', 'TW006', msg,
    node.pos.line, node.pos.col, node.pos.col + Math.max(1, node.op.length),
    'types are fixed at first assignment (SPEC §6); use str()/num()/bool() to convert');
}

function checkCall(node, st) {
  const bi = BUILTINS[node.name];
  const nArgs = node.args.length;
  if (bi) {
    const arityOk = nArgs >= bi.min && (bi.max === null || nArgs <= bi.max);
    if (!arityOk) {
      const expect = bi.min === bi.max
        ? `${bi.min} argument${bi.min === 1 ? '' : 's'}`
        : bi.max === null
          ? `at least ${bi.min} argument${bi.min === 1 ? '' : 's'}`
          : `${bi.min} to ${bi.max} arguments`;
      st.push('error', 'TW008',
        `'${node.name}' expects ${expect}, got ${nArgs}`,
        node.pos.line, node.pos.col, node.pos.col + node.name.length,
        'see the built-in table in SPEC §5.4');
      return;
    }
    for (let i = 0; i < nArgs; i++) {
      const expected = bi.params[Math.min(i, bi.params.length - 1)];
      if (!expected) continue;
      const got = inferType(node.args[i], st.types);
      if (got && got !== expected) {
        st.push('error', 'TW008',
          `'${node.name}' expects argument ${i + 1} to be a ${expected}, got ${got}`,
          node.pos.line, node.pos.col, node.pos.col + node.name.length,
          'see the built-in table in SPEC §5.4');
        return;
      }
    }
    return;
  }
  const target = st.story.passages?.[node.name];
  if (target) {
    if ((target.params?.length ?? 0) > 0) {
      if (nArgs !== target.params.length) {
        st.push('error', 'TW008',
          `macro '${node.name}' expects ${target.params.length} argument${target.params.length === 1 ? '' : 's'}, got ${nArgs}`,
          node.pos.line, node.pos.col, node.pos.col + node.name.length,
          `parameters are declared in the header, e.g. '== ${node.name}(${target.params.join(', ')}) =='`);
      }
      return;
    }
    st.push('error', 'TW007',
      `passage '${node.name}' takes no parameters and cannot be called as a function`,
      node.pos.line, node.pos.col, node.pos.col + node.name.length,
      `use '{{include ${node.name}}}' to splice it; macros must declare parameters`);
    return;
  }
  let near = null;
  let bestDist = 3;
  for (const b of Object.keys(BUILTINS)) {
    const dist = levenshtein(node.name, b, bestDist);
    if (dist < bestDist) { bestDist = dist; near = b; }
  }
  st.push('error', 'TW007', `call to unknown function '${node.name}'`,
    node.pos.line, node.pos.col, node.pos.col + node.name.length,
    near ? `unknown function; did you mean '${near}'? see SPEC §5.4`
         : `unknown function; see the built-in table in SPEC §5.4`);
}

// ---------------------------------------------------------------------------
// Statement/node dataflow walk
// ---------------------------------------------------------------------------

function walkNodes(nodes, st) {
  for (const nd of nodes) {
    switch (nd.k) {
      case 'text': case 'break':
        break;
      case 'em': case 'strong':
        walkNodes(nd.kids, st);
        break;
      case 'interp':
        checkExpr(nd.expr, st);
        break;
      case 'if': {
        for (const b of nd.branches) checkExpr(b.cond, st);
        const beforeDefs = st.defs;
        const beforeTypes = st.types;
        const outDefs = [];
        const outTypes = [];
        const runBranch = (branchNodes) => {
          const sub = {
            ...st,
            defs: new Set(beforeDefs),
            types: { ...beforeTypes },
          };
          walkNodes(branchNodes, sub);
          outDefs.push(sub.defs);
          outTypes.push(sub.types);
        };
        for (const b of nd.branches) runBranch(b.nodes);
        if (nd.elseNodes) {
          runBranch(nd.elseNodes);
        } else {
          outDefs.push(new Set(beforeDefs));
          outTypes.push({ ...beforeTypes });
        }
        st.defs = intersectSets(outDefs);
        st.types = mergeTypes(outTypes, beforeTypes);
        break;
      }
      case 'for': {
        checkExpr(nd.iter, st);
        checkLoopBound(nd, st);
        const sub = { ...st, defs: new Set([...st.defs, nd.varName]), types: { ...st.types } };
        walkNodes(nd.nodes, sub);
        break; // loop var scoped out; body mutations dropped conservatively
      }
      case 'set': {
        checkExpr(nd.expr, st);
        const known = st.types[nd.name];
        const got = inferType(nd.expr, st.types);
        if (known && got && got !== known) {
          st.push('error', 'TW006',
            `cannot assign a ${got} value to variable '${nd.name}' of type ${known}`,
            nd.pos.line, nd.pos.col, nd.pos.col + nd.name.length,
            "variables keep the type of their first assignment ('vars:' or first '~set'); use str()/num()/bool() to convert");
        } else if (!known && got) {
          st.types[nd.name] = got; // straight-line literal propagation
        }
        st.defs.add(nd.name);
        break;
      }
      case 'unset':
        st.defs.delete(nd.name);
        delete st.types[nd.name];
        break;
      case 'take': case 'drop':
        checkExpr(nd.item, st);
        if (nd.count) checkExpr(nd.count, st);
        break;
      case 'push': {
        checkExpr(nd.expr, st);
        const known = st.types[nd.name];
        if (known && known !== 'list') {
          st.push('error', 'TW006',
            `cannot push to variable '${nd.name}' of type ${known}`,
            nd.pos.line, nd.pos.col, nd.pos.col + nd.name.length,
            "'~push' appends to a list variable");
        }
        st.defs.add(nd.name);
        if (!known) st.types[nd.name] = 'list';
        break;
      }
      case 'include':
        // The included body is its own scope; only the arguments evaluate here.
        for (const a of nd.args ?? []) checkExpr(a, st);
        break;
      case 'link':
        walkNodes(nd.display, st);
        break;
      case 'choice':
        walkNodes(nd.display, st);
        if (nd.attrs?.ifExpr) checkExpr(nd.attrs.ifExpr, st);
        break;
      default:
        break;
    }
  }
}

/** TW019: suspiciously large constant loop bounds. */
function checkLoopBound(nd, st) {
  const capNote = (message, line, col) => {
    st.push('note', 'TW019', message, line, col, undefined,
      `loops beyond ${LOOP_CAP} iterations raise a runtime story fault; shrink the bound`);
  };
  const iter = nd.iter;
  if (iter.t === 'num' && iter.v > LOOP_CAP) {
    capNote(`for-loop bound ${iter.v} exceeds the ${LOOP_CAP}-iteration runtime guard`,
      st.passage.line, 1);
    return;
  }
  if (iter.t === 'call' && iter.name === 'range' && iter.args.length === 2 &&
      iter.args[0].t === 'num' && iter.args[1].t === 'num') {
    const [a, b] = [iter.args[0].v, iter.args[1].v];
    const span = b - a;
    if (span > LOOP_CAP) {
      capNote(`for-loop over range(${a}, ${b}) spans ${span} iterations, above the ${LOOP_CAP} guard`,
        iter.pos?.line ?? st.passage.line, iter.pos?.col ?? 1);
    }
  }
}

function intersectSets(sets) {
  const [first, ...rest] = sets;
  return new Set([...first].filter((x) => rest.every((s) => s.has(x))));
}

function mergeTypes(outs, before) {
  const res = {};
  const keys = new Set();
  for (const o of outs) for (const k of Object.keys(o)) keys.add(k);
  for (const k of keys) {
    let val;
    let agree = true;
    for (const o of outs) {
      const t = o[k];
      if (t === undefined) { agree = false; break; }
      if (val === undefined) val = t;
      else if (val !== t) { agree = false; break; }
    }
    if (agree) res[k] = val;
    else if (before[k] !== undefined) res[k] = before[k];
  }
  return res;
}

/** Every variable that is ever assigned anywhere (varsInit, ~set, ~push). */
function collectAssignedNames(story, names) {
  const out = new Set(Object.keys(story.varsInit ?? {}));
  const seeNodes = (nodes) => {
    for (const nd of nodes) {
      switch (nd.k) {
        case 'em': case 'strong': seeNodes(nd.kids); break;
        case 'if':
          for (const b of nd.branches) seeNodes(b.nodes);
          if (nd.elseNodes) seeNodes(nd.elseNodes);
          break;
        case 'for': seeNodes(nd.nodes); break;
        case 'set': out.add(nd.name); break;
        case 'push': out.add(nd.name); break;
        case 'link': seeNodes(nd.display); break;
        case 'choice': seeNodes(nd.display); break;
        case 'include': break;
        default: break;
      }
    }
  };
  for (const name of names) seeNodes(story.passages[name].nodes ?? []);
  return out;
}

/** Levenshtein distance with early cutoff. */
function levenshtein(a, b, cutoff) {
  if (Math.abs(a.length - b.length) > cutoff) return cutoff + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > cutoff) return cutoff + 1;
    prev = cur;
  }
  return prev[b.length];
}
