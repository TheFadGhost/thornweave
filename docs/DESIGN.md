# DESIGN.md — Thornweave

Design precedes feature code. This document is the contract the player UI,
themes, format tooling, diagnostics, and CLI are built against. Where an
implementation deviates, the implementation is wrong.

## Point of view

Thornweave serves two people at one desk: a reader who wants nothing between
them and the prose, and a writer who wants nothing between them and the
sentence they are typing. For the reader, Thornweave is a quiet room: one
column of well-set text, choices that wait patiently at the end of it, and no
chrome that moves, glitters, or begs. The story is the only thing on screen
that matters. For the writer, Thornweave is a hand tool: a plain-text format
that looks like their manuscript, a compiler that speaks precisely about what
is broken and where, and analysis that answers "what does my story look like?"
without asking them to learn a programming language first. Everything in this
document follows from those two commitments.

---

## Part I — The reading experience

### Reading typography

| Property | Value |
| --- | --- |
| Prose face | `Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif` |
| UI face | `system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` |
| Prose size (default) | `19px`, reader-settable 16–24px in 1px steps (`--reader-font-size`) |
| Line height (default) | `1.65`, reader-settable 1.4–2.0 (`--reader-line-height`) |
| Measure | **62–68 characters**, enforced: `max-width: min(66ch, 100% - 48px)` on the prose column at every viewport width; never wider than 68ch, never clipped on small screens (gutters collapse to 24px total) |
| Paragraph spacing | `0.95em` between paragraphs; no first-line indents |
| Emphasis | `<em>` italic, `<strong>` weight 600; no colour-as-emphasis in prose |
| Scene break | centred `· · ·` with extra space above/below |

No webfonts are loaded. This is what makes the offline export genuinely
offline and keeps reading start instant.

### How new text arrives

New passage text is appended below the previous passage — the reader never
loses their place. Scroll behaviour, stated exactly:

1. Content is inserted immediately; there is no animation that delays reading.
2. If the reader is at (or within 80px of) the bottom, the page scrolls so the
   new passage's heading sits at the top of the viewport. The scroll is a
   300ms ease-out transform-free scroll, skipped entirely when
   `prefers-reduced-motion: reduce` or the reader turned scrolling off.
3. Keyboard/screen-reader users: focus moves to the new passage heading
   (`tabindex="-1"`), and an `aria-live="polite"` region announces
   "Passage title" followed by its text.
4. Optional per-passage fade-in of 160ms opacity only; off by default in the
   High Contrast theme and always disabled under reduced motion. Typewriter
   reveal exists only as an explicit opt-in setting, never a default.

### Choices

Choices are visually separated from prose by a hairline rule and generous
space (32px above). They are an ordered list — numbered because number keys
work.

- Container: `<ol>` inside `<nav aria-label="Choices">`; each choice a `<li>`
  wrapping a full-width `<button>`.
- Hit area: minimum 44px height, full column width, text left-aligned;
  12px vertical padding.
- Hover: background shifts to `--choice-hover`; cursor pointer.
- Focus: `2px` solid `--focus` ring offset by 2px, always visible; focus is
  never removed or suppressed.
- Number shortcuts: keys `1`–`9` activate choices; the number is shown as a
  small muted marker before the text.
- A consumed one-time choice renders struck-through in `--ink-faint` with an
  audible/sr annotation "(already taken)" and `disabled`; it stays listed so
  history feels stable rather than vanishing.
- A conditionally hidden choice is not rendered at all — absence is silence,
  not a locked badge.
- Timed choices show a **text countdown** (`· 7s`) updated once per second,
  plus a 2px depleting bar under the button. Under reduced motion the bar is
  hidden and the text countdown remains. Timer settings: Off / Normal / Long
  (double duration). When timers are off, timed choices behave like ordinary
  choices. Nothing flashes, shakes, or changes colour urgently; the countdown
  informs, it does not alarm.

### Status & inventory panel

An aside, never an overlay. At ≥1000px it is a 264px right rail beside the
prose column (the prose keeps its measure; the layout reserves space, the
column never squeezes below 62ch). Below 1000px it collapses into a
`<details>` element above the prose, closed by default. Contents: shown
variables (declared `show:` in story frontmatter) as a definition list, and
the inventory with counts. Toggle: `S`. It shares the theme tokens and never
competes typographically with prose (UI face, smaller size, muted ink).

### Transcript view

