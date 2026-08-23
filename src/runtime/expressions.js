/**
 * @file Expression evaluator (SPEC §5). Walks the AST shapes defined in
 * syntax/ast.js against an env of { getVar, rng, ctx, callMacro }. Every
 * thrown fault is a 'runtime' fault carrying e.pos whenever the originating
 * node has a source position.
 *
 * @typedef {object} EvalEnv
 * @property {(name: string) => ({t: string, v: *}|undefined)} getVar
 * @property {import('./rng.js').Rng} rng
 * @property {{visited: (p: string) => number, seen: (p: string) => boolean,
 *             has: (i: string) => boolean, count: (i: string) => number,
 *             inv: () => string[], turns: () => number}} ctx
 * @property {(name: string, args: *) => (*|undefined)} callMacro
 */
import { fault } from '../state/model.js';
import { addValues, equals, truthy, typeOf } from './values.js';
import { BUILTINS } from './builtins.js';

function requireNums(op, l, r) {
  const lt = typeOf(l);
  const rt = typeOf(r);
  if (lt !== 'number' || rt !== 'number')
    throw fault('runtime', `operator '${op}' requires numbers (got ${lt} and ${rt})`);
}

function compare(op, l, r) {
  const lt = typeOf(l);
  const rt = typeOf(r);
  const numeric = lt === 'number' && rt === 'number';
  const textual = lt === 'string' && rt === 'string';
  if (!numeric && !textual)
    throw fault('runtime', `operator '${op}' requires two numbers or two strings (got ${lt} and ${rt})`);
  switch (op) {
    case '<': return l < r;
    case '<=': return l <= r;
    case '>': return l > r;
    default: return l >= r;
  }
}

function binary(op, l, r, pos) {
  try {
    switch (op) {
      case '+': return addValues(l, r);
      case '-': requireNums(op, l, r); return l - r;
      case '*': requireNums(op, l, r); return l * r;
      case '/':
        requireNums(op, l, r);
        if (r === 0) throw fault('runtime', 'division by zero');
        return l / r;
      case '%':
        requireNums(op, l, r);
        if (r === 0) throw fault('runtime', 'division by zero');
        return l % r;
      case '==': return equals(l, r);
      case '!=': return !equals(l, r);
      case '<': case '<=': case '>': case '>=': return compare(op, l, r);
      default: throw fault('runtime', `unknown operator '${op}'`);
    }
  } catch (e) {
    if (e && e.fault && pos && e.pos == null) e.pos = pos;
    throw e;
  }
}

function checkArgs(node, entry, args) {
  const { min, max, params } = entry;
  const name = node.name;
  if (args.length < min || (max !== null && args.length > max)) {
    const expected = max === null ? `at least ${min}` : min === max ? `${min}` : `${min}-${max}`;
    const one = max === null ? min === 1 : min === max && min === 1;
    throw fault('runtime', `'${name}' expects ${expected} argument${one ? '' : 's'} (got ${args.length})`, node.pos);
  }
  for (let i = 0; i < args.length; i++) {
    const want = params[Math.min(i, params.length - 1)];
    if (want !== null && typeOf(args[i]) !== want)
      throw fault('runtime', `'${name}' expects a ${want} argument at position ${i + 1} (got ${typeOf(args[i])})`, node.pos);
  }
}

/**
 * Evaluates one expression AST node.
 * @param {import('../syntax/ast.js').ASTExpr} expr
 * @param {EvalEnv} env
 * @returns {*}
 */
export function evalExpr(expr, env) {
  switch (expr.t) {
    case 'num':
    case 'str':
    case 'bool':
      return expr.v;
    case 'list':
      return expr.items.map((it) => evalExpr(it, env));
    case 'var': {
      const tv = env.getVar(expr.name);
      if (tv === undefined)
        throw fault('runtime', `variable '${expr.name}' is not set`, expr.pos);
      return tv.v;
    }
    case 'un': {
      const v = evalExpr(expr.e, env);
      if (expr.op === '-') {
        if (typeOf(v) !== 'number')
          throw fault('runtime', `operator '-' requires a number (got ${typeOf(v)})`, expr.pos);
        return -v;
      }
      return !truthy(v);
    }
    case 'ternary':
      return truthy(evalExpr(expr.c, env))
        ? evalExpr(expr.a, env)
        : evalExpr(expr.b, env);
    case 'bin': {
      if (expr.op === 'and' || expr.op === '&&') {
        if (!truthy(evalExpr(expr.l, env))) return false;
        return truthy(evalExpr(expr.r, env));
      }
      if (expr.op === 'or' || expr.op === '||') {
        if (truthy(evalExpr(expr.l, env))) return true;
        return truthy(evalExpr(expr.r, env));
      }
      return binary(expr.op, evalExpr(expr.l, env), evalExpr(expr.r, env), expr.pos);
    }
    case 'call': {
      const args = expr.args.map((a) => evalExpr(a, env));
      const entry = BUILTINS[expr.name];
      if (entry) {
        checkArgs(expr, entry, args);
        return entry.fn(env, ...args);
      }
      if (typeof env.callMacro !== 'function') {
        throw fault('runtime', `unknown function '${expr.name}'`, expr.pos);
      }
      const mv = env.callMacro(expr.name, args);
      if (mv === undefined)
        throw fault('runtime', `unknown function '${expr.name}'`, expr.pos);
      return mv;
    }
    default:
      throw fault('runtime', `unknown expression kind '${expr.t}'`);
  }
}
