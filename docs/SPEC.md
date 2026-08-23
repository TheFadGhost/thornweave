# SPEC.md — The Thornweave authoring format (Thornmark), v1

This specification precedes the implementation. The lexer/parser, evaluator,
compiler checks, and tests are written against this document. Where code and
spec disagree, one of them is wrong and must be fixed before release.

Files use the extension `.thorn`, UTF-8, LF line endings recommended.

---

## 1. Story structure

A story is **one** `.thorn` file containing optional frontmatter followed by
one or more **passages**.

### 1.1 Frontmatter

If the first line is exactly `---`, frontmatter runs until the next line that
is exactly `---`. Lines are `key: value` or the nested block `vars:` /
`show:` whose following indented lines are entries of the form
`name = value` or `name: value` (equivalent; pick one style per file).

| Key | Type | Meaning |
| --- | --- | --- |
| `title` | string | Display title. Default: file stem. |
| `author` | string | Credit shown on export. |
| `description` | string | Short description. |
| `start` | identifier | First passage. Default: the first non-macro (parameter-less) passage in the file. |
| `format` | integer | Must be `1`; otherwise diagnostic `TW016` (error). |
| `show` | comma list | Variables listed in the player status panel. |
| `vars` | block | Starting variables; values must be **literals** (number, `"string"`, `true`/`false`, `[a, b, …]`). |

Unknown keys produce `TW016` (warning). Duplicate keys: last wins (`TW016`
warning).

### 1.2 Passages

```
== Name ==
prose…
```

- A passage header is a line starting with `==`, then the name, then an
  optional closing `==` (any run of trailing `=` is decorative and ignored).
- Names may contain any characters except newline and `=`-runs adjacent to
  the delimiters. Leading/trailing whitespace is trimmed. Empty names are
  `TW013` (error). Duplicate names are `TW009` (error).
- Optional tags follow the name in square brackets: `== Night [ending storm]`.
  Reserved tags: `start` (alias for frontmatter `start`), `ending`,
  `unlisted` (excluded from endings analysis). Unknown tags are free-form and
  appear in graph output.
- A passage with parameters declares them in parentheses after the name:
  `== Wound(level, who) ==`. Parameterised passages are macros (§6).

## 2. Prose

Everything inside a passage that is not markup is literal prose, rendered
verbatim with these transforms:

- Paragraphs are separated by blank lines.
- Line breaks within a paragraph collapse to spaces.
- `*text*` renders `<em>`; `**text**` renders `<strong>`. Emphasis may not
  span paragraphs; unmatched markers stay literal.
- `· · ·` alone on a line renders a scene break (also: `***` alone on a line).
- Comments: a line beginning `%%` (after optional whitespace) is stripped
  everywhere, including inside logic blocks.
- Escapes: `\{`, `\}`, `\[[`, `\]`, `\|`, `\*`, `\\` produce the literal
  character. A backslash before any other character stays as-is (both
  characters). Bad escape sequences are never errors in prose (`TW012`
  applies only inside logic, §4).

## 3. Links and choices

Two constructs create edges in the passage graph.

### 3.1 Inline links

```
[[display -> Target]]
[[Target]]
[[Target <- display]]
```

- `[[Target]]` shorthand: display text is the target name.
- Attributes ride after the target separated by `|`: `once`, `time=N`
  (integer seconds 1–120), `timeout -> Passage` (only valid together with
  `time`). Complete examples: `[[Wait -> Hold | once]]`,
  `[[Grab it -> Grab | time=8, timeout -> Dusk]]`. Attributes belong only
  inside the brackets; bulleted choices use `(parentheses)` instead.
  Invalid combos/values: `TW015` (error).
- Inline links are unconditional; wrap them in `{{if}}` for conditional
  appearance.

### 3.2 Bulleted choices

A line beginning with `* ` (optionally indented) is a bulleted choice:

```
* (once) Search the drawer -> Drawer
* (if has("key")) Unlock the door -> Vault
* (time=8, timeout -> Dusk) Wait for dawn -> Dawn
* Leave by the road -> Road
```

