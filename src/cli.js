#!/usr/bin/env node
/**
 * @file Thornweave CLI.
 */
import { compileFile } from './compile/index.js';
import { formatDiagnostic } from './compile/diagnostics.js';
import { analyzeStory } from './analysis/analyze.js';
import { walkMany } from './tools/walker.js';

const HELP = `thornweave — interactive fiction engine

  thornweave compile <story.thorn> [-o out.json]   compile; fails on errors
  thornweave lint <story.thorn>                    compile + style notes
  thornweave analyze <story.thorn> [--graph g.json] [--json]
                                                   graph, endings, paths, stats
  thornweave walk <story.thorn> [--seeds N]        random-walk playtester
  thornweave play <story.thorn> [--port N] [--debug]
                                                   local reading server
  thornweave watch <story.thorn> [--port N]        live-reload preview server
  thornweave export <story.thorn> -o game.html     self-contained offline HTML
  thornweave init <dir>                            scaffold a new story

Options: --json machine-readable stdout · --no-color plain output`;

function colorize(on) {
  return on ? {
    red: (s) => `\x1b[31m${s}\x1b[39m`,
    amber: (s) => `\x1b[33m${s}\x1b[39m`,
    dim: (s) => `\x1b[2m${s}\x1b[22m`,
    cyan: (s) => `\x1b[36m${s}\x1b[39m`,
    green: (s) => `\x1b[32m${s}\x1b[39m`,
    bold: (s) => `\x1b[1m${s}\x1b[22m`,
    underline: (s) => `\x1b[4m${s}\x1b[24m`,
  } : {
    red: (s) => s, amber: (s) => s, dim: (s) => s, cyan: (s) => s,
    green: (s) => s, bold: (s) => s, underline: (s) => s,
  };
}

function argFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--no-color') flags.noColor = true;
    else if (a === '--debug') flags.debug = true;
    else if (a === '--graph') flags.graph = argv[++i];
    else if (a === '-o' || a === '--out') flags.out = argv[++i];
    else if (a === '--port') {
      flags.port = Number(argv[++i] ?? 0);
      if (!Number.isInteger(flags.port) || flags.port < 1 || flags.port > 65535) {
        console.error('--port must be an integer between 1 and 65535');
        process.exit(2);
      }
    }
    else if (a === '--seeds') {
      flags.seeds = Number(argv[++i] ?? 0);
      if (!Number.isInteger(flags.seeds) || flags.seeds < 1 || flags.seeds > 100000) {
        console.error('--seeds must be an integer between 1 and 100000');
        process.exit(2);
      }
    }
    else if (a.startsWith('--')) { console.error(`unknown option ${a}`); process.exit(2); }
    else flags._.push(a);
  }
  return flags;
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  const flags = argFlags(rest);
  const useColor = process.stdout.isTTY && !flags.noColor;
  const c = colorize(useColor);

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(HELP);
    return 0;
  }

  try {
    switch (cmd) {
      case 'compile':
      case 'lint':
        return await cmdCompile(flags, c);
      case 'analyze':
        return await cmdAnalyze(flags, c);
      case 'walk':
        return await cmdWalk(flags, c);
      case 'play': {
        const { cmdPlay } = await import('./server.js');
        return await cmdPlay(flags, c);
      }
      case 'watch': {
        const { cmdWatch } = await import('./server.js');
        return await cmdWatch(flags, c);
      }
      case 'export': {
        const { cmdExport } = await import('./exportcli.js');
        return await cmdExport(flags, c);
      }
      case 'init': {
        const { cmdInit } = await import('./init.js');
        return await cmdInit(flags, c);
      }
      default:
        console.error(`unknown command '${cmd}'\n`);
        console.log(HELP);
        return 2;
    }
  } catch (e) {
    if (e?.fault === 'story-missing') {
      console.error(c.red('error:') + ' ' + e.message);
      return 2;
    }
    throw e;
  }
}

async function loadStory(flags) {
  const file = flags._[0];
  if (!file) {
    console.error('usage: thornweave <command> <story.thorn>');
    process.exit(2);
  }
  const compiled = await compileFile(file);
  return compiled;
}

function printDiagnostics(compiled, c) {
  if (CURRENT_JSON) return;
  for (const d of compiled.diagnostics) {
    console.log(formatDiagnostic(d, {
      colors: CURRENT_COLOR,
      sourceText: compiled.sourceText ?? '',
    }));
    console.log('');
  }
}

let CURRENT_COLOR = false;
let CURRENT_JSON = false;