A drawer toggled with `T`, listing every passage entered and every choice
taken in order (`Turn 12 — Crossroads — "Take the lantern"`), plus rewind
events marked as reader actions. Buttons: Copy, Download `.txt`.

### Type & spacing scales

Type scale (ratio 1.2): `12, 14.4, 17.3, 20.7, 24.9, 30` px → tokens
`--fs-0 … --fs-5`. Spacing scale (base 4): `4, 8, 12, 16, 24, 32, 48, 64` →
tokens `--sp-1 … --sp-8`. Radii: `--radius-1: 4px`, `--radius-2: 8px`.
Border widths: 1px standard, 2px focus.

### Colour tokens by role

All colours are CSS custom properties on `[data-theme]`; no hardcoded colours
anywhere in components. Themes: `light`, `dark`, `sepia`, `contrast`.

| Token | Role | light | dark | sepia | contrast |
| --- | --- | --- | --- | --- | --- |
| `--bg` | page background | `#fbfaf7` | `#191714` | `#f3e9d6` | `#ffffff` |
| `--surface` | panels, drawers | `#f1ede4` | `#211e1a` | `#eadfc6` | `#ffffff` |
| `--surface-2` | hover wells | `#e7e1d3` | `#2a2620` | `#e0d2b4` | `#efefef` |
| `--ink` | body text | `#26221b` | `#e9e3d7` | `#3b3223` | `#000000` |
| `--ink-muted` | secondary UI text | `#5d564a` | `#a99f8e` | `#6d5e47` | `#333333` |
| `--ink-faint` | consumed/disabled | `#8b8374` | `#736b5d` | `#98876c` | `#555555` |
| `--link` | choice/link text | `#96371c` | `#eda06f` | `#8c4318` | `#00304f` |
| `--link-visited` | visited targets | `#6e2a12` | `#c98d64` | `#693310` | `#00263d` |
| `--focus` | focus rings | `#0f6b4f` | `#82d0ab` | `#11594a` | `#b45309` |
| `--border` | hairlines | `#d9d2c2` | `#3a352c` | `#d5c5a4` | `#000000` |
| `--danger` | errors | `#a12622` | `#e58a86` | `#8f2521` | `#a10000` |
| `--success` | confirmations | `#256d46` | `#8ccfa8` | `#215c3c` | `#005e2f` |
| `--countdown` | timer bar/text | `#8a5a10` | `#d9b25e` | `#7d5210` | `#8a5a00` |

Links are always underlined in prose; choices are underlined on hover/focus
only. Contrast requirements verified by test: `--ink`/`--bg` ≥ 7:1,
`--ink-muted`/`--bg` ≥ 4.5:1, `--link`/`--bg` ≥ 4.5:1 in both unvisited and
visited states, countdown token ≥ 4.5:1, in **all four themes**. High
Contrast uses pure borders (no tints) and disables fades.

### Motion rules

Bias: minimal motion during reading. All transitions ≤200ms; only `opacity`,
`background-color`, `border-color` animate. No parallax, no slides, no scale.
`prefers-reduced-motion: reduce` disables the fade-in, the smooth scroll, the
timer bar animation, and any remaining transitions.

### States

- **Empty** (no story loaded): centred, two sentences of muted text and the
  command that loads one. No illustration.
- **Loading**: three static placeholder rules where paragraphs will be — no
  shimmer, no spinner.
- **Error** (story failed to compile / runtime fault): inline banner above the
  prose, `role="alert"`, diagnostic text in the compiler's anatomy (below),
  plus Retry and Step back where meaningful. Prior state is preserved.
- **Ending**: the final passage renders normally; beneath it a quiet end card:
  "The End", the ending's name if tagged, and Restart / Step back / Download
  transcript. No confetti, no modal.
- **No save in slot**: the row reads "Empty" and stays enabled; loading an
  empty slot does nothing and says so politely.

### Accessibility commitments (audited)

Keyboard-only playthrough possible end to end; visible focus everywhere; live
region announcements of new passages; choices as a labelled list; text
countdowns plus timer extension/disable settings (a hard timer is an access
barrier); AA contrast in all themes and states; reduced-motion honoured;
unicode and long words render correctly (`overflow-wrap: anywhere` on
transcript, `hyphens: none` in prose); offline export performs zero network
requests (verified).

---

## Part II — The authoring format as a design artefact

### Principle

