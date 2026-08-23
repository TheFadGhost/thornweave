/**
 * @file Story engine (SPEC §6–§9): state, passage walk, choices.
 * Pure with respect to the GameState passed in; all mutations happen on it.
 */
import { mulberry32 } from './rng.js';
import { evalExpr } from './expressions.js';
import { BUILTINS } from './builtins.js';
import { truthy, renderValue, typeOf } from './values.js';
import { createState, fault } from '../state/model.js';
import { storyFingerprint } from '../compile/fingerprint.js';
import { LOOP_CAP, INCLUDE_DEPTH_CAP, resolveStart } from '../syntax/ast.js';

const LOGIC_KINDS = new Set(['set', 'unset', 'take', 'drop', 'push']);

export class Engine {
  constructor(story) {
    this.story = story;
    this.hash = storyFingerprint(story);
  }

  newGame(seed) {
    const s = seed === undefined
      ? (Math.floor(Math.random() * 0x100000000) >>> 0)
      : (seed >>> 0);
    const st = createState(this.hash, s, this.story);
    return st;
  }

  start(state) {
    const start = resolveStart(this.story);
    if (!start || !this.story.passages[start]) {
      throw fault('no-start', 'story has no playable start passage');
    }
    state.current = start;
    return this.enter(state, start);
  }

  /** Walk a passage on `state`, returning display blocks + visible choices. */
  enter(state, name, opts = {}) {
    const passage = this.story.passages[name];
    if (!passage) throw fault('internal', `passage '${name}' does not exist`);
    if (!opts.dry) {
      state.visited[name] = (state.visited[name] ?? 0) + 1;
      if (state.turn === 0) state.turn = 1;
    }
    const rng = mulberry32(state.rngWord);
    const drawSync = (fn) => (...a) => {
      const r = fn(...a);
      state.rngWord = rng.getWord();
      return r;
    };
    const ctx = new Walk(this, state, {
      getVar: null,
      rng: {
        next: drawSync((a) => rng.next(a)),
        int: drawSync((a, b) => rng.int(a, b)),
        pick: drawSync((a) => rng.pick(a)),
      },
      dry: !!opts.dry,
    });
    ctx.run(passage.nodes);
    return ctx.finish(name);
  }

  /** Commit a choice taken from a previous enter() result. */
  choose(state, choice) {
    if (!choice) throw fault('choice-unavailable', 'no such choice');
    if (choice.disabled || choice.consumed) throw fault('choice-unavailable', 'that choice is no longer available');
    const target = this.story.passages[choice.target];
    if (!target) throw fault('unknown-target', `choice leads to missing passage '${choice.target}'`);
    if (choice.once) state.consumed[choice.id] = true;
    state.turn += 1;
    return this.enter(state, choice.target);
  }

  /** Where a timed choice sends the player when its countdown expires. */
  timeoutTarget(choice, lastRender) {
    if (choice.timeout && this.story.passages[choice.timeout]) return choice.timeout;
    const fallback = (lastRender?.choices ?? []).find((c) => !c.disabled && !c.consumed && !(c.time > 0));
    if (fallback) return fallback.target;
    return choice.target;
  }
}

class Scope {
  constructor(parent) {
    this.parent = parent;
    this.vars = new Map();
  }
  lookup(name) {
    let s = this;
    while (s) {
      if (s.vars.has(name)) return s.vars.get(name);
      s = s.parent;
    }
    return undefined;
  }
  ownerOf(name) {
    let s = this;
    while (s) {
      if (s.vars.has(name)) return s;
      s = s.parent;
    }
    return null;
  }
}

class Walk {
  constructor(engine, state, base) {
    this.engine = engine;
    this.state = state;
    this.base = base;
    this.scope = new Scope(null);
    this.blocks = [];
    this.choices = [];
    this.paraRuns = null;
    this.depth = 0;
    this.env = {
      getVar: (n) => {
        const hit = this.scope.lookup(n);
        if (hit !== undefined) return hit;
        if (Object.prototype.hasOwnProperty.call(state.vars, n)) {
          return { t: state.vtypes[n], v: state.vars[n] };
        }
        return undefined;
      },
      rng: base.rng,
      ctx: {
        visited: (n) => state.visited[n] ?? 0,
        seen: (n) => (state.visited[n] ?? 0) > 0,
        has: (i) => (state.inv[i] ?? 0) > 0,
        count: (i) => state.inv[i] ?? 0,
        inv: () => Object.keys(state.inv).filter((k) => state.inv[k] > 0).sort(),
        turns: () => state.turn,
      },
      callMacro: null,
    };
  }

