/**
 * @file Shared AST + compiled-story contracts. Every module imports these
 * shapes; changing them requires updating SPEC.md §12 and all consumers.
 *
 * ---------------- Expression AST (SPEC §5) ----------------
 * @typedef  {object} ExprNum   @property {'num'} t   @property {number} v
 * @typedef  {object} ExprStr   @property {'str'} t   @property {string} v
 * @typedef  {object} ExprBool  @property {'bool'} t  @property {boolean} v
 * @typedef  {object} ExprList  @property {'list'} t  @property {ASTExpr[]} items
 * @typedef  {object} ExprVar   @property {'var'} t   @property {string} name  @property {Pos} pos
 * @typedef  {object} ExprBin   @property {'bin'} t   @property {string} op    @property {ASTExpr} l @property {ASTExpr} r @property {Pos} pos
 * @typedef  {object} ExprUn    @property {'un'} t    @property {'-'|'not'} op @property {ASTExpr} e @property {Pos} pos
 * @typedef  {object} ExprTer   @property {'ternary'} t @property {ASTExpr} c @property {ASTExpr} a @property {ASTExpr} b @property {Pos} pos
 * @typedef  {object} ExprCall  @property {'call'} t  @property {string} name  @property {ASTExpr[]} args @property {Pos} pos
 * @typedef {ExprNum|ExprStr|ExprBool|ExprList|ExprVar|ExprBin|ExprUn|ExprTer|ExprCall} ASTExpr
 * @typedef {object} Pos @property {number} line @property {number} col
 */

/**
 * ---------------- Content node kinds (SPEC §4, §8) ----------------
 * text      { k:'text',    v:string }
 * em        { k:'em',      kids:Node[] }
 * strong    { k:'strong',  kids:Node[] }
 * break     { k:'break' }                      scene break
 * interp    { k:'interp',  expr:ASTExpr }
 * if        { k:'if',      branches:{cond:ASTExpr,nodes:Node[]}[], elseNodes:Node[] }
 * for       { k:'for',     varName:string, iter:ASTExpr, nodes:Node[] }
 * set       { k:'set',     name:string, expr:ASTExpr, pos:Pos }
 * unset     { k:'unset',   name:string, pos:Pos }
 * take      { k:'take',    item:ASTExpr, count:(ASTExpr|null), pos:Pos }
 * drop      { k:'drop',    item:ASTExpr, count:(ASTExpr|null), pos:Pos }
 * push      { k:'push',    name:string, expr:ASTExpr, pos:Pos }
 * include   { k:'include', target:string, args:(ASTExpr[]|null), pos:Pos }
 * link      { k:'link',    id:string, display:Node[], target:string,
 *             attrs:{ once:boolean, time:number|0, timeout:string|null }, pos:Pos }
 * choice    { k:'choice',  id:string, display:Node[], target:string,
 *             attrs:{ once:boolean, time:number|0, timeout:string|null, ifExpr:(ASTExpr|null) }, pos:Pos }
 * @typedef {object} Node
 */

/**
 * ---------------- Passage / Story IR (SPEC §1) ----------------
 * @typedef {object} Passage
 * @property {string} name
 * @property {string[]} tags           // may contain 'start','ending','unlisted' + free-form
 * @property {string[]} params         // macro parameters, empty when none
 * @property {Node[]} nodes
 * @property {number} line             // header line (1-based)
 * @property {{target:string, attrs:Object, line:number, col:number, id:string}[]} links
 * @property {number} words            // prose word count (compiler-filled)
 *
 * @typedef {object} StoryIR
 * @property {number} formatVersion    // always 1
 * @property {{title:string, author:string, description:string,
 *             start:string, show:string[], seed:(number|null)}} meta
 * @property {Object<string,{t:ValueType,v:*}>} varsInit
 * @property {Object<string,Passage>} passages     // keyed by name
 * @property {string[]} order                      // source order of names
 *
 * @typedef {'number'|'string'|'boolean'|'list'} ValueType
 */

/**
 * ---------------- Diagnostic (SPEC §10, DESIGN Part II) ----------------
 * @typedef {object} Diagnostic
 * @property {'error'|'warning'|'note'} severity
 * @property {string} code            // 'TW001'…'TW020'
 * @property {string} message         // human sentence, lowercase after code tag
 * @property {string} file
 * @property {number} line            // 1-based
 * @property {number} col             // 1-based
 * @property {number} [endCol]        // exclusive end column on same line
 * @property {string} [help]          // suggested fix
 */

/** Stable link identity (SPEC §7): sha1(name#ordinal), hex, 20 chars. */
export function linkId(passageName, ordinal) {
  return `${passageName}#${ordinal}`;
}

export const FORMAT_VERSION = 1;
export const LOOP_CAP = 10000;
export const INCLUDE_DEPTH_CAP = 32;

/** Shared start-resolution rule (SPEC §1.1): explicit > [start] tag > first non-macro passage.
 *  An explicitly named but missing start is returned as-is so diagnostics can name it. */
export function resolveStart(story) {
  const named = story.meta?.start;
  if (named) return named;
  const tagged = (story.order ?? []).find((n) => story.passages[n]?.tags.includes('start'));
  if (tagged) return tagged;
  return (story.order ?? []).find((n) => (story.passages[n]?.params.length ?? 0) === 0) ?? '';
}
