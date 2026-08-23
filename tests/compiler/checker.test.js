/**
 * @file Compiler semantic-analysis tests: every SPEC §10 diagnostic class
 * implemented by src/compile/checker.js, the DESIGN Part II diagnostic
 * anatomy (exact snapshot strings, no colours), fingerprint stability
 * (positional stripping), and the exported expression walker. All StoryIR
 * fixtures are hand-built literal objects matching src/syntax/ast.js shapes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStory, walkExpr } from '../../src/compile/checker.js';
import { parseStory } from '../../src/syntax/parser.js';
import { formatDiagnostic, toJson, sortDiagnostics } from '../../src/compile/diagnostics.js';
import { storyFingerprint } from '../../src/compile/fingerprint.js';

// ---------------------------------------------------------------------------
// IR builders
// ---------------------------------------------------------------------------

const pos = (line, col) => ({ line, col });
const num = (v) => ({ t: 'num', v });
const str = (v) => ({ t: 'str', v });
const boolV = (v) => ({ t: 'bool', v });
const vr = (name, p) => ({ t: 'var', name, pos: p });
const bin = (op, l, r, p) => ({ t: 'bin', op, l, r, pos: p });
const callE = (name, args, p) => ({ t: 'call', name, args, pos: p });

const txt = (v) => ({ k: 'text', v });
const interp = (expr) => ({ k: 'interp', expr });
const setN = (name, expr, p) => ({ k: 'set', name, expr, pos: p });
const unsetN = (name, p) => ({ k: 'unset', name, pos: p });
const pushN = (name, expr, p) => ({ k: 'push', name, expr, pos: p });
const incN = (target, p) => ({ k: 'include', target, args: null, pos: p });
const ifN = (branches, elseNodes = []) => ({ k: 'if', branches, elseNodes });
const forN = (varName, iter, nodes = []) => ({ k: 'for', varName, iter, nodes });

const passage = (name, { tags = [], params = [], nodes = [], line = 1, links = [] } = {}) =>
  ({ name, tags, params, nodes, line, links, words: 0 });

const mkLink = (target, line, col, attrs = {}) =>
  ({ target, attrs: { once: false, time: 0, timeout: null, ...attrs }, line, col, id: `${target}@${line}` });

function storyOf(passages, { meta = {}, varsInit = {}, order = null, metaUnknown } = {}) {
  const map = {};
  for (const p of passages) map[p.name] = p;
  const story = {
    formatVersion: 1,
    meta: { title: '', author: '', description: '', start: '', show: [], seed: null, ...meta },
    varsInit,
    passages: map,
    order: order ?? passages.map((p) => p.name),
  };
  if (metaUnknown) story.meta.metaUnknown = metaUnknown;
  return story;
}

const codesOf = (ds, code) => ds.filter((d) => d.code === code);
function oneOf(ds, code) {
  const hits = codesOf(ds, code);
  assert.ok(hits.length >= 1, `expected a ${code}, got ${JSON.stringify(ds.map((d) => d.code))}`);
  return hits[0];
}

/** Source text whose content sits exactly on the given 1-based line. */
const srcAt = (line, text) =>
  [...Array(line - 1).fill(''), text].join('\n');

// ---------------------------------------------------------------------------
// walkExpr
// ---------------------------------------------------------------------------

test('walkExpr visits every node pre-order', () => {
  const expr = bin('*', bin('+', vr('a', pos(1, 1)), num(1), pos(1, 2)), vr('b', pos(1, 8)), pos(1, 4));
  const seen = [];
  walkExpr(expr, (n) => seen.push(n.t));
  assert.deepEqual(seen, ['bin', 'bin', 'var', 'num', 'var']);
});

// ---------------------------------------------------------------------------
// Diagnostic anatomy (DESIGN Part II) — exact snapshots
// ---------------------------------------------------------------------------

test('formatDiagnostic matches the DESIGN anatomy exactly (error, wide caret)', () => {
  const d = {
    severity: 'error',
    code: 'TW001',
    message: "link points to passage 'Staire', which does not exist",
    file: 'stories/lantern.thorn',
    line: 14,
    col: 3,
    endCol: 19,
    help: "'Staire' is not defined. Did you mean 'Stair' (line 20)?",
  };
  const got = formatDiagnostic(d, { sourceText: srcAt(14, '[[Climb the stair -> Staire]]') });
  assert.equal(got, [
    "error[TW001]: link points to passage 'Staire', which does not exist",
    '  --> stories/lantern.thorn:14:3',
    '   |',
    '14 | [[Climb the stair -> Staire]]',
    '   |   ^^^^^^^^^^^^^^^^',
    '   |',
    "help = 'Staire' is not defined. Did you mean 'Stair' (line 20)?",
  ].join('\n'));
});