A writer must be able to write plain prose with no ceremony. Markup is
invisible until logic is needed. A `.thorn` file should read like a
manuscript: headers mark passages, prose flows in paragraphs, and the logic —
when it appears — lives in double braces that read as stage directions, not
syntax. The file must remain friendly to git diffs: one statement per line
where practical, no significant trailing whitespace, stable ordering.

### The shape of a story

```
---
title: The Lantern Room
author: A. Writer
start: Arrival
show: nerve, oil
vars:
  nerve: 3
  oil: 2
---

== Arrival [start] ==
The ferry leaves you at the pilings with wet boots and one instruction:
keep the light burning.

~ set toldName = false

[[Climb the stair -> Stair]]
```

- Frontmatter (between `---` fences) holds metadata, starting variables, and
  the `show:` list for the status panel.
- `== Name ==` opens a passage; `[tags]` are space-separated in square
  brackets (`start`, `ending`, free-form tags).
- `[[display -> Target]]` is a link; `[[Target]]` is shorthand when display
  and target match. Attributes ride after the target: `[[Wait -> Hold |
  once]]`, `[[Grab -> Grab | time=7]]`.
- `{{ ... }}` is logic: expressions interpolate (`{{oil}}`), statements act
  (`~ set oil = oil - 1` lines), blocks structure text
  (`{{if}}/{{elif}}/{{else}}/{{end}}`, `{{for x in expr}}…{{end}}`),
  `{{include Name}}` splices another passage.
- `%%` starts a comment line. Backslash escapes `\{`, `\[[`, `\\`.

### Complete simple example (verbatim valid)

```
---
title: Two Coins
start: Road
vars:
  coins: 2
---

== Road ==
You have {{coins}} coins and a long road behind you.

{{if coins >= 2}}
The tollkeeper nods you through.
[[Pay the toll -> Bridge]]
{{else}}
The tollkeeper shakes her head.
[[Count your coins again -> Road]]
{{end}}
```

### Complete complex example (verbatim valid)

```
---
title: The Orchard Audit
author: Example
start: Gate
show: apples, day
vars:
  apples: []
  day: 1
---

== Gate [porch] ==
Day {{day}}. The ladder leans where you left it.

~ set day = day + 1

{{for basket in apples}}
- Basket of {{basket}}.
{{end}}

{{if count("windfall") > 0}}
The windfalls fill a crate at your feet.
{{include LadderNote}}
{{end}}

* (once) Search the windfall crate -> Crate
* (if day > 3) Write in the ledger -> Ledger
* (time=8, timeout -> Dusk) Climb the tall tree -> TallTree
* Walk the fence line -> Fence

%% everything above is valid; the walker plays it headlessly

== LadderNote ==
Someone chalked RUNGS on the third rung. Someone always does.
```

Choice bullets (`*`) carry attributes in parentheses: `(once)`, `(if expr)`,
`(time=N)` with optional `(timeout -> Passage)`. Inline `[[links]]` and
bulleted choices both create graph edges.

### Compiler diagnostic anatomy

Every diagnostic prints: severity, code, message, `file:line:col`, the source
line with a caret under the offending column, and a Help line suggesting the
fix. Machine-readable mode emits the same fields as JSON.

```
error[TW001]: link points to passage 'Staire', which does not exist
  --> stories/lantern.thorn:14:3
   |
14 | [[Climb the stair -> Staire]]
   |    ^^^^^^^^^^^^^^^^
   |
help = 'Staire' is not defined. Did you mean 'Stair' (line 20)?
```

Severities: `error` (build fails, no output written), `warning` (suspicious,
build succeeds), `note` (informational). Exit codes: `0` clean/warnings,
`1` errors, `2` usage failure.

### CLI output design

Colour roles (TTY only, auto-disabled otherwise): headings bold; `error`
prefix red; `warning` prefix amber; `note` dim; help lines cyan; success
lines green; file paths underlined. Non-TTY output is plain ASCII, one
diagnostic per block exactly as above, no colour codes ever — CI-safe.
Progress (walker seeds, exports) writes a single updating line on TTY and
nothing until completion otherwise. `--json` switches human output for
stable JSON on stdout; diagnostics go to stderr.

### Explicitly banned (checked in audit)

purple-blue gradients · glassmorphism · emoji as choice markers or UI icons ·
default framework indigo · drop shadows on every choice button · typewriter
reveal as default · parchment textures/blackletter fonts · fantasy-game chrome
· any transition between passages that delays reading.
