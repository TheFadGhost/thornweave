/**
 * @file Runtime tests: RNG determinism (SPEC §9), value semantics (§4.1,
 * §5.3), builtins (§5.4), and expression evaluation over hand-built ASTs
 * matching src/syntax/ast.js shapes exactly (§5, §5.2 precedence).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../src/runtime/rng.js';
import { typeOf, truthy, renderValue, equals, addValues } from '../../src/runtime/values.js';
import { BUILTINS } from '../../src/runtime/builtins.js';
import { evalExpr } from '../../src/runtime/expressions.js';

const num = (v) => ({ t: 'num', v });
const str = (v) => ({ t: 'str', v });
const bool = (v) => ({ t: 'bool', v });
const lit = (items) => ({ t: 'list', items });
const vr = (name, pos) => ({ t: 'var', name, pos });
const bin = (op, l, r, pos) => ({ t: 'bin', op, l, r, pos });
const un = (op, e, pos) => ({ t: 'un', op, e, pos });
const ter = (c, a, b, pos) => ({ t: 'ternary', c, a, b, pos });
const call = (name, args, pos) => ({ t: 'call', name, args, pos });
const P = { line: 3, col: 7 };

function makeEnv(over = {}) {
  const vars = {
    gold: { t: 'number', v: 10 },
    name: { t: 'string', v: 'thorn' },
    flag: { t: 'boolean', v: true },
    row: { t: 'list', v: [1, 2] },
  };
  return {
    getVar: (n) => vars[n],
    rng: mulberry32(99),
    ctx: {
      visited: (p) => (p === 'castle' ? 2 : 0),
      seen: (p) => p === 'castle',
      has: (i) => i === 'key',
      count: (i) => (i === 'coin' ? 3 : 0),
      inv: () => ['apple', 'zebra'],
      turns: () => 7,
    },
    callMacro: () => undefined,
    ...over,
  };
}

function run(node, env = makeEnv()) {
  return evalExpr(node, env);
}

function faultOf(node, env) {
  try {
    evalExpr(node, env ?? makeEnv());
  } catch (e) {
    assert.equal(e.fault, 'runtime');
    return e;
  }
  assert.fail('expected a runtime fault');
}

function runtimeFault(fn, re) {
  try {
    fn();
  } catch (e) {
    assert.equal(e.fault, 'runtime');
    if (re) assert.match(e.message, re);
    return e;
  }
  assert.fail('expected a runtime fault');
}

test('precedence: * binds tighter than + (SPEC §5.2 levels 6,7)', () => {
  assert.equal(run(bin('+', num(1), bin('*', num(2), num(3)))), 7);
  assert.equal(run(bin('*', bin('+', num(1), num(2)), num(3))), 9);
});

test('precedence: not binds tighter than or; or looser than and', () => {
  assert.equal(run(bin('or', un('not', bool(true)), bool(false))), false);
  assert.equal(run(bin('or', bool(true), bin('and', bool(false), bool(false)))), true);
  assert.equal(run(bin('and', bin('or', bool(true), bool(false)), bool(false))), false);
});

test('precedence: not binds tighter than == (level 4 vs 5)', () => {
  assert.equal(run(bin('==', un('not', num(1)), num(2))), false);
  assert.notEqual(
    run(bin('==', un('not', num(1)), num(2))),
    run(un('not', bin('==', num(1), num(2))))
  );
});

test('precedence: unary minus binds tighter than * (level 8 vs 7)', () => {
  assert.equal(run(bin('*', un('-', num(2)), num(3))), -6);
  assert.equal(run(un('-', bin('*', num(2), num(3)))), -6);
});

test('precedence: ! groups with its operand inside &&', () => {
  const xAndY = (xv, yv) =>
    run(bin('and', un('not', bool(xv)), bool(yv)));
  assert.equal(xAndY(true, false), false);
  assert.equal(xAndY(false, true), true);
  assert.equal(xAndY(true, true), false);
});

test('precedence: ternary is right-associative', () => {
  const t = str('a');
  const f1 = ter(bool(false), str('b'), str('c'));
  const f2 = ter(bool(true), str('b'), str('c'));
  assert.equal(run(ter(bool(true), t, f1)), 'a');
  assert.equal(run(ter(bool(false), t, f2)), 'b');
  assert.equal(run(ter(bool(false), t, f1)), 'c');
});

test('ternary picks branch by truthiness of condition', () => {
  assert.equal(run(ter(num(0), num(1), num(2))), 2);
  assert.equal(run(ter(str(''), num(1), num(2))), 2);
  assert.equal(run(ter(lit([]), num(1), num(2))), 2);
  assert.equal(run(ter(str('0'), num(1), num(2))), 1);
});

test('and/or short-circuit and return booleans', () => {
  assert.equal(run(bin('or', bool(true), call('nope', []))), true);
  assert.equal(run(bin('and', bool(false), call('nope', []))), false);
  assert.equal(run(bin('and', num(2), str('x'))), true);
  assert.equal(run(bin('or', num(0), str(''))), false);
});

test('coercion: string on either side of + concatenates via renderValue', () => {
  assert.equal(run(bin('+', str('a'), num(1))), 'a1');
  assert.equal(run(bin('+', num(1), str('a'))), '1a');
  assert.equal(run(bin('+', str('v='), bool(true))), 'v=true');
  assert.equal(run(bin('+', lit([num(1)]), str('x'))), '[1]x');
  assert.equal(run(bin('+', num(2), num(3))), 5);
});

test('coercion: list+list concatenates per SPEC §5.3', () => {
  assert.deepEqual(run(bin('+', lit([num(1), num(2)]), lit([num(3)]))), [1, 2, 3]);
  assert.deepEqual(run(bin('+', lit([]), lit([str('a')]))), ['a']);
});

test('coercion: invalid + combinations fault naming types', () => {
  assert.match(faultOf(bin('+', lit([num(1)]), num(2))).message, /list and number/);
  assert.match(faultOf(bin('+', bool(true), bool(false))).message, /'\+'/);
  runtimeFault(() => addValues(true, false), /cannot combine boolean and boolean/);
});

test('coercion: - * % are numbers-only and faults name op and types', () => {
  for (const [op, msg] of [['-', /'-'.*string and number/], ['*', /'\*'.*string and number/], ['%', /'%'.*string and number/]]) {
    const e = faultOf(bin(op, str('3'), num(2)));
    assert.match(e.message, msg);
  }
  assert.match(faultOf(bin('-', num(1), bool(true))).message, /number and boolean/);
});

test('coercion: truncated modulo, sign follows dividend', () => {
  assert.equal(run(bin('%', num(7), un('-', num(3)))), 1);
  assert.equal(run(bin('%', un('-', num(7)), num(3))), -1);
  assert.equal(run(bin('%', num(9), num(4))), 1);
  assert.equal(run(bin('%', un('-', num(9)), un('-', num(4)))), -1);
});

test('division by zero faults with message and position', () => {
  const e = faultOf(bin('/', num(5), num(0), P));
  assert.match(e.message, /division by zero/);
  assert.deepEqual(e.pos, P);
  assert.match(faultOf(bin('%', num(5), num(0))).message, /division by zero/);
  assert.equal(run(bin('/', num(7), un('-', num(2)))), -3.5);
});

test('equality: cross-type equals is false, never an error', () => {
  assert.equal(run(bin('==', num(1), str('1'))), false);
  assert.equal(run(bin('!=', num(1), str('1'))), true);
  assert.equal(run(bin('==', num(0), bool(false))), false);
  assert.equal(run(bin('==', str(''), lit([]))), false);
  assert.equal(run(bin('==', str('a'), str('a'))), true);
  assert.equal(run(bin('==', bool(false), bool(false))), true);
  assert.deepEqual(equals(NaN, NaN), false);
});

test('equality: lists compare element-wise, recursively', () => {
  assert.equal(equals([1, [2, 'a']], [1, [2, 'a']]), true);
  assert.equal(equals([1, 2], [1, 3]), false);
  assert.equal(equals([1], [1, 2]), false);
  assert.equal(equals([1], ['1']), false);
  assert.equal(equals([], []), true);
  assert.equal(run(bin('==', lit([num(1), lit([num(2)])]), lit([num(1), lit([num(2)])]))), true);
});

test('relational: two numbers or two strings, code-point order', () => {
  assert.equal(run(bin('>', str('b'), str('a'))), true);
  assert.equal(run(bin('<', str('abc'), str('abd'))), true);
  assert.equal(run(bin('<', str('A'), str('a'))), true);
  assert.equal(run(bin('<=', num(2), num(2))), true);
  assert.equal(run(bin('>=', num(3), num(2))), true);
  assert.match(faultOf(bin('<', num(1), str('a'))).message, /'<'.*number and string/);
  assert.match(faultOf(bin('>=', str('a'), num(1))).message, /'>='.*/);
});