Grammar: `*` `(attr;…)`? display-text `->` Target. Attributes: `once`,
`if expression`, `time=N`, `timeout -> Passage`. `if` makes the choice
**hidden** unless the expression is true at render time. `once` consumes the
choice permanently for the playthrough (per §7 identity). `time=N` starts a
countdown when the choices are displayed; on expiry the player is sent to the
`timeout` target; if a timed choice lacks a timeout target there must exist
at least one other visible non-timed choice to fall back to (otherwise the
expiry sends the player to the timed choice's own target and emits `TW015`
warning at compile time).

Both forms are choices; the player sees inline links and bullets merged,
bullets after inline links, in source order.

## 4. Logic

Logic appears as **interpolations**, **statement lines**, and **blocks**.

### 4.1 Interpolation

`{{ expression }}` anywhere in prose renders the value: numbers in
canonical decimal form (integers without decimal point), strings raw
(never escaped as HTML-injection-safe: see §11), booleans as `true`/`false`,
lists as comma-separated elements in `[…]`.

### 4.2 Statement lines

A line whose first non-whitespace character is `~` is a statement:

```
~ set oil = oil - 1
~ unset lamp
~ take "rusty key"
~ take "coin", 3        %% count optional, defaults to 1
~ drop "rusty key"
~ drop "coin", 2        %% same optional count
~ push apples "bruised"
```

Statements execute in document order during the passage walk (§8). `set`
creates or overwrites a variable. Assigning a different **type** to an
existing variable is a runtime fault; statically provable mismatches are
compile errors (`TW006`).

### 4.3 Blocks

```
{{if condition}}
text
{{elif condition}}
text
{{else}}
text
{{end}}

{{for x in expression}}
repeated text, may interpolate {{x}}
{{end}}

{{include PassageName}}
{{Wound(2, "the keeper")}}
```

- `elif`/`else` optional; first true branch renders.
- `for` iterates a **snapshot copy** of the list value; the loop variable is
  scoped to the body and shadows outer bindings for its duration.
- Runtime guard: any `for` exceeding **10,000 iterations** raises a story
  fault (prevents runaway loops; constant-looking large bounds also emit
  `TW019` note).
- `include Name` splices the named passage inline at this point. Macro calls
  `Name(args…)}` require the passage to declare matching parameters;
  arguments bind as constants inside the macro. `visited()` does **not**
  change for includes/macros. Static include/macro recursion that cannot
  terminate (self-include without parameter-dependent branch the analyser
  can prove) is `TW011` (error); dynamic depth beyond **32** is a runtime
  fault.

## 5. Expressions

### 5.1 Literals and identifiers

Numbers (decimal, optional `-`, optional fraction), strings in double quotes
with escapes `\n \t \" \\` , `true`, `false`, identifiers
`[A-Za-z_][A-Za-z0-9_]*`, list literals `[a, b, c]`.

### 5.2 Operators, lowest to highest precedence

| Level | Operators | Associativity |
| --- | --- | --- |
| 1 | `? :` (ternary) | right |
| 2 | `or`, `||` | left |
| 3 | `and`, `&&` | left |
| 4 | `not`, `!` (prefix) | — |
| 5 | `== != < <= > >=` | left |
| 6 | `+ -` (binary) | left |
| 7 | `* / %` | left |
| 8 | unary `-` | — |
| 9 | call `f(x)`, parentheses | — |

### 5.3 Semantics and coercion

- `+`: number+number adds; string+anything or anything+string concatenates
  using the string rendering of §4.1; list+list concatenates; any other
  combination is a fault (compile error when statically known).
- `- * %`: numbers only. `/`: numbers only; **division by zero is a runtime
  story fault**, reported like any other fault.
- `%` is truncated modulo (sign follows dividend).
- Comparisons `==`/`!=` compare values of the same type; **cross-type
  equality is `false`, not an error** (except list equality, which compares
  element-wise). Relational `< <= > >=` accept two numbers (numeric) or two
  strings (lexicographic, code-point order); mixing is a fault.
