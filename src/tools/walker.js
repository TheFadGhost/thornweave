/**
 * @file Random-walk playtester (PLAN feature 9). Walks a compiled story under
 * many seeds looking for crashes, dead ends without endings, and ending
 * coverage. The walker's own RNG is independent of the story RNG so coverage
 * does not disturb story determinism.
 */
import { mulberry32 } from '../runtime/rng.js';

export function walkOnce(engine, seed, opts = {}) {
  const maxSteps = opts.maxSteps ?? 400;
  const rng = mulberry32(seed);
  const state = engine.newGame(seed ^ 0x9e3779b9);
  let render = engine.start(state);
  const visitedPassages = new Set([state.current]);
  const path = [state.current];
  let steps = 0;

  for (;;) {
    if (render.ending) {
      return { ok: true, outcome: 'ending', ending: state.current, steps, visitedPassages, path };
    }
    const live = render.choices.filter((c) => !c.disabled && !c.consumed);
    if (live.length === 0) {
      return {
        ok: false,
        outcome: 'dead-end',
        passage: state.current,
        message: `passage '${state.current}' offered no choices and has no [ending] tag`,
        steps,
        visitedPassages,
        path,
      };
    }
    if (steps >= maxSteps) {
      return {
        ok: false,
        outcome: 'loop',
        passage: state.current,
        message: `walk exceeded ${maxSteps} choices without reaching an ending`,
        steps,
        visitedPassages,
        path,
      };
    }

    const leastVisited = live.reduce((best, c) => {
      const v = visitedPassages.has(c.target) ? 1 : 0;
      return v < best.v ? { c, v } : best;
    }, { c: live[0], v: 2 });
    const pickUnvisited = leastVisited.v === 0 && rng.next() < 0.65;
    const choice = pickUnvisited ? leastVisited.c : live[rng.int(0, live.length - 1)];

    steps++;
    try {
      visitedPassages.add(choice.target);
      path.push(choice.target);
      render = engine.choose(state, choice);
    } catch (e) {
      return {
        ok: false,
        outcome: 'fault',
        passage: state.current,
        choice: choice.label,
        message: e.message,
        faultKind: e.fault ?? 'runtime',
        pos: e.pos ?? null,
        steps,
        visitedPassages,
        path,
      };
    }
  }
}

export function walkMany(engine, seedCount, opts = {}) {
  const startSeed = opts.startSeed ?? 1;
  const results = [];
  const faults = [];
  const deadEnds = [];
  const loops = [];
  const endingsReached = new Map();

  for (let i = 0; i < seedCount; i++) {
    const r = walkOnce(engine, startSeed + i, opts);
    results.push(r);
    if (r.outcome === 'fault') faults.push({ seed: startSeed + i, ...r });
    else if (r.outcome === 'dead-end') deadEnds.push({ seed: startSeed + i, ...r });
    else if (r.outcome === 'loop') loops.push({ seed: startSeed + i, ...r });
    else if (r.outcome === 'ending') {
      endingsReached.set(r.ending, (endingsReached.get(r.ending) ?? 0) + 1);
    }
  }

  const declaredEndings = Object.values(engine.story.passages)
    .filter((p) => p.tags.includes('ending'))
    .map((p) => p.name);

  const missed = declaredEndings.filter((e) => !endingsReached.has(e));

  return {
    seeds: seedCount,
    startSeed,
    plays: results.length,
    completed: results.filter((r) => r.ok).length,
    faults,
    deadEnds,
    loops,
    endingsReached: Object.fromEntries([...endingsReached].sort()),
    declaredEndings,
    missedEndings: missed,
    allEndingsReached: declaredEndings.length > 0 && missed.length === 0,
    passagesSeen: new Set(results.flatMap((r) => [...r.visitedPassages])).size,
  };
}