test('truthiness table (SPEC §5.3)', () => {
  assert.equal(truthy(false), false);
  assert.equal(truthy(0), false);
  assert.equal(truthy(''), false);
  assert.equal(truthy([]), false);
  assert.equal(truthy('0'), true);
  assert.equal(truthy(1), true);
  assert.equal(truthy('a'), true);
  assert.equal(truthy([0]), true);
  assert.equal(truthy(true), true);
  assert.equal(truthy(NaN), true);
});

test('typeOf and renderValue canonical forms (SPEC §4.1)', () => {
  assert.equal(typeOf(1), 'number');
  assert.equal(typeOf('s'), 'string');
  assert.equal(typeOf(true), 'boolean');
  assert.equal(typeOf([]), 'list');
  assert.equal(renderValue(3), '3');
  assert.equal(renderValue(3.5), '3.5');
  assert.equal(renderValue(-0), '0');
  assert.equal(renderValue(-42), '-42');
  assert.equal(renderValue(true), 'true');
  assert.equal(renderValue(false), 'false');
  assert.equal(renderValue('raw & <text>'), 'raw & <text>');
  assert.equal(renderValue([1, 'a']), '[1, a]');
  assert.equal(renderValue([[1], [2, 'b'], []]), '[[1], [2, b], []]');
  assert.equal(renderValue([]), '[]');
});