test('formatDiagnostic widens the gutter for multi-digit lines (note)', () => {
  const d = {
    severity: 'note',
    code: 'TW019',
    message: 'for-loop bound 20000 exceeds the 10000-iteration runtime guard',
    file: 'story.thorn',
    line: 123,
    col: 10,
    help: 'loops beyond 10000 iterations raise a runtime story fault; shrink the bound',
  };
  const got = formatDiagnostic(d, { sourceText: srcAt(123, '{{for i in 20000}}') });
  assert.equal(got, [
    'note[TW019]: for-loop bound 20000 exceeds the 10000-iteration runtime guard',
    '  --> story.thorn:123:10',
    '    |',
    '123 | {{for i in 20000}}',
    '    |          ^',
    '    |',
    'help = loops beyond 10000 iterations raise a runtime story fault; shrink the bound',
  ].join('\n'));
});

test('formatDiagnostic defaults to one caret at the column (warning)', () => {
  const help = "add a choice or link, or tag the passage '[ending]' if it ends the story";
  const d = {
    severity: 'warning',
    code: 'TW014',
    message: "passage 'Cellar' is a dead end (no outgoing choices)",
    file: 'story.thorn',
    line: 7,
    col: 1,
    help,
  };
  const got = formatDiagnostic(d, { sourceText: srcAt(7, '== Cellar ==') });
  assert.equal(got, [
    "warning[TW014]: passage 'Cellar' is a dead end (no outgoing choices)",
    '  --> story.thorn:7:1',
    '  |',
    '7 | == Cellar ==',
    '  | ^',
    '  |',
    `help = ${help}`,
  ].join('\n'));
});

test('formatDiagnostic omits help when absent and tolerates missing source', () => {
  const d = { severity: 'error', code: 'TW020', message: 'bad syntax', file: 's.thorn', line: 2, col: 5 };
  assert.equal(formatDiagnostic(d), [
    'error[TW020]: bad syntax',
    '  --> s.thorn:2:5',
    '  |',
    '2 | ',
    '  |     ^',
    '  |',
  ].join('\n'));
});

test('colors=true adds severity/help/path ANSI only on request', () => {
  const E = String.fromCharCode(27);
  const d = { severity: 'error', code: 'TW001', message: 'm', file: 'a.thorn', line: 1, col: 1, help: 'h' };
  assert.ok(!formatDiagnostic(d).includes(E));
  const colored = formatDiagnostic(d, { colors: true });
  assert.ok(colored.startsWith(`${E}[31merror${E}[0m[TW001]`));
  assert.ok(colored.includes(`${E}[4ma.thorn${E}[0m:1:1`));
  assert.ok(colored.includes(`${E}[36mhelp = h${E}[0m`));
  assert.ok(formatDiagnostic({ ...d, severity: 'warning' }, { colors: true }).includes(`${E}[33mwarning${E}[0m`));
  assert.ok(formatDiagnostic({ ...d, severity: 'note' }, { colors: true }).includes(`${E}[2mnote${E}[0m`));
});

test('toJson emits stable key order with optional fields last', () => {
  const base = toJson({ severity: 'warning', code: 'TW005', message: 'm', file: 'f', line: 2, col: 3 });
  assert.deepEqual(base, { severity: 'warning', code: 'TW005', message: 'm', file: 'f', line: 2, col: 3 });
  assert.deepEqual(Object.keys(base), ['severity', 'code', 'message', 'file', 'line', 'col']);
  const full = toJson({ severity: 'error', code: 'TW001', message: 'm', file: 'f', line: 2, col: 3, endCol: 9, help: 'h' });
  assert.deepEqual(Object.keys(full), ['severity', 'code', 'message', 'file', 'line', 'col', 'endCol', 'help']);
});

test('sortDiagnostics orders by file, line, col, code without mutating input', () => {
  const input = [
    { severity: 'error', code: 'TW002', message: '', file: 'b.thorn', line: 1, col: 1 },
    { severity: 'error', code: 'TW001', message: '', file: 'a.thorn', line: 2, col: 1 },
    { severity: 'error', code: 'TW010', message: '', file: 'a.thorn', line: 1, col: 5 },
    { severity: 'error', code: 'TW001', message: '', file: 'a.thorn', line: 1, col: 5 },
  ];
  const sorted = sortDiagnostics(input);
  assert.deepEqual(sorted.map((d) => d.code), ['TW001', 'TW010', 'TW001', 'TW002']);
  assert.equal(input[0].code, 'TW002');
});

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

