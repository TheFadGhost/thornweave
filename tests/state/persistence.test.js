import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveManager, RewindStack, Transcript, SLOT_COUNT } from '../../src/state/persistence.js';
import { createState, serializeState, deserializeState } from '../../src/state/model.js';

function memoryStorage() {
  const map = new Map();
  return {
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => map.set(k, v),
    delete: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}

function fakeState(hash, turn = 1) {
  const st = createState(hash ?? 'h', 5, { varsInit: { gold: { t: 'number', v: 2 } } });
  st.current = 'A';
  st.turn = turn;
  return st;
}

test('save/load round-trips state exactly', () => {
  const sm = new SaveManager(memoryStorage());
  sm.save('1', fakeState('abc'), 'before the bridge');
  const rec = sm.load('1', 'abc');
  assert.equal(rec.label, 'before the bridge');
  assert.equal(rec.state.turn, 1);
  assert.deepEqual(rec.state.vars, { gold: 2 });
});

test('loading with a mismatched story hash rejects cleanly', () => {
  const sm = new SaveManager(memoryStorage());
  sm.save('1', fakeState('abc'));
  assert.throws(() => sm.load('1', 'zzz'), /different version/);
});

test('corrupt slot data raises save-corrupt, not a crash', () => {
  const storage = memoryStorage();
  storage.set('save.1', '{not json');
  const sm = new SaveManager(storage);
  assert.throws(() => sm.load('1'), /corrupt/);
});

test('empty slots read as null and peek reports Empty metadata', () => {
  const sm = new SaveManager(memoryStorage());
  assert.equal(sm.load('3'), null);
  assert.equal(sm.peek('3'), null);
  const slots = sm.slots();
  assert.equal(slots.length, SLOT_COUNT);
  assert.ok(slots.every((s) => s.meta === null));
});

test('autosave slot round-trips through loadAutosave', () => {
  const sm = new SaveManager(memoryStorage());
  sm.autosave(fakeState('k', 7), 'turn 7');
  const rec = sm.loadAutosave('k');
  assert.equal(rec.state.turn, 7);
});

test('rewind stack pops in LIFO order and respects the cap', () => {
  const rs = new RewindStack(3);
  for (let i = 0; i < 5; i++) rs.push(fakeState('h', i), `t${i}`);
  assert.equal(rs.size(), 3);
  const a = rs.pop();
  const b = rs.pop();
  assert.equal(a.note, 't4');
  assert.equal(b.note, 't3');
  assert.equal(rs.pop().note, 't2');
  assert.equal(rs.pop(), null);
});

test('rewind restores exact serialized prior state', () => {
  const st = fakeState('h', 4);
  st.vars.gold = 9;
  const rs = new RewindStack(10);
  rs.push(st, 'snapshot');
  st.vars.gold = 100;
  st.turn = 12;
  const restored = rs.pop().state;
  assert.equal(serializeState(restored), serializeState(deserializeState(serializeState({ ...st, vars: { gold: 9 }, turn: 4 }))));
});

test('transcript renders passages, choices and rewinds as text', () => {
  const t = new Transcript();
  t.passage(1, 'Arrival');
  t.choice(1, 'Take the lane', 'Lane');
  t.passage(2, 'Lane');
  t.rewind(2);
  const txt = t.text('My Story');
  assert.match(txt, /^# My Story/);
  assert.match(txt, /\[turn 1\] --- Arrival ---/);
  assert.match(txt, /\[turn 1\] > Take the lane/);
  assert.match(txt, /stepped back/);
});