test('variable read resolves through env.getVar', () => {
  assert.equal(run(vr('gold')), 10);
  assert.equal(run(vr('name')), 'thorn');
  assert.equal(run(vr('flag')), true);
  assert.deepEqual(run(vr('row')), [1, 2]);
});

test('unset variable read faults naming the variable, carrying pos', () => {
  const e = faultOf(vr('missing', P));
  assert.match(e.message, /variable 'missing' is not set/);
  assert.deepEqual(e.pos, P);
});

test('unary minus requires a number; not applies truthiness', () => {
  const e = faultOf(un('-', str('x'), P));
  assert.match(e.message, /operator '-' requires a number \(got string\)/);
  assert.deepEqual(e.pos, P);
  assert.equal(run(un('-', num(4))), -4);
  assert.equal(run(un('not', num(0))), true);
  assert.equal(run(un('not', str('0'))), false);
  assert.equal(run(un('!', num(3))), false);
});

test('faults carry e.fault=runtime and inherit node pos when absent deeper', () => {
  const noPos = bin('+', bool(true), bool(false));
  const e1 = faultOf(noPos);
  assert.equal(e1.pos, null);
  const outer = bin('+', lit([num(1)]), num(2), P);
  const e2 = faultOf(outer);
  assert.match(e2.message, /list and number/);
  assert.deepEqual(e2.pos, P);
});

test('seeded determinism: identical seeds produce identical sequences', () => {
  const a = mulberry32(4242);
  const b = mulberry32(4242);
  const sa = [];
  const sb = [];
  for (let i = 0; i < 1000; i++) sa.push(a.next());
  for (let i = 0; i < 1000; i++) sb.push(b.next());
  assert.deepEqual(sa, sb);
  const c = mulberry32(4243);
  let differs = false;
  for (let i = 0; i < 100; i++) if (c.next() !== sa[i]) { differs = true; break; }
  assert.ok(differs);
});

test('rng word round-trips through getWord/setWord', () => {
  const r = mulberry32(2024);
  for (let i = 0; i < 37; i++) r.next();
  const w = r.getWord();
  assert.ok(Number.isInteger(w) && w >= 0 && w <= 0xFFFFFFFF);
  const ahead = [r.next(), r.next(), r.next()];
  const r2 = mulberry32(1);
  r2.setWord(w);
  assert.deepEqual([r2.next(), r2.next(), r2.next()], ahead);
  assert.equal(r2.getWord(), r.getWord());
  const r3 = mulberry32(555);
  r3.setWord(0);
  const ref = mulberry32(0);
  for (let i = 0; i < 20; i++) assert.equal(r3.next(), ref.next());
  const r4 = mulberry32(7);
  r4.setWord(4294967296 + 5);
  assert.equal(r4.getWord(), 5);
});