function richStory() {
  return {
    formatVersion: 1,
    meta: { title: 'T', author: '', description: '', start: 'A', show: [], seed: 1 },
    varsInit: { gold: { t: 'number', v: 3 } },
    passages: {
      A: {
        name: 'A', tags: [], params: [], line: 3,
        nodes: [
          setN('gold', num(4), pos(4, 1)),
          interp(vr('gold', pos(5, 3))),
          { k: 'choice', id: 'A#0', display: [txt('go')], target: 'B',
            attrs: { once: false, time: 0, timeout: null, ifExpr: vr('gold', pos(6, 9)) },
            pos: pos(6, 1) },
        ],
        links: [{ target: 'B', attrs: { once: false, time: 0, timeout: null }, line: 6, col: 1, id: 'A#0' }],
        words: 12,
      },
      B: { name: 'B', tags: ['ending'], params: [], line: 8, nodes: [txt('end')], links: [], words: 3 },
    },
    order: ['A', 'B'],
  };
}

test('fingerprint ignores all positional metadata and word counts', () => {
  const a = richStory();
  const b = JSON.parse(JSON.stringify(richStory()));
  b.passages.A.line = 99;
  b.passages.B.line = 77;
  b.passages.A.nodes[0].pos = { line: 44, col: 44 };
  b.passages.A.nodes[1].expr.pos = { line: 55, col: 55 };
  b.passages.A.nodes[2].pos = { line: 11, col: 22 };
  b.passages.A.nodes[2].attrs.ifExpr.pos = { line: 12, col: 34 };
  b.passages.A.links[0].line = 66;
  b.passages.A.links[0].col = 88;
  b.passages.A.words = 999;
  b.passages.B.words = 1000;
  assert.equal(storyFingerprint(a), storyFingerprint(b));
  assert.match(storyFingerprint(a), /^[0-9a-f]{40}$/);
});

test('fingerprint is independent of object key insertion order', () => {
  const s = richStory();
  const reordered = {
    order: s.order,
    passages: { B: s.passages.B, A: s.passages.A },
    varsInit: s.varsInit,
    meta: s.meta,
    formatVersion: s.formatVersion,
  };
  assert.equal(storyFingerprint(s), storyFingerprint(reordered));
});

test('fingerprint changes when content changes', () => {
  const a = richStory();
  const b = JSON.parse(JSON.stringify(a));
  b.passages.B.nodes[0].v = 'fin';
  assert.notEqual(storyFingerprint(a), storyFingerprint(b));
  const c = JSON.parse(JSON.stringify(a));
  c.order = ['B', 'A'];
  c.passages.A.links[0].id = 'A#1';
  assert.notEqual(storyFingerprint(a), storyFingerprint(c));
});

// ---------------------------------------------------------------------------
// TW001 / TW002 — link targets
// ---------------------------------------------------------------------------

test('TW001 error for unknown target with nearest-name suggestion', () => {
  const st = storyOf([
    passage('Road', { links: [mkLink('Staire', 14, 3)] }),
    passage('Stair', { line: 20 }),
  ], { meta: { start: 'Road' } });
  const ds = checkStory(st, '', 't.thorn');
  const d = oneOf(ds, 'TW001');
  assert.equal(d.severity, 'error');
  assert.ok(d.message.includes("'Staire'"));
  assert.ok(d.help.includes("Did you mean 'Stair' (line 20)?"));
  assert.equal(d.line, 14);
  assert.equal(d.col, 3);
  assert.equal(d.endCol, 9); // caret spans the target text 'Staire'
});

test('TW001 without suggestion when nothing is close', () => {
  const st = storyOf([passage('Road', { links: [mkLink('Zzzqqq', 2, 1)] })], { meta: { start: 'Road' } });
  const d = oneOf(checkStory(st, ''), 'TW001');
  assert.ok(d.help.includes("'Zzzqqq' is not defined"));
  assert.ok(!d.help.includes('Did you mean'));
});

test('TW001 also covers missing timeout targets', () => {
  const st = storyOf([
    passage('Hold', { links: [mkLink('Hold', 2, 1, { time: 5, timeout: 'Nowhere' })] }),
  ], { meta: { start: 'Hold' } });
  const d = oneOf(checkStory(st, ''), 'TW001');
  assert.ok(d.message.includes('(timeout target)'));
});

