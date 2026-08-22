/**
 * @file Diagnostic rendering (SPEC §10, DESIGN Part II "Compiler diagnostic
 * anatomy"). Pure formatting: no I/O, no colour unless explicitly requested —
 * TTY detection is the caller's job (DESIGN: non-TTY output is plain ASCII).
 *
 * Anatomy, exactly:
 *
 *   error[TW001]: message
 *     --> file:line:col
 *      |
 *    14 | <source line>
 *      |  ^^^^^^^^^^^^^^
 *      |
 *   help = ...
 *
 * The line-number gutter widens with the digits of the line number; the `|`
 * bars align one space past it. Carets span endCol - col (minimum 1; endCol
 * defaults to col + 1).
 */

const ANSI = {
  red: '\x1b[31m',
  amber: '\x1b[33m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  underline: '\x1b[4m',
  reset: '\x1b[0m',
};

const SEVERITY_COLOR = { error: 'red', warning: 'amber', note: 'dim' };

function paint(text, color, colors) {
  return colors ? ANSI[color] + text + ANSI.reset : text;
}

/** Split source text into lines; tolerant of CRLF and absent input. */
export function sourceLines(sourceText) {
  if (typeof sourceText !== 'string') return [];
  return sourceText.split(/\r?\n/);
}

/**
 * Render one diagnostic in the DESIGN anatomy.
 * @param {import('../syntax/ast.js').Diagnostic} d
 * @param {{colors?: boolean, sourceText?: string, source?: string}} [opts]
 */
export function formatDiagnostic(d, opts = {}) {
  const colors = opts.colors === true;
  const lines = typeof opts.sourceText === 'string'
    ? opts.sourceText
    : (typeof opts.source === 'string' ? opts.source : undefined);
  const srcLines = lines !== undefined ? lines.split(/\r?\n/) : null;

  const sevWord = paint(d.severity, SEVERITY_COLOR[d.severity] ?? 'dim', colors);
  const out = [];
  out.push(`${sevWord}[${d.code}]: ${d.message}`);
  out.push(`  --> ${paint(d.file, 'underline', colors)}:${d.line}:${d.col}`);

  const width = String(d.line).length;
  const bar = ' '.repeat(width + 1) + '|';
  out.push(bar);

  const src = srcLines && d.line >= 1 && d.line <= srcLines.length
    ? srcLines[d.line - 1]
    : '';
  out.push(`${String(d.line).padStart(width, ' ')} | ${src}`);

  const carets = Math.max(1, (d.endCol ?? d.col + 1) - d.col);
  const pad = Math.max(0, d.col - 1);
  out.push(`${bar} ${' '.repeat(pad)}${'^'.repeat(carets)}`);

  out.push(bar);
  if (d.help !== undefined) out.push(`${paint(`help = ${d.help}`, 'cyan', colors)}`);
  return out.join('\n');
}

/**
 * Machine-readable form with a stable key order.
 * @returns {{severity:string, code:string, message:string, file:string,
 *            line:number, col:number, endCol?:number, help?:string}}
 */
export function toJson(d) {
  const o = {
    severity: d.severity,
    code: d.code,
    message: d.message,
    file: d.file,
    line: d.line,
    col: d.col,
  };
  if (d.endCol !== undefined) o.endCol = d.endCol;
  if (d.help !== undefined) o.help = d.help;
  return o;
}

/**
 * Deterministic ordering for display and CI logs: file, then line, then
 * column, then code. Returns a new array; the input is untouched.
 * @param {import('../syntax/ast.js').Diagnostic[]} list
 */
export function sortDiagnostics(list) {
  return [...list].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.col !== b.col) return a.col - b.col;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return 0;
  });
}