async function cmdCompile(flags, c) {
  CURRENT_COLOR = process.stdout.isTTY && !flags.noColor;
  CURRENT_JSON = !!flags.json;
  const compiled = await loadStory(flags);
  if (flags.json) {
    const payload = {
      ok: compiled.ok,
      fingerprint: compiled.fingerprint,
      diagnostics: compiled.diagnostics,
    };
    console.log(JSON.stringify(payload, null, 2));
    const errs = compiled.diagnostics.filter((d) => d.severity === 'error').length;
    return errs > 0 ? 1 : 0;
  }
  printDiagnostics(compiled, c);
  const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
  const warnings = compiled.diagnostics.filter((d) => d.severity === 'warning');
  const notes = compiled.diagnostics.filter((d) => d.severity === 'note');
  if (compiled.ok) {
    console.log(c.green(`ok`) + c.dim(` — ${errors.length} errors, ${warnings.length} warnings, ${notes.length} notes`));
    if (compiled.fingerprint) console.log(c.dim(`fingerprint ${compiled.fingerprint.slice(0, 16)}…`));
    return 0;
  }
  console.log(c.red(`build failed`) + c.dim(` — ${errors.length} error(s); no output written`));
  return 1;
}

async function cmdAnalyze(flags, c) {
  CURRENT_COLOR = process.stdout.isTTY && !flags.noColor;
  CURRENT_JSON = !!flags.json;
  const compiled = await loadStory(flags);
  if (!compiled.ok) {
    printDiagnostics(compiled, c);
    console.error(c.red('cannot analyze a story with errors'));
    return 1;
  }
  const report = analyzeStory(compiled.story);
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  if (flags.graph) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(flags.graph, JSON.stringify(report.graph, null, 2), 'utf8');
    console.log(c.green(`wrote graph to ${flags.graph}`));
  }
  const { stats, endings, paths, reachability: reach } = report;
  console.log(c.bold(stats.passages + ' passages') + c.dim(` (${stats.navigablePassages} navigable, ${stats.edges} choice edges)`));
  console.log(c.dim(`words: ${stats.totalWords} total · fan-out avg ${stats.averageFanOut}, max ${stats.maxFanOut}`));
  const unreachable = Object.entries(reach.reachable).filter(([, v]) => !v).map(([k]) => k);
  console.log(c.dim(`unreachable passages: ${unreachable.length ? unreachable.join(', ') : 'none'}`));
  console.log('');
  console.log(c.bold('Endings'));
  if (endings.length === 0) console.log(c.dim('  none tagged [ending]'));
  for (const e of endings) {
    const mark = e.structurallyReachable ? c.green('reachable') : c.amber('UNREACHABLE');
    console.log(`  ${e.name}${c.dim(` — ${mark}, ${e.words} words`)}`);
  }
  console.log('');
  console.log(c.bold('Paths from start'));
  const p1 = paths.shortestToEnding;
  console.log(p1
    ? `  shortest ending: ${p1.choices} choices — ${p1.path.join(' -> ')}`
    : c.amber('  no ending is structurally reachable'));
  const p2 = paths.longestSimplePathApprox;
  console.log(p2
    ? `  longest simple path: ${p2.choices} choices — ${p2.path.join(' -> ')}` + c.dim(` (approx; ${paths.method})`)
    : c.dim('  longest path: n/a'));
  return 0;
}

async function cmdWalk(flags, c) {
  CURRENT_COLOR = process.stdout.isTTY && !flags.noColor;
  CURRENT_JSON = !!flags.json;
  const compiled = await loadStory(flags);
  if (!compiled.ok) {
    printDiagnostics(compiled, c);
    console.error(c.red('cannot walk a story with errors'));
    return 1;
  }
  const { Engine } = await import('./runtime/engine.js');
  const engine = new Engine(compiled.story);
  const report = walkMany(engine, flags.seeds ?? 200, {});
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.faults.length === 0 && report.deadEnds.length === 0 && report.loops.length === 0 ? 0 : 1;
  }
  console.log(c.bold(`${report.plays} random plays`) + c.dim(` over seeds ${report.startSeed}..${report.startSeed + report.seeds - 1}`));
  console.log(c.dim(`completed ${report.completed}/${report.plays}; saw ${report.passagesSeen} passages`));
  for (const f of report.faults.slice(0, 5)) {
    console.log(c.red('fault') + ` seed ${f.seed} at '${f.passage}': ${f.message}`);
  }
  for (const d of report.deadEnds.slice(0, 5)) {
    console.log(c.amber('dead end') + ` seed ${d.seed}: ${d.message}`);
  }
  for (const l of report.loops.slice(0, 3)) {
    console.log(c.amber('loop') + ` seed ${l.seed}: ${l.message}`);
  }
  console.log('');
  console.log(c.bold('Ending coverage'));
  for (const e of report.declaredEndings) {
    const n = report.endingsReached[e] ?? 0;
    console.log(n > 0 ? `  ${c.green(e)} ×${n}` : `  ${c.amber(e)} never reached`);
  }
  const clean = report.faults.length === 0 && report.deadEnds.length === 0 && report.loops.length === 0;
  if (!clean) return 1;
  console.log(c.green('\nno crashes, no dead ends'));
  return 0;
}