test('TW002 error for case-only difference suggests the exact name', () => {
  const st = storyOf([
    passage('Road', { links: [mkLink('stair', 2, 5)] }),
    passage('Stair', { line: 6 }),
  ], { meta: { start: 'Road' } });
  const ds = checkStory(st, '');
  const d = oneOf(ds, 'TW002');
  assert.equal(d.severity, 'error');
  assert.ok(d.message.includes('differs only by case'));
  assert.ok(d.help.includes("use 'Stair'"));
  assert.equal(codesOf(ds, 'TW001').length, 0);
});

// ---------------------------------------------------------------------------
// TW003 / TW004 — reachability
// ---------------------------------------------------------------------------

test('reachability fixture: orphan gets TW003, unreachable ending gets TW004', () => {
  const st = storyOf([
    passage('s', { links: [mkLink('a', 2, 1)] }),
    passage('a', { line: 3, links: [mkLink('b', 4, 1)] }),
    passage('b', { line: 5 }),
    passage('c', { line: 6 }),
    passage('fin', { line: 7, tags: ['ending'] }),
  ], { meta: { start: 's' } });
  const ds = checkStory(st, '');
  const tw3 = codesOf(ds, 'TW003');
  assert.equal(tw3.length, 1);
  assert.equal(tw3[0].severity, 'warning');
  assert.ok(tw3[0].message.includes("'c'"));
  assert.equal(tw3[0].line, 6);
  const tw4 = oneOf(ds, 'TW004');
  assert.equal(tw4.severity, 'note');
  assert.ok(tw4.message.includes("'fin'"));
  assert.equal(tw4.line, 7);
  assert.equal(codesOf(ds, 'TW003').filter((d) => d.message.includes("'fin'")).length, 0);
});

test('include edges extend reachability (spliced passages are not TW003)', () => {
  const st = storyOf([
    passage('Gate', { nodes: [incN('LadderNote', pos(3, 3))], links: [] }),
    passage('LadderNote', { line: 5 }),
  ], { meta: { start: 'Gate' } });
  const ds = checkStory(st, '');
  assert.equal(codesOf(ds, 'TW003').length, 0);
});

test('parameterised passages are exempt from unreachability and dead-end checks', () => {
  const st = storyOf([
    passage('S', { links: [mkLink('End', 2, 1)] }),
    passage('Wound', { line: 4, params: ['level'] }),
    passage('End', { line: 5, tags: ['ending'] }),
  ], { meta: { start: 'S' } });
  const ds = checkStory(st, '');
  assert.equal(codesOf(ds, 'TW003').length, 0);
  assert.equal(codesOf(ds, 'TW004').length, 0);
  assert.equal(codesOf(ds, 'TW014').filter((d) => d.message.includes("'Wound'")).length, 0);
});

// ---------------------------------------------------------------------------
// TW005 — read before set
// ---------------------------------------------------------------------------

test('TW005 when a variable is read with no assignment anywhere', () => {
  const st = storyOf([
    passage('P', { line: 2, nodes: [interp(vr('gold', pos(3, 9)))] }),
  ], { meta: { start: 'P' } });
  const d = oneOf(checkStory(st, ''), 'TW005');
  assert.equal(d.severity, 'warning');
  assert.ok(d.message.includes("'gold'"));
  assert.equal(d.line, 3);
  assert.equal(d.col, 9);
  assert.equal(d.endCol, 13);
  assert.ok(d.help.includes('never assigned'));
  assert.ok(d.help.includes("'vars:'") || d.help.includes('~set'));
});

test('TW005 suppressed when the variable is in frontmatter varsInit', () => {
  const st = storyOf([
    passage('P', { line: 2, nodes: [interp(vr('gold', pos(3, 9)))] }),
  ], { meta: { start: 'P' }, varsInit: { gold: { t: 'number', v: 0 } } });
  assert.equal(codesOf(checkStory(st, ''), 'TW005').length, 0);
});

test('TW005 after a straight-line set does not fire', () => {
  const st = storyOf([
    passage('P', { line: 2, nodes: [setN('y', num(1), pos(3, 1)), interp(vr('y', pos(4, 10)))] }),
  ], { meta: { start: 'P' } });
  assert.equal(codesOf(checkStory(st, ''), 'TW005').length, 0);
});

test('TW005 branch merge uses intersection of definite sets', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      nodes: [
        ifN([{ cond: boolV(true), nodes: [setN('x', num(1), pos(4, 3))] }]),
        interp(vr('x', pos(6, 10))),
      ],
    }),
  ], { meta: { start: 'P' } });
  const d = oneOf(checkStory(st, ''), 'TW005');
  assert.ok(d.message.includes("'x'"));
});

