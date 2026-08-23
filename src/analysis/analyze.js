/**
 * @file Story analysis (PLAN feature 7): passage graph, word counts,
 * endings reachability, path lengths. Structural reachability ignores
 * conditional expressions — a stated approximation confirmed dynamically by
 * the walker (SPEC §10 TW003 note).
 */
import { resolveStart } from '../syntax/ast.js';

export function buildGraph(story) {
  const nodes = story.order.map((name) => ({
    name,
    tags: story.passages[name].tags,
    macro: story.passages[name].params.length > 0,
    words: story.passages[name].words,
  }));
  const edges = [];
  for (const name of story.order) {
    const p = story.passages[name];
    for (const l of p.links) {
      if (!nodes.some((n) => n.name === l.target)) continue;
      edges.push({ from: name, to: l.target, once: !!l.attrs.once, timed: (l.attrs.time ?? 0) > 0 });
    }
  }
  return { nodes, edges };
}

export function reachability(story, graph = buildGraph(story)) {
  const start = resolveStart(story);
  const adj = new Map(graph.nodes.map((n) => [n.name, []]));
  for (const e of graph.edges) {
    if (adj.has(e.from)) adj.get(e.from).push(e.to);
  }
  const seen = new Set();
  const queue = start && adj.has(start) ? [start] : [];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nx of adj.get(cur) ?? []) queue.push(nx);
  }
  const reachable = {};
  for (const n of graph.nodes) reachable[n.name] = seen.has(n.name);
  return { start, reachable };
}

export function endingsReport(story, graph = buildGraph(story)) {
  const { reachable } = reachability(story, graph);
  const endings = graph.nodes
    .filter((n) => n.tags.includes('ending'))
    .map((n) => ({
      name: n.name,
      structurallyReachable: reachable[n.name],
      words: n.words,
    }));
  return endings;
}

export function pathReport(story, graph = buildGraph(story)) {
  const { start } = reachability(story, graph);
  const endingNames = new Set(graph.nodes.filter((n) => n.tags.includes('ending')).map((n) => n.name));
  const adj = new Map(graph.nodes.map((n) => [n.name, []]));
  for (const e of graph.edges) if (adj.has(e.from)) adj.get(e.from).push(e.to);

  let shortest = null;
  let longest = null;
  let visitedCeiling = 0;

  if (start && endingNames.size > 0) {
    const dist = new Map([[start, 0]]);
    const parent = new Map();
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const nx of adj.get(cur) ?? []) {
        if (!dist.has(nx)) {
          dist.set(nx, dist.get(cur) + 1);
          parent.set(nx, cur);
          queue.push(nx);
        }
      }
    }
    for (const end of endingNames) {
      if (!dist.has(end)) continue;
      if (!shortest || dist.get(end) < dist.get(shortest)) shortest = end;
    }
    if (shortest) {
      const path = [];
      for (let c = shortest; c !== undefined; c = parent.get(c)) path.unshift(c);
      shortest = { target: shortest, choices: dist.get(shortest), path };
    }

    const LIMIT = 200000;
    let steps = 0;
    const best = { len: -1, path: null, end: null };
    const onPath = new Set([start]);
    const dfs = (node, trail) => {
      if (steps++ > LIMIT) return;
      if (endingNames.has(node) && trail.length > best.len) {
        best.len = trail.length;
        best.path = [...trail];
        best.end = node;
      }
      for (const nx of adj.get(node) ?? []) {
        if (onPath.has(nx)) continue;
        onPath.add(nx);
        trail.push(nx);
        dfs(nx, trail);
        trail.pop();
        onPath.delete(nx);
      }
    };
    dfs(start, [start]);
    if (best.path) longest = { target: best.end, choices: best.len - 1, path: best.path };
    visitedCeiling = steps;
  }

  return {
    shortestToEnding: shortest,
    longestSimplePathApprox: longest,
    method: 'shortest = BFS over structural edges; longest = depth-first simple-path search with a step ceiling',
    searchStepsUsed: visitedCeiling,
  };
}

export function branchingStats(graph) {
  const fanout = new Map();
  for (const e of graph.edges) fanout.set(e.from, (fanout.get(e.from) ?? 0) + 1);
  const values = graph.nodes.filter((n) => !n.macro).map((n) => fanout.get(n.name) ?? 0);
  const totalWords = graph.nodes.reduce((a, n) => a + n.words, 0);
  return {
    passages: graph.nodes.length,
    navigablePassages: values.length,
    edges: graph.edges.length,
    averageFanOut: values.length ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : 0,
    maxFanOut: values.length ? Math.max(...values) : 0,
    deadEnds: values.filter((v) => v === 0).length,
    totalWords,
    wordsByPassage: Object.fromEntries(graph.nodes.map((n) => [n.name, n.words]).sort((a, b) => a[0].localeCompare(b[0]))),
  };
}

export function analyzeStory(story) {
  const graph = buildGraph(story);
  return {
    graph,
    reachability: reachability(story, graph),
    endings: endingsReport(story, graph),
    paths: pathReport(story, graph),
    stats: branchingStats(graph),
  };
}