  eval(expr, pos) {
    if (!expr) throw fault('runtime', 'missing expression', pos);
    try {
      return evalExpr(expr, this.env);
    } catch (e) {
      if (e && e.fault === 'runtime' && !e.pos && expr.pos) e.pos = expr.pos;
      throw e;
    }
  }

  run(nodes) {
    for (const node of nodes) this.node(node);
  }

  openP() {
    if (this.paraRuns === null) this.paraRuns = [];
  }
  flushP() {
    if (this.paraRuns !== null) {
      if (this.paraRuns.length > 0) this.blocks.push({ type: 'p', runs: this.paraRuns });
      this.paraRuns = null;
    }
  }
  addRun(run) {
    this.openP();
    this.paraRuns.push(run);
  }
  addText(v) {
    if (v === '') return;
    const runs = this.paraRuns;
    if (runs && runs.length > 0) {
      const last = runs[runs.length - 1];
      if (last.t === 'text') { last.v += v; return; }
    }
    this.addRun({ t: 'text', v });
  }
  plainLabel(nodes) {
    let out = '';
    const walk = (ns) => {
      for (const n of ns) {
        if (n.k === 'text') out += n.v;
        else if (n.k === 'em' || n.k === 'strong') walk(n.kids);
        else if (n.k === 'interp' && n.expr) {
          try { out += renderValue(this.eval(n.expr, n.pos)); } catch { out += '…'; }
        }
      }
    };
    walk(nodes);
    return out.trim();
  }

  registerChoice(node, origin) {
    const consumedOnce = node.attrs.once && !!this.state.consumed[node.id];
    if (origin === 'bullet' && node.attrs.ifExpr && !truthy(this.eval(node.attrs.ifExpr, node.pos))) return;
    const entry = {
      i: this.choices.length,
      id: node.id,
      origin,
      target: node.target,
      label: this.plainLabel(node.display),
      once: !!node.attrs.once,
      consumed: consumedOnce,
      time: node.attrs.time || 0,
      timeout: node.attrs.timeout ?? null,
      disabled: consumedOnce,
    };
    this.choices.push(entry);
    return entry;
  }

  declare(name, value, scopeMap) {
    const t = typeOf(value);
    scopeMap.set(name, { t, v: value });
  }

  assign(node, name, value) {
    const ownerScope = this.scope.ownerOf(name);
    if (ownerScope) {
      const cur = ownerScope.vars.get(name);
      if (typeOf(value) !== cur.t) {
        throw fault('runtime', `'${name}' is ${cur.t}; cannot assign a ${typeOf(value)} value`, node?.pos);
      }
      cur.v = value;
      return;
    }
    const declared = this.state.vtypes[name];
    if (declared && declared !== typeOf(value)) {
      throw fault('runtime', `'${name}' is ${declared}; cannot assign a ${typeOf(value)} value`, node?.pos);
    }
    this.state.vtypes[name] = typeOf(value);
    this.state.vars[name] = value;
  }

