# PLAN.md — Thornweave

An interactive fiction engine for writers: a plain-text authoring format, a
compiler with real diagnostics, a quiet reading player, analysis tools, and one
complete original example game.

## Product definition (one sentence)

Thornweave lets a writer branch a story in plain, diffable text files and gives
readers a calm, accessible place to play it.

## Non-goals (second products, permanently out)

A visual node-graph editor; multiplayer or shared-story modes; an asset
pipeline for images/audio; a publishing platform with accounts or hosting.

---

## Feature ideation log

Each idea was judged against three tests:

1. Does it serve the core purpose — writing and playing branching fiction?
2. Can it be finished to the same quality bar as the core?
3. Does it avoid expanding scope into a second product?

### Accepted

| Idea | Why accepted |
| --- | --- |
| `thornweave init` scaffolding | Removes blank-page cost; first compile within a minute of install. |
| TextMate grammar for editor highlighting | One JSON file; writers live in editors; cheap, high value. |
| Error messages that suggest fixes | A compiler writers trust is a compiler they keep using; diagnostics are already a core deliverable. |
| Style/consistency lint (POV drift, naming conventions) | Reuses existing parse + passage metadata; catches real authoring mistakes. |
| Branching statistics (fan-out/fan-in, depth) | Same graph data as reachability analysis; helps writers balance stories. |
| Player accessibility (keyboard play, screen-reader announcements, timer controls) | Interactive fiction has a substantial blind readership; this is core player quality, not extra scope. |
| Reading preferences (font size, measure, line height, theme) | A reading product earns them; pure token overrides over the theme system. |
| Onboarding tutorial story in `init` output | Teaches format by example inside the artifact authors already open. |
| Deterministic seeded RNG in the runtime | Enables replay tests and fair random-walk QA; small, contained. |
| Transcript export | Writers need to see real playthroughs; reuses renderer. |
| Rewind/history | Asked-for player affordance with a stated spoiler rule; bounded snapshots are simple. |

### Rejected

| Idea | Why rejected |
| --- | --- |
| Visual node-graph editor | Second product; a GUI editor is a project of its own. |
| Multiplayer / shared-story mode | Second product; conflicts with deterministic single-reader model. |
| Image/audio asset pipeline | Second product; text-first reading is the identity. |
| Publishing platform with accounts | Second product; hosting/auth/abuse surface we cannot finish well. |
| Plugin/macro extension API for third parties | Stability contract we can't honor pre-1.0; format evolution would break plugins. |
| Cloud sync of saves | Requires accounts (rejected above); localStorage covers sessions. |
| Mobile app packaging | Distribution burden; the offline HTML export already plays anywhere. |
| Live co-authoring/collaboration editing | Second product; git already handles writer collaboration. |
| Custom CSS injection per story | Escape hatch invites broken layouts we'd have to support; themes suffice for v1. |
| Achievements/meta-progression layer | Game-design feature creep unrelated to branching fiction writing. |

Accepted items become first-class FEATURES below and go through the same
build loop and audit as everything else.

---

## FEATURES (v1.0.0 scope)

1. **Authoring format** — `.thorn` plain text; passages, links, conditional
   text, variables, inline expressions; readable and diffable. Grammar in
   `docs/SPEC.md` written before implementation.
2. **Story logic** — typed variables (number/string/boolean/list), arithmetic,
   boolean and ternary expressions, conditionals, bounded loops (`for`),
   includes/macros with parameters, stated evaluation order.
3. **State & world model** — inventory with counts, stats as visible numeric
   variables, visited tracking, turn counter, flags as boolean variables; fully
   serializable.
4. **Save/load** — six named slots plus autosave; rewind stack (bounded) with
   the stated rule: *rewind is a spoiler-free undo of recent choices, not a
   diegetic mechanic; the transcript records it as a reader action.*
5. **Choice mechanics** — conditional choices, one-time (`once`) choices,
   timed choices with text countdown and accessibility settings, hidden
   choices revealed by state.
6. **Compiler diagnostics** — broken links, case-mismatched links,
   unreachable passages, read-before-set variables, static type mismatches,
   include cycles / unbounded-loop risk, missing start, dead ends; each with
   file, line, column, caret, help line; build fails on error.
7. **Analysis tools** — graph export (JSON), word counts per passage and per
   path, endings list with structural reachability plus observed reachability
   from the walker, longest/shortest path report (method stated).
8. **Player runtime** — reading interface with measure control, choice list,
   status/inventory panel, transcript view, text reveal options (off by
   default), themes, save UI.
9. **Author tooling** — live-reload preview, jump-to-passage debug mode, state
   inspector/editor, random-walk playtester over seeds.
10. **Export** — self-contained offline HTML with zero network requests
    (verified by scan and runtime hook), plus plain-text transcript export.
11. **Example game** — one complete original story, multiple endings,
    meaningful state, general-audience content, written against the spec by an
    author-agent that did not build the engine.

## Build loop policy

Per feature: implement → run → play → test → fix → commit → push. Done means
the example game plays correctly through its branches. Each regression round
names the defect it fixes; after 6 consecutive rounds with no new named
defect, state is logged in `BLOCKERS.md` and work moves elsewhere.

## Regression gate

Before any change is accepted: full test suite, example game compiles, manual
playtest of main branches, random-walk playtester over ≥200 seeds. Parser fixes
must not break any passage of the example game; runtime changes must not alter
recorded transcript outcomes unless intended and recorded here.
