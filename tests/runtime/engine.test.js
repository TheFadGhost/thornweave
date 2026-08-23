import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/compile/index.js';
import { Engine } from '../../src/runtime/engine.js';
import {
  serializeState,
  deserializeState,
  stateHash,
  deepClone,
  stateMatchesStory,
} from '../../src/state/model.js';

function ready(src) {
  const c = compile(src, 't.thorn');
  if (!c.ok) throw new Error('fixture failed to compile: ' + JSON.stringify(c.diagnostics));
  return new Engine(c.story);
}

function allText(render) {
  let out = '';
  for (const b of render.blocks) {
    if (b.type === 'break') out += '\n· · ·\n';
    else out += runsText(b.runs);
  }
  return out;
}
function runsText(runs) {
  return runs.map((r) => (r.t === 'text' ? r.v : r.t === 'link' ? `[[#${r.choice}]]` : `<${r.t}>${runsText(r.runs)}</${r.t}>`)).join('');
}

test('start renders prose, interpolation and choices', () => {
  const eng = ready([
    '---', 'vars:', '  gold: 5', '---',
    '== Gate ==',
    'You have {{gold}} gold.',
    '',
    '* Enter the gate -> Inside',
    '* *Leave* this place -> Road',
    '',
    '== Inside == [ending]',
    'Dark here.',
    '',
    '== Road == [ending]',
    'The road goes ever on.',
  ].join('\n'));
  const st = eng.newGame(7);
  const r = eng.start(st);
  assert.match(allText(r), /You have 5 gold\./);
  assert.equal(r.choices.length, 2);
  assert.equal(r.choices[0].label, 'Enter the gate');
  assert.equal(r.choices[1].label, 'Leave this place');
  const r2 = eng.choose(st, r.choices[0]);
  assert.equal(st.turn, 2);
  assert.ok(r2.ending);
});

test('seeded games replay identically (state hash)', () => {
  const eng = ready([
    '== A ==',
    'Rolled {{random(1,6)}} and picked {{pick(["x","y","z"])}}.',
    '* Again -> A',
    '* Stop -> B',
    '',
    '== B == [ending]',
    'Done.',
  ].join('\n'));
  const play = (seed) => {
    const st = eng.newGame(seed);
    eng.start(st);
    for (let i = 0; i < 25; i++) {
      const r = eng.enter(st, st.current);
      eng.choose(st, r.choices[0]);
    }
    return stateHash(st);
  };
  assert.equal(play(1234), play(1234));
  assert.notEqual(play(1234), play(999));
});

test('once choices consume and read as taken afterwards', () => {
  const eng = ready([
    '== A ==',
    '* (once) Grab the apple -> A',
    '* Wait -> B',
    '',
    '== B == [ending]',
    'Bye.',
  ].join('\n'));
  const st = eng.newGame(1);
  const first = eng.start(st);
  const grab = first.choices.find((c) => c.label === 'Grab the apple');
  const again = eng.choose(st, grab);
  const g2 = again.choices.find((c) => c.label === 'Grab the apple');
  assert.equal(g2.consumed, true);
  assert.equal(g2.disabled, true);
  assert.throws(() => eng.choose(st, g2), /no longer available/);
});

test('hidden bullets are absent when their condition is false, present when true', () => {
  const eng = ready([
    '---', 'vars:', '  hasKey: false', '---',
    '== Door ==',
    '* (if hasKey) Unlock -> Vault',
    '* Knock -> Porch',
    '',
    '== Vault == [ending]', 'x',
    '', '== Porch == [ending]', 'y',
  ].join('\n'));
  const st = eng.newGame(3);
  const r = eng.start(st);
  assert.deepEqual(r.choices.map((c) => c.label), ['Knock']);
  st.vars.hasKey = true;
  const r2 = eng.enter(st, 'Door');
  assert.deepEqual(r2.choices.map((c) => c.label), ['Unlock', 'Knock']);
});

test('timed expiry prefers declared timeout target', () => {
  const eng = ready([
    '== A ==',
    '* (time=5, timeout -> Dusk) Wait -> Still',
    '* Move on -> Path',
    '',
    '== Dusk == [ending]', 'd',
    '', '== Still == [ending]', 's',
    '', '== Path == [ending]', 'p',
  ].join('\n'));
  const st = eng.newGame(1);
  const r = eng.start(st);
  const timed = r.choices.find((c) => c.time > 0);
  assert.equal(timed.timeout, 'Dusk');
  assert.equal(eng.timeoutTarget(timed, r), 'Dusk');
  const eng2 = ready([
    '== A ==',
    '* (time=5) Wait -> Still',
    '* Move on -> Path',
    '',
    '== Still == [ending]', 's',
    '', '== Path == [ending]', 'p',
  ].join('\n'));
  const r2 = eng2.start(eng2.newGame(1));
  const t2 = r2.choices.find((c) => c.time > 0);
  assert.equal(eng2.timeoutTarget(t2, r2), 'Path');
});