test('TW005 unset re-opens a variable and reports once per variable per passage', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      nodes: [
        setN('lamp', num(1), pos(3, 1)),
        unsetN('lamp', pos(4, 1)),
        interp(vr('lamp', pos(5, 9))),
        interp(vr('lamp', pos(6, 9))),
      ],
    }),
  ], { meta: { start: 'P' }, varsInit: { lamp: { t: 'number', v: 1 } } });
  const hits = codesOf(checkStory(st, ''), 'TW005');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 5);
});

// ---------------------------------------------------------------------------
// TW006 — static type mismatches
// ---------------------------------------------------------------------------

test('TW006 assigning a literal string to a known number variable', () => {
  const st = storyOf([
    passage('P', { line: 2, nodes: [setN('n', str('x'), pos(5, 1))] }),
  ], { meta: { start: 'P' }, varsInit: { n: { t: 'number', v: 1 } } });
  const d = oneOf(checkStory(st, ''), 'TW006');
  assert.equal(d.severity, 'error');
  assert.ok(d.message.includes("'n' of type number"));
  assert.equal(d.line, 5);
});

test('TW006 propagates literal types through straight-line set chains', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      nodes: [setN('m', num(1), pos(3, 1)), setN('m', str('s'), pos(4, 1))],
    }),
  ], { meta: { start: 'P' } });
  const d = oneOf(checkStory(st, ''), 'TW006');
  assert.ok(d.message.includes("assign a string value to variable 'm' of type number"));
});

test('TW006 branch-local assignment does not poison the pre-branch type', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      varsInit: { x: { t: 'number', v: 1 } },
      nodes: [
        ifN([{ cond: boolV(true), nodes: [setN('x', str('s'), pos(4, 3))] }]),
        setN('x', num(2), pos(6, 1)),
      ],
    }),
  ], { meta: { start: 'P' }, varsInit: { x: { t: 'number', v: 1 } } });
  const ds = checkStory(st, '');
  assert.equal(codesOf(ds, 'TW006').filter((d) => d.line === 6).length, 0);
});

test('TW006 operator misuse on two literals: "a" * 2 and [1] - [1]', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      nodes: [
        interp(bin('*', str('a'), num(2), pos(4, 7))),
        interp(bin('-', { t: 'list', items: [num(1)] }, { t: 'list', items: [num(1)] }, pos(5, 7))),
      ],
    }),
  ], { meta: { start: 'P' } });
  const hits = codesOf(checkStory(st, ''), 'TW006');
  assert.equal(hits.length, 2);
  assert.ok(hits[0].message.includes("operator '*' requires numbers (got string, number)"));
  assert.ok(hits[1].message.includes('(got list, list)'));
});

test('TW006 allows string concatenation and cross-type equality', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      nodes: [
        interp(bin('+', str('a'), num(2), pos(3, 7))),
        interp(bin('+', num(2), str('a'), pos(4, 7))),
        interp(bin('+', str('a'), { t: 'list', items: [num(1)] }, pos(5, 7))),
        interp(bin('==', str('a'), num(2), pos(6, 7))),
      ],
    }),
  ], { meta: { start: 'P' } });
  assert.equal(codesOf(checkStory(st, ''), 'TW006').length, 0);
});

test('TW006 flags list + number addition (SPEC §5.3 fault)', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      nodes: [interp(bin('+', { t: 'list', items: [] }, num(2), pos(3, 7)))],
    }),
  ], { meta: { start: 'P' } });
  const d = oneOf(checkStory(st, ''), 'TW006');
  assert.ok(d.message.includes("operator '+' cannot combine list and number"));
});

test('TW006 relational mixing numbers and strings is an error', () => {
  const st = storyOf([
    passage('P', { line: 2, nodes: [interp(bin('<', num(1), str('a'), pos(3, 7)))] }),
  ], { meta: { start: 'P' } });
  const d = oneOf(checkStory(st, ''), 'TW006');
  assert.ok(d.message.includes("relational '<' needs two numbers or two strings (got number, string)"));
});

test('TW006 pushing onto a non-list variable', () => {
  const st = storyOf([
    passage('P', { line: 2, nodes: [pushN('row', str('bruised'), pos(3, 1))] }),
  ], { meta: { start: 'P' }, varsInit: { row: { t: 'number', v: 2 } } });
  const d = oneOf(checkStory(st, ''), 'TW006');
  assert.ok(d.message.includes("push to variable 'row' of type number"));
});

// ---------------------------------------------------------------------------
// TW007 / TW008 — calls
// ---------------------------------------------------------------------------

