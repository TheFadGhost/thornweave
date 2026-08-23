import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/compile/index.js';
import { Engine } from '../../src/runtime/engine.js';
import { walkOnce, walkMany } from '../../src/tools/walker.js';

function ready(src) {
  const c = compile(src, 't.thorn');
  if (!c.ok) throw new Error('fixture: ' + JSON.stringify(c.diagnostics));
  return new Engine(c.story);
}

test('walker completes a simple story and reports ending coverage', () => {
  const eng = ready([
    '== A ==',
    '* Go -> B',
    '',
    '== B == [ending]',
    'done',
  ].join('\n'));
  const r = walkOnce(eng, 1);
  assert.equal(r.ok, true);
  assert.equal(r.outcome, 'ending');
  assert.equal(r.ending, 'B');
});

test('dead ends are reported as failures', () => {
  const eng = ready([
    '== A ==',
    '* Go -> B',
    '',
    '== B ==',
    'nothing here',
    '',
    '== C == [ending]',
    'x',
  ].join('\n'));
  const r = walkOnce(eng, 1);
  assert.equal(r.ok, false);
  assert.equal(r.outcome, 'dead-end');
  assert.match(r.message, /no choices/);
});

test('runtime faults are captured with seed and message', () => {
  const eng = ready([
    '== A ==',
    '{{1 / 0}}',
    '* Go -> B',
    '',
    '== B == [ending]',
    'x',
  ].join('\n'));
  const r = walkOnce(eng, 3);
  assert.equal(r.ok, false);
  assert.equal(r.outcome, 'fault');
  assert.match(r.message, /division by zero/);
});

test('walkMany aggregates and detects missed endings', () => {
  const eng = ready([
    '---', 'vars:', '  rich: true', '---',
    '== A ==',
    '{{if rich}}[[Pay -> Rich]]{{else}}[[Beg -> Poor]]{{end}}',
    '',
    '== Rich == [ending]',
    'r',
    '',
    '== Poor == [ending]',
    'p',
  ].join('\n'));
  const rep = walkMany(eng, 20);
  assert.equal(rep.faults.length, 0);
  assert.equal(rep.deadEnds.length, 0);
  assert.ok(rep.endingsReached['Rich'] > 0);
  assert.deepEqual(rep.missedEndings, ['Poor']);
  assert.equal(rep.allEndingsReached, false);
});

test('same seeds produce identical walk results', () => {
  const eng = ready([
    '== A ==',
    '~ set x = random(1, 100)',
    '* Left -> B',
    '* Right -> C',
    '',
    '== B == [ending]', 'b',
    '', '== C == [ending]', 'c',
  ].join('\n'));
  const a = walkOnce(eng, 42);
  const b = walkOnce(eng, 42);
  assert.deepEqual(a.path, b.path);
});
