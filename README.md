# Thornweave

> **built with ox alpha**
>
> most of this was written in august 2026 during the free preview window of
> [ox alpha](https://openrouter.ai/stealth/ox-alpha), an anonymous stealth model
> that turned up on openrouter for about a week. i set the direction and reviewed
> what came back. the tests are real and they pass — clone it and run them.

An interactive fiction engine for writers: branch your story in plain,
diff-friendly text files, compile it with real diagnostics, and give readers
a calm place to play it. You write prose; Thornweave handles the branching.

Requires only Node.js 18+. Zero runtime dependencies.

## Install

```sh
git clone https://github.com/TheFadGhost/thornweave.git
cd thornweave
node bin/thornweave.js --help
```

Every example below assumes you are in the repository root; substitute
`thornweave` wherever you have it on your PATH.

## Commands

```sh
thornweave init mystory            # scaffold a commented starter story
thornweave compile story.thorn     # check; exits non-zero on errors
thornweave play story.thorn        # reading server at http://localhost:7337
thornweave watch story.thorn       # same, plus live-reload on save
thornweave analyze story.thorn     # endings reachability, paths, stats
thornweave walk story.thorn --seeds 300   # random-walk QA over seeds
thornweave export story.thorn -o game.html  # self-contained offline HTML
```

`--json` gives machine-readable stdout on `compile`, `analyze`, and `walk`.
`--no-color` forces plain output for CI.

## The format (.thorn)

A story is one UTF-8 text file: optional frontmatter, then passages. The
full grammar lives in [docs/SPEC.md](docs/SPEC.md); this section teaches the
whole language you need.

### Frontmatter

```thorn
---
title: The Lantern Room
author: A. Writer
start: Arrival          # optional; default is the first passage
show: nerve, oil        # variables shown in the player status panel
vars:
  nerve: 3
  oil: 2
---
```

### Passages, links, choices

Passages start with a header and hold prose. Links look like
`[[display -> Target]]`; `[[Target]]` uses the name as display text.

```thorn
== Arrival ==
The ferry leaves you at the pilings with wet boots.

[[Climb the stair -> Stair]]
```

Bulleted choices carry attributes:

```thorn
== Stair ==
The steps creak in a familiar rhythm.

* (once) Search the drawer -> Drawer
* (if has("key")) Unlock the lamp room -> LampRoom
* (time=8, timeout -> Dusk) Wait for dawn -> Dawn
* Go back down -> Arrival
```

- `(once)` — the choice is consumed permanently once taken.
- `(if expr)` — hidden unless the expression holds.
- `(time=N)` — an N-second countdown starts when the passage renders;
  `(timeout -> X)` says where expiry sends the reader. Players can extend or
  disable timers in settings.

### Logic

Logic reads as stage directions between sentences.

```thorn
~ set oil = oil - 1          %% statements run where they appear
~ take "brass key"
~ drop "coin", 2          %% counts optional on take/drop, default 1
~ push log "the wick caught"

You have {{oil}} measures of oil.          {{oil}} interpolates

{{if oil > 0}}
The flame stands tall.
{{else}}
The dark is patient.
{{end}}

{{for item in inv()}}
- {{item}}
{{end}}

{{include Signpost}}         %% splice another passage inline
{{Wound(2)}}                 %% call a macro: == Wound(level) ==
```

### Expressions

Numbers, `"strings"`, true/false, `[lists]`, comparisons (`== != < <= > >=`),
arithmetic (`+ - * / %`), boolean words (`and or not`), ternary (`cond ? a : b`),
and parentheses. `+` concatenates when either side is a string. Division by
zero is a reported fault, not a silent zero. Conditions use truthiness:
`0`, `""`, `[]`, and false are falsy.

Built-in functions:

| Function | Returns |
| --- | --- |
| `visited("name")` / `seen("name")` | how many times the reader entered that passage (string argument — quotes required); `seen` is true once count > 0 |
| `has("item")` / `count("item")` | inventory query |
| `inv()` | sorted list of carried item names |
| `turns()` | current turn number |
| `random(a, b)` / `pick(list)` | seeded draws — replays are deterministic |
| `range(a, b)` / `len(x)` / `upper(s)` / `lower(s)` | lists & strings |
| `floor(n)` / `ceil(n)` / `abs(n)` / `min(...)` / `max(...)` | numbers |
| `str(x)` / `num(s)` / `bool(x)` | conversions |

Variables are typed at first assignment (number, string, boolean, list) and
keep that type; mismatches are compile errors where provable, faults otherwise.

Inline links can also carry attributes inside their brackets:

```thorn
[[Wait where you are -> Hold | time=8, timeout -> Dusk]]
[[Search the drawers -> Drawers | once]]
```

### A complete tiny story

This compiles and plays as-is:

```thorn
---
title: Two Coins
start: Road
vars:
  coins: 2
---

== Road ==
You have {{coins}} coins and a long road behind you.

{{if coins >= 2}}
The tollkeeper nods you toward the bridge.
[[Pay the toll -> Bridge]]
{{else}}
The tollkeeper shakes her head.
[[Look for another way -> Shore]]
{{end}}

== Bridge [ending] ==
The far bank opens ahead of you. The road is yours.

== Shore [ending] ==
You follow the water until it forgets your name.
```

## Writing and testing a story

1. `thornweave init mystory` — read the generated file; it is playable.
2. `thornweave watch mystory\mystory.thorn` — keep it open while you write.
3. `thornweave compile ...` until clean. Diagnostics point at file, line and
   column with a caret and suggest fixes:

```
error[TW001]: link points to passage 'Staire', which does not exist
  --> stories/lantern.thorn:14:3
   |
14 | [[Climb the stair -> Staire]]
   |    ^^^^^^^^^^^^^^^^
   |
help = 'Staire' is not defined. Did you mean 'Stair' (line 20)?
```

4. `thornweave analyze ...` — see every ending, whether it is reachable, the
   shortest and longest routes, and word counts per passage.
5. `thornweave walk ... --seeds 300` — automated random plays. The walker
   reports crashes, dead ends without an `[ending]` tag, and any declared
   ending it never reached. Treat missed endings as findings: either open a
   path to them or accept that they need deliberate play.
6. `thornweave export ... -o game.html` — one HTML file that runs offline.
   The build removes network capability outright rather than promising not to
   use it.

## Player features

Themes (light/dark/sepia/high-contrast) with AA contrast, font size and line
height controls, keyboard play (number keys choose, `B` steps back, `S`
status, `T` transcript, `G` settings), six save slots plus autosave, bounded
rewind (an undo of recent choices, not a story mechanic), a full transcript
with plain-text download, screen-reader announcements of new text, and timer
settings including off. Saves live in your browser's local storage and bind
to the story's content fingerprint — loading a save against an edited story
is refused cleanly.

## Architecture note

A compiler produces a story IR plus diagnostics; a separate pure runtime
interprets the IR against serializable state. The player, the offline export,
the walker, and the analyzers all sit on those two pieces — there is no
hidden second implementation. Determinism is a contract: the RNG seed lives
in the save, so the same choices from the same save reproduce the same state.

## Development

```sh
node --test tests/syntax/parser.test.js tests/compiler/checker.test.js # etc.
```

The format specification ([docs/SPEC.md](docs/SPEC.md)) precedes the code and
is normative; design decisions live in [docs/DESIGN.md](docs/DESIGN.md),
scope history in [PLAN.md](PLAN.md).

## License

[MIT](LICENSE)