test('TW007 unknown function', () => {
  const st = storyOf([
    passage('P', { line: 2, nodes: [interp(callE('foo', [], pos(3, 5)))] }),
  ], { meta: { start: 'P' } });
  const d = oneOf(checkStory(st, ''), 'TW007');
  assert.equal(d.severity, 'error');
  assert.ok(d.message.includes("unknown function 'foo'"));
  assert.equal(d.col, 5);
  assert.equal(d.endCol, 8);
});

test('TW007 bare call to a zero-parameter passage name', () => {
  const st = storyOf([
    passage('P', { line: 2, nodes: [interp(callE('Notes', [], pos(4, 5)))] }),
    passage('Notes', { line: 6 }),
  ], { meta: { start: 'P' } });
  const d = oneOf(checkStory(st, ''), 'TW007');
  assert.ok(d.message.includes("passage 'Notes' takes no parameters"));
  assert.ok(d.help.includes('{{include Notes}}'));
});

test('TW008 wrong builtin arity (fixed and variadic)', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      nodes: [
        interp(callE('random', [num(1)], pos(3, 5))),
        interp(callE('inv', [num(1)], pos(4, 5))),
        interp(callE('min', [], pos(5, 5))),
      ],
    }),
  ], { meta: { start: 'P' } });
  const hits = codesOf(checkStory(st, ''), 'TW008');
  assert.equal(hits.length, 3);
  assert.ok(hits[0].message.includes("'random' expects 2 arguments, got 1"));
  assert.ok(hits[1].message.includes("'inv' expects 0 arguments, got 1"));
  assert.ok(hits[2].message.includes("'min' expects at least 1 argument, got 0"));
});

test('TW008 provably wrong argument type for a builtin (upper(1))', () => {
  const st = storyOf([
    passage('P', { line: 2, nodes: [interp(callE('upper', [num(1)], pos(3, 5)))] }),
  ], { meta: { start: 'P' } });
  const d = oneOf(checkStory(st, ''), 'TW008');
  assert.ok(d.message.includes("'upper' expects argument 1 to be a string, got number"));
});

test('TW008 accepts valid builtin calls including any-typed params', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      nodes: [
        interp(callE('len', [str('abc')], pos(3, 5))),
        interp(callE('min', [num(1), num(2), num(3)], pos(4, 5))),
        interp(callE('visited', [str('Road')], pos(5, 5))),
      ],
    }),
  ], { meta: { start: 'P' } });
  assert.equal(codesOf(checkStory(st, ''), 'TW008').length, 0);
});

test('TW008 macro called with the wrong argument count', () => {
  const st = storyOf([
    passage('P', { line: 2, nodes: [interp(callE('Wound', [num(1)], pos(4, 5)))] }),
    passage('Wound', { line: 6, params: ['level', 'who'] }),
  ], { meta: { start: 'P' } });
  const d = oneOf(checkStory(st, ''), 'TW008');
  assert.ok(d.message.includes("macro 'Wound' expects 2 arguments, got 1"));
  assert.equal(codesOf(checkStory(st, ''), 'TW007').length, 0);
});

// ---------------------------------------------------------------------------
// TW010 / TW013 / TW009 / TW016
// ---------------------------------------------------------------------------

test('TW010 when the story has no passages at all', () => {
  const st = storyOf([]);
  const ds = checkStory(st, '');
  const d = oneOf(ds, 'TW010');
  assert.equal(d.severity, 'error');
});

test('TW010 when frontmatter start names a missing passage but a default exists', () => {
  const st = storyOf([passage('Orphan', { line: 2 })]);
  st.meta.start = 'Ghost';
  const ds = checkStory(st, '');
  const d = oneOf(ds, 'TW010');
  assert.equal(d.severity, 'error');
  assert.ok(d.message.includes("'Ghost' does not exist"));
});

test('TW010 when start names a missing passage', () => {
  const st = storyOf([passage('Real', { line: 2 })], { meta: { start: 'Nowhere' } });
  const d = oneOf(checkStory(st, ''), 'TW010');
  assert.ok(d.message.includes("start passage 'Nowhere' does not exist"));
});

test('TW013 error for an empty passage name', () => {
  const st = storyOf([passage('', { line: 5 }), passage('Real', { line: 6 })],
    { order: ['', 'Real'] });
  const d = oneOf(checkStory(st, ''), 'TW013');
  assert.equal(d.severity, 'error');
  assert.ok(d.message.includes('empty name'));
  assert.equal(d.line, 5);
  assert.equal(d.col, 4);
});