  node(n) {
    switch (n.k) {
      case 'p':
        this.flushP();
        this.openP();
        for (const kid of n.kids) this.node(kid);
        this.flushP();
        break;
      case 'text': this.addText(n.v); break;
      case 'break': this.flushP(); this.blocks.push({ type: 'break' }); break;
      case 'em':
      case 'strong':
        this.addRun({ t: n.k, runs: [] });
        {
          const parent = this.paraRuns[this.paraRuns.length - 1];
          const saved = this.paraRuns;
          this.paraRuns = parent.runs;
          for (const kid of n.kids) this.node(kid);
          this.paraRuns = saved;
        }
        break;
      case 'interp': {
        const e = n.expr;
        if (e && e.t === 'call' && !BUILTINS[e.name] && this.engine.story.passages[e.name]) {
          this.include({ target: e.name, args: e.args, pos: n.pos });
          break;
        }
        this.addText(renderValue(this.eval(e, n.pos)));
        break;
      }
      case 'if': {
        for (const b of n.branches) {
          if (truthy(this.eval(b.cond, n.pos))) {
            this.run(b.nodes);
            return;
          }
        }
        this.run(n.elseNodes);
        break;
      }
      case 'for': {
        const listVal = this.eval(n.iter, n.pos);
        if (typeOf(listVal) !== 'list') {
          throw fault('runtime', "'for' needs a list to iterate", n.pos);
        }
        if (listVal.length > LOOP_CAP) {
          throw fault('runtime', `loop exceeds the ${LOOP_CAP}-iteration safety cap`, n.pos);
        }
        for (const item of [...listVal]) {
          const sc = new Scope(this.scope);
          this.declare(n.varName, item, sc.vars);
          this.scope = sc;
          this.run(n.nodes);
          this.scope = sc.parent;
        }
        break;
      }
      case 'set':
        this.assign(n, n.name, this.eval(n.expr, n.pos));
        break;
      case 'unset': {
        const owner = this.scope.ownerOf(n.name);
        if (owner) owner.vars.delete(n.name);
        else {
          delete this.state.vars[n.name];
          delete this.state.vtypes[n.name];
        }
        break;
      }
      case 'take': {
        const item = String(this.eval(n.item, n.pos));
        const count = n.count ? Math.trunc(Number(this.eval(n.count, n.pos))) : 1;
        if (!(count >= 0)) throw fault('runtime', 'cannot take a negative number of items', n.pos);
        this.state.inv[item] = (this.state.inv[item] ?? 0) + count;
        break;
      }
      case 'drop': {
        const item = String(this.eval(n.item, n.pos));
        const count = n.count ? Math.trunc(Number(this.eval(n.count, n.pos))) : 1;
        if (!(count >= 0)) throw fault('runtime', 'cannot drop a negative number of items', n.pos);
        const have = this.state.inv[item] ?? 0;
        if (have < count) throw fault('runtime', `cannot drop ${count} of '${item}' (carrying ${have})`, n.pos);
        const left = have - count;
        if (left === 0) delete this.state.inv[item];
        else this.state.inv[item] = left;
        break;
      }
      case 'push': {
        const listVal = this.eval(n.expr, n.pos);
        const holder = this.scope.ownerOf(n.name);
        const arr = holder ? holder.vars.get(n.name)?.v : this.state.vars[n.name];
        if (!Array.isArray(arr)) throw fault('runtime', `'${n.name}' is not a list`, n.pos);
        if (arr.length >= LOOP_CAP) throw fault('runtime', `list '${n.name}' exceeded the safety cap`, n.pos);
        arr.push(listVal);
        break;
      }
      case 'include': this.include(n); break;
      case 'link': {
        const entry = this.registerChoice(n, 'inline');
        if (entry) this.addRun({ t: 'link', choice: entry.i });
        break;
      }
      case 'choice': {
        const entry = this.registerChoice(n, 'bullet');
        void entry;
        break;
      }
      default:
        throw fault('internal', `unknown node kind '${n.k}'`);
    }
  }

  include(n) {
    if (this.depth >= INCLUDE_DEPTH_CAP) {
      throw fault('runtime', `includes nest deeper than ${INCLUDE_DEPTH_CAP} (possible recursion)`, n.pos);
    }
    const target = this.engine.story.passages[n.target];
    if (!target) throw fault('runtime', `include/macro names unknown passage '${n.target}'`, n.pos);
    const args = n.args ?? null;
    const sc = new Scope(this.scope);
    if (args !== null) {
      if (args.length !== target.params.length) {
        throw fault('runtime', `macro '${n.target}' expects ${target.params.length} argument(s), got ${args.length}`, n.pos);
      }
      args.forEach((a, i2) => {
        this.declare(target.params[i2], this.eval(a, a?.pos ?? n.pos), sc.vars);
      });
    } else if (target.params.length > 0) {
      throw fault('runtime', `macro '${n.target}' needs ${target.params.length} argument(s)`, n.pos);
    }
    const saved = this.scope;
    this.scope = sc;
    this.depth++;
    this.run(target.nodes);
    this.depth--;
    this.scope = saved;
  }

  finish(name) {
    this.flushP();
    return {
      passage: name,
      blocks: this.blocks,
      choices: this.choices,
      ending: this.engine.story.passages[name]?.tags.includes('ending') ?? false,
      tags: this.engine.story.passages[name]?.tags ?? [],
    };
  }
}

export function builtinNames() {
  return Object.keys(BUILTINS);
}
