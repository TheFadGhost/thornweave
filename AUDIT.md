# AUDIT.md

Pre-1.0 audits, run by agents that wrote none of the audited code.
Findings were fixed before tagging v1.0.0 unless marked otherwise.

## 1. Code audit

Suite at audit time: 159 pass / 0 fail.

### Blockers — fixed
- Export HTML script breakout: story text embedded via `JSON.stringify` could
  contain `</script>`. Fixed by `<`-escaping (`\u003c`) plus `\u2028/\u2029`
  in `src/export/bundle.js`; SPEC §11 updated to state the guarantee.
- Checker's unknown-frontmatter pass read `story.metaUnknown`, but the parser
  nests it under `story.meta.metaUnknown` — dead code guarded by an impossible
  hand-built fixture. Fixed both; new pipeline-level test routes through
  `parseStory`.

### Major — fixed
- Analyzer and checker computed reachability differently (include edges only
  in one). Single shared edge model now: nav edges, timeout edges, include /
  macro-call edges.
- Unknown function call crashed with `TypeError` instead of a runtime fault
  when `callMacro` was absent. Now faults with "unknown function".
- UTF-8 BOM silently deleted the first passage (Windows-hostile). Stripped in
  `parseStory`.
- `--port abc/-1/70000` fell back silently or threw raw RangeError. CLI now
  validates integer 1–65535; `--seeds` validated 1–100000.
- Unwritable export path threw uncaught `EEXIST`. Clean CLI error now;
  SPEC §11 claim about path validation reconciled with reality.

### Minor — fixed
Dead code removed (`cyan` double definition, tautological guard, unreachable
buffered-statement branch); unused exports deleted (`parseExpressionText`,
`sourceLines`, `builtinNames`); `SaveManager.load` now uses the shared
`stateMatchesStory` instead of re-implementing it, and separates envelope vs
state parse errors; corrupt-save validation covers numeric fields;
`engine.choose` rejects fabricated choice objects; `(once)` choices inside
`for` loops get per-iteration identities (`id#i.j`) so taking one copy no
longer consumes every copy; static file server prefix check requires a path
separator after ROOT; watch-mode watcher handle closes on server close;
URL base uses a fixed host (IPv6 Host header no longer mangles parsing);
postfix-call parser no longer constructs-before-throwing.

### Minor — accepted, documented
- Transcript lines/DOM grow unbounded for very long sessions; reader sections
  are append-only by design (the reading contract). Rewind is capped at 50.
- Choice identity remains ordinal-based (documented save caveat).
- tmLanguage grammar has cosmetic drift from the parser on scene-break
  spacing and whole-line statement scoping.
- TW018 withdrawn; catalog marks it reserved.

## 2. Authoring-ergonomics audit

A writer agent, given only README.md and docs/SPEC.md, authored and shipped a
14-passage / 484-word probe story to zero diagnostics. Findings fixed:

- `visited("Market")` string argument never shown → examples added to README
  and SPEC §5.4; checker now emits targeted help ("passage names are strings
  here…") when a bare identifier appears inside `visited()`/`seen()`.
- Inline-link attributes had no complete example → full examples added; a
  bullet containing `[[…]]` or `|attrs` residue now produces a dedicated
  syntax hint instead of a misleading broken-link error.
- `drop` count form undocumented → documented (SPEC §4.2, README).
- Frontmatter vars style contradiction (`=` vs `:`) → SPEC states both are
  equivalent.
- Start-passage default wording aligned with implementation (first non-macro
  passage).
- EBNF `macrocall` line verified correct as written (terminals, not braces).

Verdict recorded: writers can ship on README+SPEC alone.

## 3. Design & accessibility audit

Contrast: all four themes pass WCAG floors for every required pair
(ink/bg ≥ 7, muted/link/link-visited/countdown ≥ 4.5, focus ≥ 3). Locked in
as a permanent test, `tests/design/contrast.test.js`.

Fixed findings:
- **Number keys could fire the wrong choice** when consumed choices were
  listed: activation now maps the displayed number (`data-num`) directly.
- **"(already taken)" was invisible to screen readers**: the annotation is now
  part of each button's accessible name.
- Error banners now render above the prose.
- Esc closes drawers and restores focus to the opener.
- New reading preference: "Scroll to new passages" (persisted), completing
  the stated scroll contract alongside reduced-motion handling.
- In-place re-renders preserve focus inside the section being rebuilt.
- Countdown announcement names the choice and what expiry means.
- Transcript entries match the DESIGN format (`Turn N — Passage — "choice"`),
  DOM pruned past 400 entries, history sealing made incremental (was O(n²)).
- Offline export applies the stored theme before first paint.

Verified clean: keyboard-only playthrough path end-to-end; live-region
semantics; timer settings off/normal/long honoured; every CSS transition
disabled under `prefers-reduced-motion`; zero network references in the
offline artifact (network APIs replaced by throwing stubs at bundle time);
measure clamp, hit areas, focus rings, scales, and the banned list all conform.

## Final gate

Full suite 159/159 · example story compiles clean · walker over 500 seeds:
no crashes, no dead ends, all seven endings reached · fingerprint stable.
