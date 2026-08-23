/**
 * @file `thornweave export` — writes the self-contained HTML file.
 */
import { compileFile } from './compile/index.js';
import { writeExport } from './export/bundle.js';
import { fault } from './state/model.js';

function ioFault(e, path) {
  const clean = ['EACCES', 'EPERM', 'ENOSPC', 'EEXIST', 'EISDIR', 'ENOENT', 'EROFS', 'ENOTDIR'];
  if (e && clean.includes(e.code)) return fault('io', `cannot write ${path}: ${e.message}`);
  return e;
}

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
  try {
    writeExport(payload, out, compiled.story.meta.title);
  } catch (e) {
    const f = ioFault(e, out);
    console.error(c.red('error:') + ' ' + f.message);
    return 1;
  }
  console.log(c.green(`wrote ${out}`) + c.dim(` — offline, zero network requests (${compiled.story.order.length} passages)`));
  return 0;
}