test('TW009 duplicate passage names detected via source order', () => {
  const st = storyOf([passage('Road', { line: 1 })],
    { order: ['Road', 'Road'], meta: { start: 'Road' } });
  const d = oneOf(checkStory(st, ''), 'TW009');
  assert.equal(d.severity, 'error');
  assert.ok(d.message.includes("duplicate passage name 'Road'"));
});

test('TW016 fires through the real parse pipeline, not just hand-built IR', () => {
  const { story } = parseStory('---\ntitle: t\nmystery: 1\n---\n== P ==\nx', 'pipe.thorn');
  const hits = codesOf(checkStory(story, 'pipe.thorn'), 'TW016');
  assert.equal(hits.length, 1);
  assert.ok(hits[0].message.includes("'mystery'"));
});

// ---------------------------------------------------------------------------
// TW011 — include recursion
// ---------------------------------------------------------------------------

test('TW011 self-include cycle', () => {
  const st = storyOf([
    passage('A', { line: 1, nodes: [incN('A', pos(2, 5))] }),
  ], { meta: { start: 'A' } });
  const d = oneOf(checkStory(st, ''), 'TW011');
  assert.equal(d.severity, 'error');
  assert.ok(d.message.includes('unbreakable include recursion'));
  assert.ok(d.message.includes('A -> A'));
  assert.equal(d.line, 2);
});

test('TW011 two-passage include cycle names the full path', () => {
  const st = storyOf([
    passage('a', { line: 1, nodes: [incN('b', pos(2, 3))] }),
    passage('b', { line: 4, nodes: [incN('a', pos(5, 3))] }),
  ], { meta: { start: 'a' } });
  const ds = checkStory(st, '');
  assert.equal(codesOf(ds, 'TW011').length, 1);
  const d = oneOf(ds, 'TW011');
  assert.ok(d.message.includes('a -> b -> a'));
});

test('TW011 counts macro calls as include-graph edges', () => {
  const st = storyOf([
    passage('P', { line: 1, nodes: [interp(callE('M', [num(1)], pos(2, 9)))] }),
    passage('M', { line: 4, params: ['n'], nodes: [interp(callE('P2', [str('s')], pos(5, 9)))] }),
    passage('P2', { line: 7, params: ['x'], nodes: [interp(callE('M', [num(2)], pos(8, 9)))] }),
  ], { meta: { start: 'P' } });
  const ds = checkStory(st, '');
  assert.equal(codesOf(ds, 'TW011').length, 1);
  const d = oneOf(ds, 'TW011');
  assert.ok(d.message.includes('unbreakable include recursion'));
  assert.ok(d.message.includes('M -> P2 -> M'));
});

// ---------------------------------------------------------------------------
// TW014 / TW015 — dead ends and timed choices
// ---------------------------------------------------------------------------

test('TW014 dead-end warning suppressed by the ending tag', () => {
  const st = storyOf([
    passage('S', { links: [mkLink('Cellar', 2, 1)] }),
    passage('Cellar', { line: 7 }),
    passage('Fin', { line: 9, tags: ['ending'], links: [] }),
  ], { meta: { start: 'S' } });
  const ds = checkStory(st, '');
  const d = oneOf(ds, 'TW014');
  assert.equal(d.severity, 'warning');
  assert.ok(d.message.includes("'Cellar' is a dead end"));
  assert.equal(d.line, 7);
  assert.equal(codesOf(ds, 'TW014').filter((x) => x.message.includes("'Fin'")).length, 0);
});

test('TW015 warning when a timed choice has no timeout and no untimed sibling', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      links: [
        mkLink('X', 3, 1, { time: 5 }),
        mkLink('Y', 4, 1, { time: 6, timeout: 'Z' }),
      ],
    }),
    passage('X', { line: 6, tags: ['ending'] }),
    passage('Y', { line: 7, tags: ['ending'] }),
    passage('Z', { line: 8, tags: ['ending'] }),
  ], { meta: { start: 'P' } });
  const hits = codesOf(checkStory(st, ''), 'TW015');
  assert.equal(hits.filter((d) => d.severity === 'warning').length, 1);
  const w = hits.find((d) => d.severity === 'warning');
  assert.ok(w.message.includes("timed choice 'X'"));
  assert.ok(w.message.includes('no untimed sibling'));
  assert.ok(w.help.includes('timeout -> Passage'));
});

test('TW015 no warning when an untimed sibling exists', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      links: [mkLink('X', 3, 1, { time: 5 }), mkLink('Y', 4, 1)],
    }),
    passage('X', { line: 6, tags: ['ending'] }),
    passage('Y', { line: 7, tags: ['ending'] }),
  ], { meta: { start: 'P' } });
  assert.equal(codesOf(checkStory(st, ''), 'TW015').length, 0);
});