test('random hits inclusive endpoints within N draws', () => {
  const env = makeEnv({ rng: mulberry32(7) });
  let sawLow = false;
  let sawHigh = false;
  for (let i = 0; i < 3000; i++) {
    const v = run(call('random', [num(2), num(5)]), env);
    assert.ok(Number.isInteger(v) && v >= 2 && v <= 5);
    if (v === 2) sawLow = true;
    if (v === 5) sawHigh = true;
  }
  assert.ok(sawLow && sawHigh);
  assert.equal(run(call('random', [num(3), num(3)]), env), 3);
});

test('pick distributes over every element of the list', () => {
  const env = makeEnv({ rng: mulberry32(11) });
  const counts = [0, 0, 0];
  for (let i = 0; i < 3000; i++) {
    const v = run(call('pick', [lit([num(0), num(1), num(2)])]), env);
    counts[v]++;
  }
  for (const c of counts) assert.ok(c > 400, `count ${c} too low`);
});

test('same seed reproduces same random/pick sequence via evalExpr', () => {
  const draw = (env) => [
    run(call('random', [num(1), num(100)]), env),
    run(call('pick', [lit([str('a'), str('b'), str('c'), str('d')])]), env),
  ];
  const e1 = makeEnv({ rng: mulberry32(64) });
  const e2 = makeEnv({ rng: mulberry32(64) });
  for (let i = 0; i < 50; i++) assert.deepEqual(draw(e1), draw(e2));
});

test('BUILTINS table shape covers exactly SPEC §5.4 entries', () => {
  assert.deepEqual(Object.keys(BUILTINS).sort(), [
    'abs', 'bool', 'ceil', 'count', 'floor', 'has', 'inv', 'len', 'lower',
    'max', 'min', 'num', 'pick', 'random', 'range', 'seen', 'str', 'turns',
    'upper', 'visited',
  ]);
  for (const [name, b] of Object.entries(BUILTINS)) {
    assert.equal(typeof b.min, 'number', name);
    assert.ok(b.max === null || b.max >= b.min, name);
    assert.ok(Array.isArray(b.params), name);
    assert.equal(typeof b.fn, 'function', name);
  }
});

test('len uses UTF-16 code units and accepts strings and lists', () => {
  assert.equal(run(call('len', [str('héllo')])), 5);
  assert.equal(run(call('len', [str('a𝄞b')])), 4);
  assert.equal(run(call('len', [lit([num(1), num(2), num(3)])])), 3);
  assert.match(faultOf(call('len', [num(5)])).message, /'len' expects a string or a list/);
});

test('upper/lower fold ASCII only', () => {
  assert.equal(run(call('upper', [str('héllo')])), 'HéLLO');
  assert.equal(run(call('upper', [str('aBc9-')])), 'ABC9-');
  assert.equal(run(call('lower', [str('ÁbC')])), 'Ábc');
  assert.equal(run(call('lower', [str('MiXeD123')])), 'mixed123');
});

test('str renders per §4.1', () => {
  assert.equal(run(call('str', [num(3)])), '3');
  assert.equal(run(call('str', [num(3.5)])), '3.5');
  assert.equal(run(call('str', [lit([num(1), str('a')])])), '[1, a]');
  assert.equal(run(call('str', [bool(true)])), 'true');
  assert.equal(run(call('str', [str('x')])), 'x');
});

test('num parses strict decimal strings else faults', () => {
  assert.equal(run(call('num', [str('2.5')])), 2.5);
  assert.equal(run(call('num', [str('-3')])), -3);
  assert.equal(run(call('num', [str('0')])), 0);
  assert.equal(run(call('num', [str('007')])), 7);
  for (const bad of ['x', '', '1.', '.', '1e3', '+1', '2.5.1']) {
    const e = faultOf(call('num', [str(bad)]));
    assert.match(e.message, /cannot parse/);
  }
});

test('bool applies truthiness', () => {
  assert.equal(run(call('bool', [str('')])), false);
  assert.equal(run(call('bool', [lit([])])), false);
  assert.equal(run(call('bool', [num(0)])), false);
  assert.equal(run(call('bool', [bool(false)])), false);
  assert.equal(run(call('bool', [str('0')])), true);
  assert.equal(run(call('bool', [lit([num(0)])])), true);
});

