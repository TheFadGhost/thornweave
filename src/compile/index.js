/**
 * @file Compiler entrypoint: parse -> check -> fingerprint (SPEC §10).
 */
import { readFile } from 'node:fs/promises';
import { parseStory } from '../syntax/parser.js';
import { checkStory } from './checker.js';
import { storyFingerprint } from './fingerprint.js';
import { sortDiagnostics } from './diagnostics.js';

export function compile(sourceText, fileName = 'story.thorn') {
  const { story, diagnostics: parseDiags } = parseStory(sourceText, fileName);
  const checkDiags = story && Object.keys(story.passages).length >= 0
    ? checkStory(story, sourceText, fileName)
    : [];
  const diagnostics = sortDiagnostics([...parseDiags, ...checkDiags]);
  const ok = !diagnostics.some((d) => d.severity === 'error');
  return {
    story,
    diagnostics,
    ok,
    fingerprint: ok ? storyFingerprint(story) : null,
  };
}

export async function compileFile(path) {
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      const err = new Error(`story file not found: ${path}`);
      err.fault = 'story-missing';
      throw err;
    }
    throw e;
  }
  return { ...compile(source, path), sourceText: source };
}