test('inventory take/drop and fault on overdraft', () => {
  const eng = ready([
    '== A ==',
    '~ take "coin", 2',
    'Coins: {{count("coin")}}.',
    '* Drop one -> B',
    '* Drop three -> C',
    '',
    '== B == [ending]',
    '~ drop "coin", 1',
    'Left: {{count("coin")}}.',
    '',
    '== C == [ending]',
    '~ drop "coin", 3',
    'never',
  ].join('\n'));
  const st = eng.newGame(1);
  const r = eng.start(st);
  assert.match(allText(r), /Coins: 2\./);
  const rb = eng.choose(st, r.choices[0]);
  assert.equal(st.inv.coin ?? 0, 1);
  assert.match(allText(rb), /Left: 1\./);
  const st2 = eng.newGame(1);
  const r2 = eng.start(st2);
  assert.throws(() => eng.choose(st2, r2.choices[1]), /cannot drop/);
});

test('type mismatches and division by zero are runtime faults with positions', () => {
  const e1 = ready(['== A == [ending]', '~ set n = 1', '~ set n = "x"', 'y'].join('\n'));
  assert.throws(() => e1.start(e1.newGame(1)), /cannot assign/);
  const e2 = ready(['== A == [ending]', 'Result {{5 / 0}}.', 'z'].join('\n'));
  try {
    e2.start(e2.newGame(1));
    assert.fail('expected fault');
  } catch (err) {
    assert.equal(err.fault, 'runtime');
    assert.match(err.message, /division by zero/);
    assert.ok(err.pos && err.pos.line === 2);
  }
});

test('loops repeat text over lists and ranges', () => {
  const eng = ready([
    '== A == [ending]',
    '{{for x in range(1,4)}}Row {{x}}. {{end}}',
    '',
    '{{for name in ["mia", "sol"]}}- {{name}}{{end}}',
  ].join('\n'));
  const r = eng.start(eng.newGame(1));
  const t = allText(r);
  for (const frag of ['Row 1.', 'Row 2.', 'Row 3.', '- mia- sol']) {
    assert.ok(t.includes(frag), `missing ${frag} in ${t}`);
  }
});

test('macro parameters bind and visited() ignores includes', () => {
  const eng = ready([
    '== Wound(n) ==',
    'A wound of level {{n}}.',
    '',
    '== Scene ==',
    '{{Wound(3)}}',
    'Wounds seen: {{visited("Scene")}}.',
    '* end -> Done',
    '',
    '== Done == [ending]',
    'fin',
  ].join('\n'));
  const st = eng.newGame(1);
  const r = eng.start(st);
  const t = allText(r);
  assert.match(t, /A wound of level 3\./);
  assert.match(t, /Wounds seen: 1\./);
  assert.equal(st.visited.Wound, undefined);
});

test('inline links render into prose and register choices', () => {
  const eng = ready([
    '== Cliff ==',
    'The path forks: [[left -> Valley]] or [[right -> Ridge]].',
    '',
    '== Valley == [ending]', 'v',
    '', '== Ridge == [ending]', 'r',
  ].join('\n'));
  const r = eng.start(eng.newGame(1));
  assert.match(allText(r), /forks: \[\[#0\]\] or \[\[#1\]\]\./);
  assert.equal(r.choices.length, 2);
  assert.equal(r.choices[0].origin, 'inline');
});

test('save round-trip preserves exact state and continues identically', () => {
  const eng = ready([
    '---', 'vars:', '  nerve: 3', '---',
    '== Path ==',
    'Nerve {{nerve}}.',
    '~ set nerve = nerve - 1',
    '* Onward -> Path2',
    '',
    '== Path2 ==',
    'End of road. [ending]',
  ].join('\n').replace('[ending].', '. [ending]'));
  const a = eng.newGame(11);
  eng.start(a);
  const before = deepClone(a);
  eng.enter(a, a.current);

  const b = deserializeState(serializeState(a));
  assert.equal(stateHash(a), stateHash(b));
  assert.equal(stateMatchesStory(b, eng.hash), true);

  const rb = eng.enter(b, b.current);
  const rc = eng.enter(a, a.current);
  assert.equal(allText(rb), allText(rc));
  void before;
});

test('rewind restores exact prior state including inventory and flags', () => {
  const eng = ready([
    '== A ==',
    '~ take "lantern"',
    '~ set lit = true',
    '* Go -> B',
    '',
    '== B ==',
    'Dark. [ending]',
  ].join('\n'));
  const st = eng.newGame(2);
  eng.start(st);
  const snapshot = deepClone(st);
  const r = eng.enter(st, st.current);
  eng.choose(st, r.choices[0]);
  assert.notEqual(stateHash(st), stateHash(snapshot));
  const restored = deserializeState(serializeState(snapshot));
  assert.equal(stateHash(restored), stateHash(snapshot));
  assert.equal(restored.inv.lantern, 1);
  assert.equal(restored.vtypes.lit, 'boolean');
});

test('foreign story hashes reject saves cleanly', () => {
  const e1 = ready('== A ==\nx\n\n* go -> Z\n\n== Z == [ending]\nz');
  const e2 = ready('== A ==\ny\n\n* go -> Z\n\n== Z == [ending]\nz');
  const st = e1.newGame(1);
  e1.start(st);
  const loaded = deserializeState(serializeState(st));
  assert.equal(stateMatchesStory(loaded, e2.hash), false);
});
