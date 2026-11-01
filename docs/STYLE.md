# Mono — style guide

The rules every screen follows. Values live as tokens in `src/styles/tokens.css`; screens use the tokens, never their
own numbers for these things.

## Layout

| Token | Value | Use |
|---|---|---|
| `--page-pad` | 32 px (20 px on screens under 700 px tall) | Screen edge → content, all four sides, on **every** full screen and sheet |
| `--gap-major` | 40 px | Between the display and the main column (Home) |
| `--gap-block` | 16 px | Between stacked blocks in a column (e.g. live header → display → buttons) |
| `--radius-display` | 26 px | The brown display |
| `--radius-card` | 22 px | Cards (carousel side cards) |
| `--radius-tile` | 20 px | Action tiles, Save |
| `--icon-hit` | 48 px | Icon buttons in the header cluster |

- **The primary action is bottom-right, in the same place on every screen.** Brew, Stop and Done share position and
  size; a sheet's Save sits on the same right edge. Tested in `shot.spec.ts` and `sheets.spec.ts`.
- **Header icons are one cluster, top-right**: Profiles, History, Sleep, Settings. No free-floating pills.
- Screens fill the window: fixed-height parts (headers, button rows) are fixed; the display takes the rest, and charts
  size themselves to it. Checked at 1024 × 600, 1194 × 834 (design size) and 1920 × 1200.

## Components

| Component | Size | Notes |
|---|---|---|
| Quiet action tile (`.tile`) | `--tile-w` 96 × `--tile-h` 112 | Steam, Water, Flush, Next. 9×9 dot icon + mono caps label |
| Primary action tile (`.primary`) | `--primary-w` 200 × 112 | Brew, Stop, Done. Brown, white icon + label |
| Tile row (`.tile-row`) | gap `--tile-gap` 12 | Any row of tiles |
| Icon button (`.icon-button`) | 48 × 48 | 27 px dot icon, brown |
| Sheet | full width, from the bottom | Handle, content, footer with Cancel + Save; dismiss by Cancel, scrim, swipe down, Esc |
| Running modal | 720 × 504, on the display grid | Steam / water / flush; only Stop or the machine ends it |
| Chip / pill (`.chip`, `.pill`) | 44 high (chips), 48 (pills) | Filters, row actions, choices with 3+ options (`role="radio"` when picking one) |
| Segmented choice (`.ed-seg`) | 44 high buttons | Two options only; more become chips |
| Switch (`.switch`) | 58 × 34, in a 56+ high row | On/off settings; the row is the hit target |
| Settings card (`.set-card`) | half width, or `wide` | Eyebrow + title, then rows split by `--rule` lines |
| Machine message | 639 × 441, on the display grid | Refill, cleaning / descaling / emptying (Stop), firmware updating, machine error (Got it) |
| Connection banner | 44 high dark pill | Heads the toast stack, top centre, after 1.5 s without Decaid or the machine |
| Scrims | — | White cards (sheets, confirmations) sit on a dark scrim; brown machine messages (running, refill) sit on a pale scrim (white 84 %) that washes the screen out, so the message is the only brown surface |

## Type

| Role | Face | Used for |
|---|---|---|
| The machine | Doto (dot matrix), 700 | Short emphasised words and numbers only: live values, machine state, message titles. Never sentences, descriptions or toasts |
| The person | Newsreader (serif), 400 | Names, set targets, notes |
| Labels | IBM Plex Mono, caps, 0.06 em | Labels and action text |