- `and/or/not` apply truthiness (§5.4) and return booleans; `and`/`or`
  short-circuit.
- Ternary `c ? a : b` evaluates `c` for truthiness.
- Truthiness table: `false`, `0`, `""`, `[]` are falsy; everything else
  truthy.

### 5.4 Built-in functions

| Call | Returns | Notes |
| --- | --- | --- |
| `visited(name)` | number | Times the player entered the passage named by the STRING `name` — quotes required: `visited("Market")`. |
| `seen(name)` | boolean | Same argument form: `seen("Market")`. True once count > 0. |
| `has(item)` | boolean | Inventory contains item. |
| `count(item)` | number | Inventory count of item. |
| `inv()` | list | Item names, sorted ascending. |
| `turns()` | number | Current turn number (starts at 1). |
| `random(a, b)` | number | Uniform integer in `[a, b]` inclusive, from the story RNG (§9). |
| `pick(list)` | value | Seeded uniform element. |
| `range(a, b)` | list | Integers `a .. b-1` (empty if `b <= a`). |
| `len(x)` | number | Length of string or list. |
| `upper(s)`, `lower(s)` | string | ASCII case folding. |
| `floor(n)`, `ceil(n)`, `abs(n)` | number | |
| `min(...)`, `max(...)` | number | ≥1 numeric args. |
| `str(x)` | string | Rendering per §4.1. |
| `num(s)` | number | Parses decimal string; fault if unparsable. |
| `bool(x)` | boolean | Truthiness. |

Unknown functions `TW007` (error); wrong arity or argument type (statically
known) `TW008` (error).

## 6. Variables and types

Variables hold one of: `number`, `string`, `boolean`, `list`. The type is
fixed at first assignment (frontmatter `vars:` or first `set`); later
assignment of a different type faults at runtime, or is `TW006` when the
compiler can prove it statically (literal assigned to known-typed variable).

The inventory is part of the world model, not a variable: items are strings
with counts ≥ 0; taking below zero or dropping absent items faults.

Flags are ordinary boolean variables; nothing special-cased.

### 6.1 Read-before-set analysis

The compiler performs a conservative may-be-unset analysis per passage entry
(frontmatter vars count as set). Reading a variable on a path where it may be
unset produces `TW005` (warning) naming the variable and location. At
runtime, reading a genuinely unset variable is a story fault.

## 7. Choice identity and consumption

Each choice gets a stable identity: `passageName#ordinal` (plain text, not
hashed) where
ordinal counts choices in source order within the passage. Consumed `once`
choices are recorded by identity in state. **Documented caveat:** editing a
passage's earlier choices invalidates old saves' consumed sets; acceptable
for v1 and stated in README.

## 8. Evaluation order (normative)

1. Story load: build passages; apply frontmatter `vars:` (typed from
   literals); initialise RNG (§9); `turn = 0`.
2. Enter `start`: `turn = 1`; `enter(P)` runs.
3. `enter(P)`: `visited[P] += 1`; then walk nodes in document order:
   - text/em/strong append; scene break appends;
   - interpolation appends rendering of value;
   - `if/elif/else`: first true branch walks; no branch, no output;
   - `for`: iterate snapshot; each iteration walks the body;
   - statements execute immediately in sequence;
   - `include`/macro call: walk the target's nodes inline (parameters bound;
     `visited` unchanged);
   - links/bullets do **not** execute; they register as pending choices.
4. After the walk, visible choices assemble: inline links (unless consumed),
   then bullets passing their `if`, in source order. Timers start now.
5. Choosing target `T`: snapshot current state onto the rewind stack **before
   mutation**; `turn += 1`; `enter(T)`.

Rewind pops the stack, restoring the exact prior serialised state, and
records a reader-action marker in the transcript. Rewind is a spoiler-free
undo affordance, not a diegetic mechanic; stories cannot detect it.

## 9. Determinism and RNG

