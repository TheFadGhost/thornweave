/**
 * @file `thornweave export` — writes the self-contained HTML file.
 */
import { compileFile } from './compile/index.js';
import { writeExport } from './export/bundle.js';

export async function cmdExport(flags, c) {
  const file = flags._[0];
  const out = flags.out;
  if (!file || !out) {
    console.error('usage: thornweave export <story.thorn> -o game.html');
    return 2;
  }
  const compiled = await compileFile(file);
  if (!compiled.ok) {
    for (const d of compiled.diagnostics) console.error(d.message);
    console.error(c.red('cannot export a story with errors'));
    return 1;
  }
  const payload = {
    fingerprint: compiled.fingerprint,
    story: compiled.story,
    debug: false,
    sourceText: undefined,
  };
  writeExport(payload, out, compiled.story.meta.title);
  console.log(c.green(`wrote ${out}`) + c.dim(` — offline, zero network requests (${compiled.story.order.length} passages)`));
  return 0;
}