test('TW015 errors for out-of-range time and timeout without time', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      links: [mkLink('X', 3, 1, { time: 200 }), mkLink('Y', 4, 1, { timeout: 'X' })],
    }),
    passage('X', { line: 6, tags: ['ending'] }),
    passage('Y', { line: 7, tags: ['ending'] }),
  ], { meta: { start: 'P' } });
  const hits = codesOf(checkStory(st, ''), 'TW015');
  const errs = hits.filter((d) => d.severity === 'error');
  assert.equal(errs.length, 2);
  assert.ok(errs[0].message.includes("'time=200' must be between 1 and 120"));
  assert.ok(errs[1].message.includes("'timeout' requires 'time=N'"));
});

// ---------------------------------------------------------------------------
// TW017 / TW019 — style lint and loop bounds
// ---------------------------------------------------------------------------

test('TW017 fires only when at least 60% of passages match the convention', () => {
  const st = storyOf([
    passage('Alpha'), passage('Beta', { line: 2 }), passage('Gamma', { line: 3 }),
    passage('Bad Name!', { line: 4 }),
  ], { meta: { start: 'Alpha' } });
  const d = oneOf(checkStory(st, ''), 'TW017');
  assert.equal(d.severity, 'note');
  assert.ok(d.message.includes("passage name 'Bad Name!'"));
  assert.equal(d.line, 4);
});

test('TW017 stays silent when fewer than 60% of passages conform', () => {
  const st = storyOf([
    passage('Bad Name!', { line: 1 }), passage('Worse$Name', { line: 2 }), passage('Ok', { line: 3 }),
  ], { meta: { start: 'Ok' } });
  assert.equal(codesOf(checkStory(st, ''), 'TW017').length, 0);
});

test('TW019 numeric literal bound above the loop cap', () => {
  const st = storyOf([
    passage('P', { line: 2, nodes: [forN('i', num(20000))] }),
  ], { meta: { start: 'P' } });
  const d = oneOf(checkStory(st, ''), 'TW019');
  assert.equal(d.severity, 'note');
  assert.ok(d.message.includes('for-loop bound 20000'));
  assert.ok(d.message.includes('10000-iteration runtime guard'));
});

test('TW019 range() span above the cap anchors at the call position', () => {
  const st = storyOf([
    passage('P', { line: 2, nodes: [forN('i', callE('range', [num(1), num(20001)], pos(3, 7)))] }),
  ], { meta: { start: 'P' } });
  const d = oneOf(checkStory(st, ''), 'TW019');
  assert.ok(d.message.includes('range(1, 20001) spans 20000 iterations'));
  assert.equal(d.line, 3);
  assert.equal(d.col, 7);
});

test('TW019 silent for bounds inside the cap', () => {
  const st = storyOf([
    passage('P', {
      line: 2,
      nodes: [forN('i', num(9999)), forN('j', callE('range', [num(1), num(101)], pos(3, 7)))],
    }),
  ], { meta: { start: 'P' } });
  assert.equal(codesOf(checkStory(st, ''), 'TW019').length, 0);
});

// ---------------------------------------------------------------------------
// Integration: sorted output over a mixed story
// ---------------------------------------------------------------------------

test('checkStory returns diagnostics sorted by file/line/col/code', () => {
  const st = storyOf([
    passage('Road', { links: [mkLink('Staire', 14, 3), mkLink('Vault', 15, 1)] }),
    passage('Stair', { line: 20 }),
    passage('Vault', { line: 21, tags: ['ending'], links: [mkLink('Stair', 21, 40)] }),
    passage('Orphan', { line: 22 }),
  ], { meta: { start: 'Road' } });
  const ds = checkStory(st, '', 'mixed.thorn');
  assert.equal(ds.every((d) => d.file === 'mixed.thorn'), true);
  for (let i = 1; i < ds.length; i++) {
    const a = ds[i - 1];
    const b = ds[i];
    const ok = a.line < b.line || (a.line === b.line && a.col <= b.col);
    assert.ok(ok, `unsorted at ${i}: ${JSON.stringify([a, b])}`);
  }
  assert.ok(codesOf(ds, 'TW001').some((d) => d.message.includes("'Staire'")));
  assert.equal(codesOf(ds, 'TW003').length, 1);
  assert.ok(codesOf(ds, 'TW003')[0].message.includes("'Orphan'"));
  assert.equal(codesOf(ds, 'TW004').length, 0); // Stair reachable via Vault; Vault tagged ending
});



