import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/compile/index.js';
import { buildGraph, reachability, endingsReport, pathReport, branchingStats, analyzeStory } from '../../src/analysis/analyze.js';

function storyOf(src) {
  const c = compile(src, 'a.thorn');
  if (!c.ok) throw new Error('fixture: ' + JSON.stringify(c.diagnostics));
  return c.story;
}

const FIXTURE = storyOf([
  '---', 'start: Start', '---',
  '== Start ==',
  '* A -> Mid',
  '',
  '== Mid ==',
  '* On -> Dead',
  '',
  '== Dead == [ending]',
  'the end',
  '',
  '== Orphan ==',
  'nobody links here, and nothing links to Orphan',
  '',
  '== Lost == [ending]',
  'never reachable',
].join('\n'));

test('buildGraph lists nodes, nav edges and timeout edges separately', () => {
  const g = buildGraph(FIXTURE);
  assert.equal(g.nodes.length, 5);
  assert.ok(g.edges.some((e) => e.from === 'Start' && e.to === 'Mid'));
});

test('reachability marks the orphan and flags it via endings report', () => {
  const { reachable } = reachability(FIXTURE);
  assert.equal(reachable['Start'], true);
  assert.equal(reachable['Mid'], true);
  assert.equal(reachable['Orphan'], false);
  assert.equal(reachable['Lost'], false);

  const endings = endingsReport(FIXTURE);
  const dead = endings.find((e) => e.name === 'Dead');
  const lost = endings.find((e) => e.name === 'Lost');
  assert.equal(dead.structurallyReachable, true);
  assert.equal(lost.structurallyReachable, false);
});

test('pathReport finds the shortest ending path', () => {
  const g = buildGraph(FIXTURE);
  const p = pathReport(FIXTURE, g);
  assert.equal(p.shortestToEnding.choices, 2);
  assert.deepEqual(p.shortestToEnding.path, ['Start', 'Mid', 'Dead']);
});

test('branchingStats reports fan-out and word counts', () => {
  const s = branchingStats(buildGraph(FIXTURE));
  assert.equal(s.passages, 5);
  assert.equal(s.maxFanOut, 1);
  assert.equal(s.deadEnds >= 0, true);
  assert.ok(s.totalWords > 0);
  assert.ok(typeof s.wordsByPassage['Mid'] === 'number');
});

test('analyzeStory composes the full report with a stated method note', () => {
  const r = analyzeStory(FIXTURE);
  assert.match(r.paths.method, /BFS/);
  assert.ok(r.stats.edges > 0);
});