- No bold, except the editor's group names (semibold). Italic only for provenance ("by Decent").
- **Time and weight are always the same size** — one size fitted to their space.
- Missing values show `--` (reads as an LCD "no value").
- **Dot-matrix sizes come from one scale** that matches the display grid. Doto's dots are 1/10 of the font size
  apart, so: `--dots-xl` 90 px (9 px dots — the grid's own pitch), `--dots-m` 45 px (½), `--dots-s` 30 px (⅓),
  `--dots-xs` 18 px (⅕). Hero numbers 90, modal title and readings 45, readouts 30, status lines 18.
  Fitted numbers step down the scale; no other Doto sizes.

## Colour

| Token | Value | Use |
|---|---|---|
| `--ground` | #FFFFFF | Background |
| `--ink` | #171412 | Type; pressure on charts |
| `--taupe` | #857160 | Labels |
| `--brown` | #7A5636 | Actionable / primary |
| `--beige` / `--beige-soft` | #EFE6D7 / #F6F1E9 | Selected state, quiet surfaces, tile borders |
| `--display` | #3A2A1F | The brown display (live data only) |
| `--display-cream` | #EDE3D2 | Type and dots on the display |
| `--accent` | Crema #C98B2B (setting: Rust, Slate blue, Teal) | Flow on charts only |

## Iconography

- **Icon dots**: 3 px apart (3 × 3 per 9 px grid cell), radius 1.08 px, for every icon. Icons are designed on
  9 × 9 dots, so they are 27 px — 3 grid cells.
- **Primary action tile** (Brew, Stop, Done): the same 9 × 9 designs with 4.5 px dots (2 × 2 per cell), 40.5 px,
  so the dots stay distinct instead of merging into a solid shape.
- An icon is never resized by squeezing or stretching its dots. A different size means a different design with more
  or fewer dots at the same spacing.
- On the display, an icon's top-left sits on a grid point, so every third icon dot is a background dot.
- Running-modal icons animate at 2 fps, 4 frames, same dots.

## Dots and charts

- **Dots always sit on a grid; one dot pitch per surface.** Every chart uses the 9 px pitch, on the display or on
  white. Ruler ticks are 27 px apart (3 cells); pager dots 18 px.
- **Dot drawings on the display are pinned top-left**: their offset from the display's corner is a whole number of
  9 px steps (padding, column widths and gaps are multiples of 9; heights above them are whole rows). They grow to
  the right and downward in whole dots; spare space goes where there are no dots. Never centre or right-align a dot
  drawing on the display. Checked at four screen sizes by GLB-27.
- Pressure in ink, flow in the accent. A profile on its own is drawn solid; during or after a shot, the plan the shot
  didn't reach is ghosted.
- Where flow lands on a pressure dot, the flow dot keeps a 1 px ring of the pressure colour (its fill shrinks by
  half a pixel, so the dot stays the same size), so both series show.
- Large charts: soft trail (opacity 1 / 0.18 / 0.08 / 0.03). Compact charts: lit matrix.
- The y axis shows pressure values 0 / 3 / 6 / 9 / 12, only on whole rows (row counts with (rows − 1) ÷ 4), no unit
  text. Small charts (side cards, the display's mini chart) have no axis. The live chart is the exception: it fills
  every row the display allows, and each value sits on its nearest row.
- Stage names never go on the chart; they go in the stage rail / legend / timeline.

## Text that comes from people or the machine

- **Freeform text** (profile, stage, author, bean, note, plugin names): every element that shows it is tested with a
  45+ character string, an unbroken long word, emoji / mixed scripts and an empty value. Rule: one smaller size for
  long text, a line limit, then "…"; containers never grow; nothing collides. Wrap between words; split a word only
  when it can't fit even at the smaller size.
- **Errors in plain words.** Decaid's error text is shown only when it reads as a sentence; anything with codes,
  exception names, paths or HTTP verbs becomes a plain fallback ("Decaid couldn't do that. Try again." or a specific
  one such as "Couldn't turn on Settings Viewer."). See `plainError` in `src/ui/toasts.tsx`.
- **Never show internal codes** (API enum names, error codes, setting keys). Map every known value to plain words;
  unknown values get a neutral word ("ENDED"), never a prettified code.

## Process

- After any visual change: `npm run screens`, look at every affected image at the three screen sizes.
- Prefer existing components; a new kind of element gets a rule here first.
- Every control has an accessible name and a hit target of at least 44 × 44 px (a row or label around it counts);
  `tests/e2e/layout.spec.ts` checks every screen at 1194 × 834 and 1024 × 600.

## Editor stage panel

- Three columns of named groups. Every group has a name (small, semibold, in brown: STAGE 1 NAME, TARGET, TIMING & LIMIT,
  TEMPERATURE, MOVE TO NEXT STAGE IF); its options stack close together under it (52 px rows; 44 px on short
  screens), with padding inside the group so nothing touches a rule. A rule separates groups; each column's last
  group fills to the bottom, so the columns end together. The names, not the rules, carry the structure.
- Duration, limit and the target have their ruler under them; a value that can be off (limit) shows OFF while on.
- Exclusive options are one row: the pressure (or flow) exit is one value with an above / below toggle in its sheet.
- Round step buttons (− / +) are 44 px, the same height as chips and segment buttons.
