/**
 * @file Persistence (SPEC §8, PLAN feature 4): pluggable save slots,
 * bounded rewind stack with spoiler-free undo semantics.
 */
import { serializeState, deserializeState, stateMatchesStory, fault } from './model.js';

export const REWIND_CAP = 50;
export const SLOT_COUNT = 6;

/**
 * Storage backend interface: { get(key) -> string|null, set(key, val), delete(key), keys() -> string[] }.
 * The Node adapter lives in storage.node.js; the player passes a
 * localStorage-backed adapter with the same four methods.
 */

export class SaveManager {
  constructor(storage) {
    this.storage = storage;
  }

  save(slot, state, label) {
    const rec = {
      when: new Date().toISOString(),
      label: String(label ?? '').slice(0, 200),
      state: JSON.parse(serializeState(state)),
    };
    this.storage.set(`save.${slot}`, JSON.stringify(rec));
  }

  load(slot, expectedStoryHash) {
    const raw = this.storage.get(`save.${slot}`);
    if (!raw) return null;
    let rec;
    try {
      rec = JSON.parse(raw);
    } catch {
      throw fault('save-corrupt', `slot '${slot}' is corrupt`);
    }
    if (!rec || typeof rec !== 'object' || !rec.state) {
      throw fault('save-corrupt', `slot '${slot}' is missing its state payload`);
    }
    let st;
    try {
      st = deserializeState(JSON.stringify(rec.state));
    } catch (e) {
      if (e?.fault === 'save-corrupt' || e?.fault === 'save-version') {
        throw fault(e.fault, `slot '${slot}': ${e.message}`);
      }
      throw e;
    }
    if (!stateMatchesStory(st, expectedStoryHash ?? st.storyHash)) {
      throw fault('story-mismatch', 'this save belongs to a different version of the story');
    }
    return { when: rec.when, label: rec.label ?? '', state: st };
  }

  peek(slot) {
    const raw = this.storage.get(`save.${slot}`);
    if (!raw) return null;
    try {
      const rec = JSON.parse(raw);
      return { when: rec.when, label: rec.label ?? '' };
    } catch {
      return { when: '?', label: '(corrupt)' };
    }
  }

  slots() {
    const out = [];
    for (let i = 1; i <= SLOT_COUNT; i++) out.push({ slot: String(i), meta: this.peek(String(i)) });
    return out;
  }

  autosave(state, label) {
    this.save('autosave', state, label);
  }

  loadAutosave(expectedStoryHash) {
    return this.load('autosave', expectedStoryHash);
  }
}

/** Bounded rewind stack; entries are pre-choice snapshots. */
export class RewindStack {
  constructor(cap = REWIND_CAP) {
    this.cap = cap;
    this.entries = [];
  }

  push(state, note) {
    this.entries.push({
      note: String(note ?? '').slice(0, 200),
      json: serializeState(state),
    });
    if (this.entries.length > this.cap) this.entries.shift();
  }

  size() {
    return this.entries.length;
  }

  pop() {
    const e = this.entries.pop();
    if (!e) return null;
    return { note: e.note, state: deserializeState(e.json) };
  }
}

export class Transcript {
  constructor() {
    this.lines = [];
  }

  passage(turn, name) {
    this.lines.push({ kind: 'passage', turn, name });
  }

  choice(turn, label, target) {
    this.lines.push({ kind: 'choice', turn, label, target });
  }

  rewind(fromTurn) {
    this.lines.push({ kind: 'rewind', turn: fromTurn });
  }

  text(title) {
    const out = [`# ${title}`, ''];
    for (const l of this.lines) {
      if (l.kind === 'passage') out.push(`[turn ${l.turn}] --- ${l.name} ---`);
      else if (l.kind === 'choice') out.push(`[turn ${l.turn}] > ${l.label}`);
      else out.push(`[turn ${l.turn}] (reader stepped back to an earlier turn)`);
    }
    return out.join('\n') + '\n';
  }
}