The story RNG is `mulberry32`. Initial seed: frontmatter `seed` if present
(integer), else drawn from the host's random source at first launch and stored in
state. Every `random`/`pick` draw mutates the RNG word, which is part of saved
state. **Replaying the same choices from the same save reproduces identical
state** (asserted by state hash in tests). Stories must not read wall-clock
or external sources; the format provides none.

## 10. Compiler diagnostics catalog

Anatomy per DESIGN.md. Codes:

| Code | Severity | Meaning |
| --- | --- | --- |
| TW001 | error | Link targets unknown passage. |
| TW002 | error | Link target differs only by case from a real passage (suggests it). |
| TW003 | warning | Passage unreachable from start (structural graph, conditions ignored — stated approximation). |
| TW004 | note | Ending tagged passage not structurally reachable. |
| TW005 | warning | Variable possibly read before being set. |
| TW006 | error | Static type mismatch (assignment/argument/operator). |
| TW007 | error | Unknown function. |
| TW008 | error | Wrong arity or argument type for builtin/macro. |
| TW009 | error | Duplicate passage name. |
| TW010 | error | No start passage (missing and no default). |
| TW011 | error | Unbreakable include/macro recursion. |
| TW012 | warning | Suspicious escape inside logic (e.g. `\q`). |
| TW013 | error | Empty passage name. |
| TW014 | warning | Dead-end passage without `[ending]` tag. |
| TW015 | error/warning | Invalid choice attribute combo/value, or missing timeout fallback. |
| TW016 | warning/error | Frontmatter problem. |
| TW017 | note | Naming-convention suggestion (style lint). |
| TW018 | — | Reserved (was POV-drift lint; withdrawn before 1.0). |
| TW019 | note | Loop bound suspiciously large or non-constant. |
| TW020 | error | Parse/syntax error. |

Build fails (exit 1, no artifacts) on any `error`.

## 11. Safety

Story content is data, never code. When rendering to HTML, all interpolated
values and prose are HTML-escaped; emphasis maps to `<em>/<strong>`;
everything else is escaped. There are no script hooks available to authors.
Stories are single files, so there is no include-path traversal surface.
Export output paths are used exactly as the user supplies them on the command
line; unwritable or conflicting paths are reported as clean CLI errors. The
export embeds story text with `<`-escaped JSON so prose can never break out
of the document's script context.

## 12. Grammar (EBNF)

```ebnf
story       = [ frontmatter ] passage { passage } ;
frontmatter = "---", { fm-line }, "---" ;
fm-line     = key ":", value | indent-line ;
passage     = header, { blank }, { element } ;
header      = "==", name, [ tags ], [ params ], [ "==" ] , newline ;
tags        = "[", tag, { ws, tag }, "]" ;
params      = "(", ident, { ",", ident }, ")" ;
element     = blank | comment | statement | block | choiceline | prose-line ;
comment     = "%%", rest-of-line ;
statement   = "~", ( set | unset | take | drop | push ) ;
block-if    = "{{if", expr, "}}", { element },
              { "{{elif", expr, "}}" , { element } },
              [ "{{else}}", { element } ], "{{end}}" ;
block-for   = "{{for", ident, "in", expr, "}}", { element }, "{{end}}" ;
include     = "{{include", name-ref, "}}" ;
macrocall   = "{{", name-ref, "(", [ arg, { ",", arg } ], ")}}" ;interp      = "{{", expr, "}}" ;
choiceline  = "*", [ "(", attrs, ")" ], text, "->", target, newline
            | prose-inline-links ;
link        = "[[", [ display, ( "->" | "<-" ) ], target,
              [ "|", attrs ], "]]" ;
expr        = ternary ;
(* levels per §5.2 *)
```

Prose-line lexing is contextual: the scanner reads text until it meets `{{`,
`[[`, a `~`/`* ` at line start, or EOF; ambiguity is resolved in favour of
literal prose (e.g. a lone `{` or unmatched `[[` stays literal). The full
lexer/parser implementation notes and test fixtures live beside the code;
this EBNF plus §1–§6 is normative.

## 13. Worked examples

See DESIGN.md Part II for the complete simple and complex example passages;
both files are also compiled as fixture tests verbatim.
