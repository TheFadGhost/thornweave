import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStory, } from '../../src/syntax/parser.js';
import { linkId } from '../../src/syntax/ast.js';

const DOC = readFileSync(new URL('../../docs/DESIGN.md', import.meta.url), 'utf8');

function fenceAfter(marker) {
  const i = DOC.indexOf(marker);
  assert.ok(i >= 0, `marker ${marker} found`);
  const open = DOC.lastIndexOf('```', i);
  const close = DOC.indexOf('```', open + 3);
  return DOC.slice(open + 3, close).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

const TWO_COINS = fenceAfter('title: Two Coins');
const ORCHARD = fenceAfter('title: The Orchard Audit');

function codes(d) { return d.map((x) => `${x.severity}:${x.code}`); }

test('Two Coins design example parses verbatim with zero diagnostics', () => {
  const { story, diagnostics } = parseStory(TWO_COINS, 'two-coins.thorn');
  assert.deepEqual(codes(diagnostics), []);
  assert.equal(story.meta.title, 'Two Coins');
  assert.equal(story.meta.start, 'Road');
  assert.deepEqual(story.varsInit.coins, { t: 'number', v: 2 });
  const road = story.passages.Road;
  assert.ok(road);
  const para = road.nodes.find((n) => n.k === 'p');
  assert.match(para.kids[0].v, /^You have /);
  const ifNode = road.nodes.find((n) => n.k === 'if');
  assert.equal(ifNode.branches.length, 1);
  assert.equal(ifNode.branches[0].cond.t, 'bin');
  assert.equal(ifNode.elseNodes.length > 0, true);
  assert.equal(road.links.length, 2);
  assert.deepEqual(road.links.map((l) => l.id), [linkId('Road', 0), linkId('Road', 1)]);
  assert.deepEqual(road.links.map((l) => l.target), ['Bridge', 'Road']);
});

test('Orchard Audit design example parses verbatim with expected structures', () => {
  const { story, diagnostics } = parseStory(ORCHARD, 'orchard.thorn');
  assert.deepEqual(codes(diagnostics.filter((d) => d.code !== 'TW005')), []);
  assert.deepEqual(story.varsInit.apples, { t: 'list', v: [] });
  assert.deepEqual(story.varsInit.day, { t: 'number', v: 1 });
  const gate = story.passages.Gate;
  const dayStmt = JSON.stringify(gate.nodes).includes('"k":"set"');
  assert.ok(dayStmt);
  const forNode = gate.nodes.find((n) => n.k === 'for');
  assert.equal(forNode.varName, 'basket');
  assert.equal(forNode.iter.t, 'var');
  const ifNode = gate.nodes.find((n) => n.k === 'if');
  assert.equal(ifNode.branches[0].cond.t, 'bin');
  assert.equal(ifNode.branches[0].cond.l.name, 'count');
  assert.equal(ifNode.branches[0].cond.l.args[0].v, 'windfall');
  assert.ok(JSON.stringify(ifNode).includes('"target":"LadderNote"'));
  assert.equal(gate.links.length, 4);
  const [, b2, b3] = gate.nodes.find((n) => n.k === 'p') ? gate.links : [];
  void b2;
  const choices = gate.links;
  assert.equal(choices[0].attrs.once, true);
  assert.equal(choices[1].attrs.ifExpr.t, 'bin');
  assert.equal(choices[2].attrs.time, 8);
  assert.equal(choices[2].attrs.timeout, 'Dusk');
  assert.equal(choices[3].attrs.once, false);
  const ladder = story.passages.LadderNote;
  assert.ok(ladder.words >= 10);
  assert.equal(ladder.params.join(), '');
});

test('shorthand, forward and reverse links agree on target/display', () => {
  const src = ['== A ==', '[[Plain]] [[Shown -> B]] [[C <- Reversed]]'].join('\n');
  const { story, diagnostics } = parseStory(src);
  assert.deepEqual(codes(diagnostics).filter((c) => c.endsWith('TW001')), []);
  const links = story.passages.A.links;
  assert.equal(links[0].target, 'Plain');
  assert.equal(links[1].target, 'B');
  assert.equal(links[2].target, 'C');
  const nodesText = JSON.stringify(story.passages.A.nodes);
  assert.ok(nodesText.includes('Reversed'));
});

test('link attribute validation raises TW015', () => {
  const cases = [
    '== A ==\n[[Go -> B | time=0]]',
    '== A ==\n[[Go -> B | time=121]]',
    '== A ==\n[[Go -> B | time=abc]]',
    '== A ==\n[[Go -> B | timeout -> Dusk]]',
    '== A ==\n[[Go -> B | frobnicate]]',
    '== A ==\n* (time=200) Go -> B',
  ];
  for (const src of cases) {
    const { diagnostics } = parseStory(src);
    assert.ok(diagnostics.some((d) => d.code === 'TW015'), `expected TW015 for ${src}`);
  }
});

test('ordinal ids follow source order across mixed inline and bullet choices', () => {
  const src = ['== A ==', 'Start [[First -> X]] here.', '', '* Second -> Y', '', 'End [[Third -> Z]]'].join('\n');
  const { story } = parseStory(src);
  assert.deepEqual(story.passages.A.links.map((l) => l.id), [
    linkId('A', 0),
    linkId('A', 1),
    linkId('A', 2),
  ]);
});

test('escapes stay literal; unmatched delimiters stay literal', () => {
  const { story } = parseStory('== A ==\nBack \\{ brace \\[[ link \\\\ end plus {{ open and [[ half');
  const texts = [];
  (function walk(ns) { for (const n of ns) { if (n.k === 'text') texts.push(n.v); if (n.kids) walk(n.kids); } })(story.passages.A.nodes);
  const joined = texts.join('|');
  assert.ok(joined.includes('{ brace'));
  assert.ok(joined.includes('[[ link'));
  assert.ok(joined.includes('\\ end'));
  assert.ok(joined.includes('{{ open and [[ half'));
});

test('emphasis nests and unmatched markers stay literal', () => {
  const { story } = parseStory('== A ==\n**bold with *em* inside** tail * dangling');
  const p = story.passages.A.nodes[0];
  const strong = p.kids.find((n) => n.k === 'strong');
  assert.ok(strong);
  assert.ok(strong.kids.some((n) => n.k === 'em'));
  assert.ok(JSON.stringify(p).includes('dangling'));
});

test('emphasis does not span paragraphs', () => {
  const { story } = parseStory('== A ==\n*a\n\nb*');
  const ps = story.passages.A.nodes.filter((n) => n.k === 'p');
  assert.equal(ps.length, 2);
  assert.ok(ps[0].kids[0].v.startsWith('*a'));
});

test('comments are stripped in prose and inside blocks', () => {
  const src = ['== A ==', '%% top note', 'Visible text', '', '{{if true}}', '%% inner note', 'Branch text', '{{end}}'].join('\n');
  const { story, diagnostics } = parseStory(src);
  assert.deepEqual(codes(diagnostics), []);
  const dump = JSON.stringify(story.passages.A.nodes);
  assert.ok(!dump.includes('note'));
  assert.ok(dump.includes('Visible text'));
  assert.ok(dump.includes('Branch text'));
});

test('unicode passage names link correctly', () => {
  const src = '== Café Terrace ==\nWelcome\n\n== Start ==\n[[Sit down -> Café Terrace]]';
  const { story, diagnostics } = parseStory(src);
  assert.deepEqual(codes(diagnostics), []);
  assert.ok(story.passages['Café Terrace']);
  assert.equal(story.passages.Start.links[0].target, 'Café Terrace');
});

function exactDiag(src, code, line, col) {
  const { diagnostics } = parseStory(src, 'x.thorn');
  const hit = diagnostics.find((d) => d.code === code && d.line === line && d.col === col);
  assert.ok(hit, `expected ${code} at ${line}:${col}, got ${JSON.stringify(diagnostics)}`);
  return hit;
}

test('malformed inputs produce TW020/TW013 at exact line and column', () => {
  exactDiag('== A ==\n{{if x}}\ntext', 'TW020', 2, 1);
  exactDiag('== A ==\n{{else}}', 'TW020', 2, 1);
  exactDiag('== A ==\n~ frobnicate x', 'TW020', 2, 1);
  exactDiag('== A ==\n{{set x = "abc}}', 'TW020', 2, 1);
  const st = parseStory('== A ==\n~ set x = "abc', 'x.thorn');
  const sdiag = st.diagnostics.find((d) => /unterminated string/.test(d.message));
  assert.ok(sdiag && sdiag.line === 2 && sdiag.col === 6, `unterminated string diag ${JSON.stringify(st.diagnostics)}`);
  exactDiag('==', 'TW013', 1, 4);
  exactDiag('== A ==\n* Just walking', 'TW020', 2, 1);
  exactDiag('== A ==\n[[Broken -> ]]', 'TW020', 2, 10);
});

test('frontmatter types, show, warnings and errors', () => {
  const src = [
    '---',
    'title: T',
    'mystery: yes',
    'format: 1',
    'show: nerve, oil',
    'vars:',
    '  n: 3',
    '  s = "hi"',
    '  flag: true',
    '  xs: [1, 2]',
    '---',
    '== Only ==',
    'Body',
  ].join('\n');
  const { story, diagnostics } = parseStory(src, 'f.thorn');
  assert.deepEqual(story.varsInit.n, { t: 'number', v: 3 });
  assert.deepEqual(story.varsInit.s, { t: 'string', v: 'hi' });
  assert.deepEqual(story.varsInit.flag, { t: 'boolean', v: true });
  assert.deepEqual(story.varsInit.xs, { t: 'list', v: [1, 2] });
  assert.deepEqual(story.meta.show, ['nerve', 'oil']);
  assert.ok(diagnostics.some((d) => d.code === 'TW016' && d.severity === 'warning' && /mystery/.test(d.message)));
  const bad = parseStory('---\nformat: 2\n---\n== A ==\nx', 'b.thorn');
  assert.ok(bad.diagnostics.some((d) => d.code === 'TW016' && d.severity === 'error'));
  const dup = parseStory('---\ntitle: A\ntitle: B\n---\n== A ==\nx');
  assert.ok(dup.diagnostics.some((d) => d.code === 'TW016' && /twice/.test(d.message)));
  assert.equal(dup.story.meta.title, 'B');
});

test('all statement forms parse', () => {
  const src = [
    '== A ==',
    '~ set gold = gold + 2',
    '~ unset lamp',
    '~ take "rusty key"',
    '~ take "coin", 3',
    '~ drop "rusty key"',
    '~ drop "coin", 1',
    '~ push apples "bruised"',
    '~ push apples, "ripe"',
  ].join('\n');
  const { story, diagnostics } = parseStory(src);
  assert.deepEqual(codes(diagnostics), []);
  const kinds = [];
  (function walk(ns) { for (const n of ns) { if (!['p'].includes(n.k)) kinds.push(n.k); if (n.kids) walk(n.kids); } })(story.passages.A.nodes);
  assert.deepEqual(kinds, ['set', 'unset', 'take', 'take', 'drop', 'drop', 'push', 'push']);
});

test('scene breaks via middots and asterisks', () => {
  const { story } = parseStory('== A ==\nOne\n· · ·\nTwo\n***\nThree');
  const ks = story.passages.A.nodes.map((n) => n.k);
  assert.deepEqual(ks, ['p', 'break', 'p', 'break', 'p']);
});

test('paragraph collapsing rules', () => {
  const { story } = parseStory('== A ==\none two\nthree\n\nfour');
  const ps = story.passages.A.nodes.filter((n) => n.k === 'p');
  assert.equal(ps.length, 2);
  assert.equal(ps[0].kids[0].v, 'one two three');
  assert.equal(ps[1].kids[0].v, 'four');
});

test('macro-style calls parse as call expressions resolved at runtime', () => {
  const src = ['== Wound(level, who) ==', 'A wound of {{level}} on {{who}}.', '', '== Scene ==', '{{Wound(2, "keeper")}}'].join('\n');
  const { story, diagnostics } = parseStory(src);
  assert.deepEqual(codes(diagnostics), []);
  assert.deepEqual(story.passages.Wound.params, ['level', 'who']);
  const scene = story.passages.Scene;
  let call = null;
  (function find(ns) { for (const n of ns) { if (n.k === 'interp' && n.expr?.t === 'call') call = n.expr; if (n.kids) find(n.kids); } })(scene.nodes);
  assert.ok(call, 'call expression present');
  assert.equal(call.name, 'Wound');
  assert.equal(call.args.length, 2);
  assert.equal(call.args[1].v, 'keeper');
});

test('parser recovers across broken passages', () => {
  const src = ['== B1 ==', '{{if x}}', 'text', '', '== B2 ==', '{{for a in b}}', 'txt', '', '== C ==', 'all fine'].join('\n');
  const { story, diagnostics } = parseStory(src);
  const twentys = diagnostics.filter((d) => d.code === 'TW020' && /never closed/.test(d.message));
  assert.equal(twentys.length, 2);
  assert.ok(story.passages.C);
  assert.match(JSON.stringify(story.passages.C.nodes), /all fine/);
});

test('comments before the first passage header are allowed', () => {
  const { story, diagnostics } = parseStory('%% setup notes\n%% more notes\n== Only ==\nBody');
  assert.deepEqual(codes(diagnostics), []);
  assert.ok(story.passages.Only);
});

test('nested blocks and inline conditionals keep paragraph flow', () => {
  const src = ['== A ==', 'Hello {{if gold > 0}}friend{{else}}stranger{{end}}.', '', '{{if true}}{{for x in range(1,3)}}row {{x}}{{end}}{{end}}'].join('\n');
  const { story, diagnostics } = parseStory(src);
  assert.deepEqual(codes(diagnostics), []);
  const p = story.passages.A.nodes[0];
  assert.equal(p.k, 'p');
  assert.equal(p.kids.filter((n) => n.k === 'if').length, 1);
  const dump = JSON.stringify(story.passages.A.nodes);
  assert.ok(dump.includes('stranger'));
  assert.ok(dump.includes('"varName":"x"'));
});