test('range yields integers a..b-1, empty when b <= a', () => {
  assert.deepEqual(run(call('range', [num(1), num(4)])), [1, 2, 3]);
  assert.deepEqual(run(call('range', [num(3), num(3)])), []);
  assert.deepEqual(run(call('range', [num(5), num(3)])), []);
  assert.deepEqual(run(call('range', [un('-', num(2)), num(2)])), [-2, -1, 0, 1]);
  assert.match(faultOf(call('range', [num(1.5), num(4)])).message, /integer bounds/);
});

test('min/max variadic numerics', () => {
  assert.equal(run(call('min', [num(3), num(1), num(2)])), 1);
  assert.equal(run(call('max', [num(3), num(1), num(2)])), 3);
  assert.equal(run(call('min', [num(7)])), 7);
  assert.equal(run(call('max', [un('-', num(5)), un('-', num(9))])), -5);
  assert.match(faultOf(call('max', [str('a'), num(1)])).message, /expects a number argument at position 1/);
});

test('floor/ceil/abs numeric helpers', () => {
  assert.equal(run(call('floor', [num(2.7)])), 2);
  assert.equal(run(call('floor', [un('-', num(2.5))])), -3);
  assert.equal(run(call('ceil', [num(2.1)])), 3);
  assert.equal(run(call('ceil', [un('-', num(2.5))])), -2);
  assert.equal(run(call('abs', [un('-', num(4))])), 4);
  assert.equal(run(call('abs', [num(4)])), 4);
});

test('world reads come from env.ctx', () => {
  assert.equal(run(call('visited', [str('castle')])), 2);
  assert.equal(run(call('visited', [str('nowhere')])), 0);
  assert.equal(run(call('seen', [str('castle')])), true);
  assert.equal(run(call('seen', [str('dungeon')])), false);
  assert.equal(run(call('has', [str('key')])), true);
  assert.equal(run(call('has', [str('sword')])), false);
  assert.equal(run(call('count', [str('coin')])), 3);
  assert.deepEqual(run(call('inv', [])), ['apple', 'zebra']);
  assert.equal(run(call('turns', [])), 7);
  assert.equal(renderValue(run(call('inv', []))), '[apple, zebra]');
});

test('dispatch prefers builtins, then callMacro, then unknown fault', () => {
  const macroEnv = makeEnv({
    callMacro: (n, args) => (n === 'Wound' ? args[0] * 2 : n === 'len' ? 'MACRO' : undefined),
  });
  assert.equal(run(call('len', [lit([num(1), num(2)])]), macroEnv), 2);
  assert.equal(run(call('Wound', [num(21)]), macroEnv), 42);
  const e = faultOf(call('nope', [num(1)], P));
  assert.match(e.message, /unknown function 'nope'/);
  assert.deepEqual(e.pos, P);
});

test('builtin arity enforcement', () => {
  assert.match(faultOf(call('random', [num(1)])).message, /'random' expects 2 arguments \(got 1\)/);
  assert.match(faultOf(call('len', [])).message, /'len' expects 1 argument \(got 0\)/);
  assert.match(faultOf(call('inv', [num(1)])).message, /'inv' expects 0 arguments \(got 1\)/);
  assert.match(faultOf(call('min', [])).message, /'min' expects at least 1 argument \(got 0\)/);
  assert.match(faultOf(call('visited', [str('a'), str('b')])).message, /'visited' expects 1 argument \(got 2\)/);
});

test('builtin parameter type enforcement', () => {
  assert.match(faultOf(call('upper', [num(5)])).message, /'upper' expects a string argument at position 1 \(got number\)/);
  assert.match(faultOf(call('random', [str('a'), num(2)])).message, /'random' expects a number argument at position 1/);
  assert.match(faultOf(call('pick', [num(5)])).message, /'pick' expects a list argument/);
  assert.match(faultOf(call('visited', [num(3)])).message, /'visited' expects a string argument/);
  assert.equal(faultOf(call('upper', [num(5)], P)).pos.line, 3);
});

test('nested expressions evaluate recursively (list literals, calls, vars)', () => {
  const expr = bin(
    '+',
    str('loot: '),
    call('str', [bin('*', vr('gold'), bin('+', num(0.5), num(0.5)))])
  );
  assert.equal(run(expr), 'loot: 10');
  const nested = ter(
    bin('>', vr('gold'), num(5)),
    call('pick', [vr('row')]),
    call('range', [num(0), num(2)])
  );
  const env = makeEnv({ rng: mulberry32(1) });
  assert.ok([1, 2].includes(run(nested, env)));
});
