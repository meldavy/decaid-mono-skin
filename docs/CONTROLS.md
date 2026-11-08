# Mono — scenario checklist and exit criteria

Every user-facing behaviour of Mono has an ID here. Every ID must be covered by a test whose title starts with
that ID (e.g. `test('HOME-07 tapping Brew starts espresso', …)`), or be marked **M** (manual) with a reason.
`npm run test:map` fails if an ID has no test, or a test names an ID that doesn't exist.

## How scenarios are tested

| Level | What it is | Used for |
|---|---|---|
| **U** | Vitest unit test | pure logic: rounding, grid snapping, stage widths, ratio, key map, thermal status |
| **S** | Playwright against Decaid in simulate mode | anything the mock DE1 / mock scale can really do |
| **D** | S + simulator debug commands | scale stall / resume / disconnect, machine disconnect |
| **B** | S with the mock Bengle machine | group-head-controller behaviour |
| **I** | S + Playwright-injected traffic (`page.route`, `page.routeWebSocket`) | states the mocks can't produce: empty tank, server errors, slow replies, firmware, ambiguous scans |
| **M** | manual on a real tablet, logged in `docs/MANUAL-LOG.md` | real WebView 91, real BLE, real brightness |

**Decaid's profile model**: a profile's id is a hash of its recipe (steps, temperatures, targets); title, author and
notes are labels on that record. The profile's `version` is part of the recipe hash, so a copy gets a version of its
own ("2" → "2.1") and is a separate profile even before anything else changes. Copies are unsaved drafts until saved.

**Simulator limits** (worked around, noted in the test): the mock DE1 never ends flush or steam on its own
("finished by itself" is tested with hot water that Decaid stops at weight); the mock scale can only stall, resume or
disconnect.

A test that changes something asserts **both** what the screen shows **and** what Decaid now holds (REST read-back or
the WebSocket stream). A test that cancels asserts Decaid is unchanged.

## The scenario lens

Apply every line to every control while writing its scenarios; anything that applies gets an ID.

- **Tap**, **double tap**, **repeat tap** (no duplicate requests), tap while disabled
- **Hold** to completion, **hold released early** (nothing happens), hold-repeat on steppers
- **Drag** (ruler, favourites), drag cancelled (dropped outside), **swipe** (carousel, sheet dismiss)
- **Cancel** every way it can happen: Cancel button, scrim tap, swipe down, Back, Esc
- **Select / deselect**, switching selection with unsaved edits
- **Create / edit / delete**, delete of the thing currently in use, delete of a built-in
- **While busy**: request in flight, machine running, machine asleep, machine or scale disconnected
- **Failure**: Decaid replies 4xx / 5xx, times out, or the link drops mid-action → clear message, no false "saved"
- **Outside change**: another skin, the machine buttons or the group head changes the same thing while Mono shows it
- **Persistence**: reload / reopen shows the same thing; nothing written that the person didn't ask for
- **Keyboard**: shortcut keys where the spec says they work, and silence where it says they don't
- **Limits**: min / max / step / decimals, °C ↔ °F, empty lists, 100+ items
- **Freeform text** (profile names, authors, notes, bean / roaster / grinder names, schedule and plugin names): every
  element that renders it is tested with a 45+ character string, one long unbroken word, emoji / mixed scripts and an
  empty value. It follows the rule — one smaller size for long text, a line limit, then "…" — never grows its container
  and never collides with labels, charts or small text under charts. Each such element gets a long-text state in
  `npm run screens` and an automated check

---

## GLOBAL — app-wide

| ID | Scenario | Lvl |
|---|---|---|
| GLB-01 | Opening any screen sends no write to Decaid; configuration snapshot unchanged | S |
| GLB-02 | Decaid unreachable at start → "Connecting to Decaid" state, recovers by itself when it comes up | I |
| GLB-03 | Link drops mid-use → banner; controls that write are disabled; recovers and re-reads state | I |
| GLB-04 | Machine disconnects → banner + Brew/Steam/Water/Flush disabled; reconnect restores | D |
| GLB-05 | Scale disconnects / reconnects → weight shows "--", a toast each way (no banner: many brew without a scale) | D |
| GLB-06 | Scale stalls (no data) → weight marked stale, not shown as live | D |
| GLB-07 | Machine enters a running state from outside Mono (machine button) → the right screen/modal opens | S |
| GLB-08 | Group-head controller machine: Home shows no start tiles (as in Streamline); a shot started on the group head opens Live shot; Stop works | B |
| GLB-09 | Machine reports it needs water → refill machine message; clears by itself when refilled. The level alone (even at or under the refill threshold) never shows it | I |
| GLB-10 | Machine error state → machine message with what to do | I |
| GLB-11 | Presence heartbeat on touch / key, at most every 30 s, never while asleep; opening Mono alone sends nothing | S |
| GLB-12 | Toast appears, stacks, and times out; action toast's action works | U |
| GLB-13 | Any write that fails shows an error toast (Decaid's message only when it is plain words); UI shows the real value | I |
| GLB-14 | Slow reply (>2 s): control shows pending, no double send on repeat tap | I |
| GLB-15 | Decaid restarts underneath Mono → reconnects, no stale running state | I |
| GLB-16 | Gateway override (`?gateway=`, `monoGateway`, `reaHostname`) is used | U |
| GLB-17 | Inside Decaid's app WebView, "Exit to dashboard" calls the host API | I |
| GLB-18 | Chart accent preference recolours every chart and flow value | S |
| GLB-19 | °F preference converts every temperature shown and entered | S |
| GLB-20 | 12/24 h preference changes every clock | S |
| GLB-21 | Language switch relabels the UI live, no reload | M |
| GLB-22 | Fonts load with no network (bundled) | S |
| GLB-23 | Layout at 1194×834 and at the smallest supported size (1024×600): no clipping, no page scroll | S |
| GLB-24 | Runs on a WebView 91 tablet: every screen opens, no console errors | M |
| GLB-25 | Every control has an accessible name and a hit area of at least 44 px | S |
| GLB-26 | Every element showing freeform text survives long / unbroken / emoji / empty strings: size rule, line limit, "…", no growth, no collisions | S |
| GLB-27 | Every dot drawing on a brown display starts on the display's 9 px grid at any screen size (pinned top-left) | S |

## KEY — keyboard shortcuts

| ID | Scenario | Lvl |
|---|---|---|
| KEY-01 | E / W / S / F on Home start espresso / hot water / steam / flush | S |
| KEY-02 | P on Home puts the machine to sleep | S |
| KEY-03 | Space stops espresso (Live shot) and steam / water / flush (modals) | S |
| KEY-04 | The running action's own key stops it (E…E, S…S, W…W, F…F) | S |
| KEY-05 | Another start key during a running action does nothing | S |
| KEY-06 | Start keys do nothing outside Home (Library, Settings, Editor, sheets, modals) | S |
| KEY-07 | No key acts while typing in a field, with a dialog open, on key repeat, or with a modifier held | S |
| KEY-08 | Profile key on Home loads that profile; it does not start a shot | S |
| KEY-09 | Shortcuts off in Settings → no key does anything, including Stop | S |
| KEY-10 | E respects "require a scale" (blocked with message when no scale) | D |
| KEY-11 | Works on a group-head-controller machine; a refused start shows the machine's message | B |
| KEY-12 | Remap: press Rebind, press new key → saved to Decaid store, works immediately, survives reload | S |
| KEY-13 | Remap to a key already used → asks to move it; Move moves, Cancel keeps both unchanged | S |
| KEY-14 | Rebind cancelled with Esc → unchanged | S |
| KEY-15 | Add / change / remove a profile key; deleting the profile removes its key | S |
| KEY-16 | Reset to defaults restores E W S F Space P and clears profile keys (after confirm) | S |
| KEY-17 | Key map defaults are not written until changed | S |

## HOME — R10

| ID | Scenario | Lvl |
|---|---|---|
| HOME-01 | Display shows live group / steam temperature, machine state, weight, water level | S |
| HOME-02 | Heating → "heating" status, and time-to-ready once it is 99 s or less; ready status once in range; stale data never shows ready | S |
| HOME-03 | Carousel shows the five favourite slots from Streamline's shared store; empty slots shown as empty | S |
| HOME-04 | Tap a side card → carousel centres it and it becomes the machine's profile (read back) | S |
| HOME-05 | Swipe left / right; loads only the card it settles on (~0.5 s after the last swipe); Brew disabled until Decaid confirms | S |
| HOME-06 | Active profile isn't a favourite → a sixth card at the end, centred and selected; it goes away once a favourite is chosen; slots unchanged | S |
| HOME-18 | Long profile names drop to one smaller size and stop at 2 lines (big card) / 3 lines (side cards) with "…"; cards never grow | S |
| HOME-19 | Tap the card in front → its details (chart, every stage, numbers, notes) with Edit / Copy (or Edit a copy for a built-in); no slot picker; Esc / ✕ / scrim close; editing from here returns here | S |
| HOME-07 | Tap Brew → espresso starts (machine state), Live shot opens | S |
| HOME-08 | Brew with "require a scale" and no scale → blocked with message, machine stays idle | D |
| HOME-09 | Brew while asleep / disconnected / already running → disabled or explained, no request sent | S |
| HOME-10 | Repeat-tapping Brew sends one request | S |
| HOME-11 | Tap Steam / Water / Flush → that state starts, its modal opens | S |
| HOME-12 | Tap TEMP / DOSE / YIELD / TIME → the matching ruler sheet opens on that tab | S |
| HOME-13 | Value tiles show the live workflow; an outside change appears within a few seconds | S |
| HOME-14 | Tap weight → tare (scale reads ~0); disabled with no scale | S |
| HOME-15 | Tap Profiles → Library; History → History; Settings → Settings | S |
| HOME-16 | Tap Sleep → machine goes to `sleeping`; Sleep screen only once the machine confirms | S |
| HOME-17 | Mini chart shows the selected profile's plan as ghost dots on the grid | S |

## SHEET — ruler sheets (temperatures, times, yields, dose)

| ID | Scenario | Lvl |
|---|---|---|
| SHEET-01 | Opens on the tapped value's tab, showing current values (a 135 g allongé yield included) | S |
| SHEET-02 | Switch tabs; edits on other tabs are kept until Save or Cancel | S |
| SHEET-03 | Drag ruler → value follows, snaps to step | S |
| SHEET-04 | − / + tap changes by one step; hold repeats and accelerates; stops on release | S |
| SHEET-05 | Values clamp at min / max (steam 135–160 °C or off, times, yields) | U |
| SHEET-06 | Tap a preset → value set, preset marked; recent values become presets | S |
| SHEET-07 | Save → only changed values sent; read-back matches; "saved" shown after Decaid confirms | S |
| SHEET-08 | Save with one failing write → "partial" with which value failed; others kept | I |
| SHEET-09 | Save failing entirely → error, sheet stays open with edits | I |
| SHEET-10 | Cancel button / scrim tap / swipe down / Esc → nothing sent, values unchanged | S |
| SHEET-11 | Espresso temperature and yield save with the profile; hot water / steam / flush save to the workflow | S |
| SHEET-12 | Yield shows ratio to dose and updates as either changes | U |
| SHEET-13 | Espresso yield applies to every profile; with no scale the note says the shot won't stop at weight | S |
| SHEET-14 | Hot water amount label: weight with a scale, volume without | D |
| SHEET-15 | Shot target time saves to Mono's store per profile; default 25 s shown but not stored | S |
| SHEET-16 | Steam off: choosing Off writes 0; turning back on restores a valid temperature | S |
| SHEET-17 | Outside change while the sheet is open → untouched values refresh; edited value kept and flagged | I |
| SHEET-18 | °F: rulers, presets and steps in °F; values stored in °C | U |
| SHEET-19 | Repeat-tapping Save sends once | S |
| SHEET-20 | Temperature sheet MILK tab: Decaid's steam stop-at-temperature, 40–80 °C or OFF (0); saved as steamSettings.stopAtTemperature; note says it only stops on a Bengle or a DE1 with an external temperature probe | U |

## RUN — steam / hot water / flush modals

| ID | Scenario | Lvl |
|---|---|---|
| RUN-01 | Opens when the machine enters steam / hotWater / flush from any source | S |
| RUN-02 | Live time, flow or weight / volume, temperature; targets in serif | S |
| RUN-03 | Progress row fills by time (steam, flush) or by amount (hot water) | S |
| RUN-04 | Stop tile → machine idle; Stop shows pending until telemetry confirms | S |
| RUN-05 | Stop request fails → message, Stop available again | I |
| RUN-06 | Closes by itself when the machine returns to idle (finished, or stopped elsewhere) | S |
| RUN-07 | Hot water stops at weight with a scale | S |
| RUN-08 | Scale lost during hot water → falls back to volume label, still stoppable | D |
| RUN-09 | Link lost during a run → modal stays with "lost connection", Stop retried on reconnect | I |
| RUN-10 | Icon animates at 2 fps; holds still with reduced motion | S |
| RUN-11 | Modal can't be dismissed except by Stop or the machine finishing | S |
| RUN-12 | Steam milk temperature comes from the sensor Decaid stops on: Bengle milk probe first, else the first sensor with a numeric temperature channel | U |
| RUN-13 | Steam with a stop temperature: a non-zero milk reading switches the bar (first reading → stop temperature) and caption to temperature; none by the 5 s grace period → timer; no stop temperature → timer | U |
| RUN-14 | Milk reading lost (none non-zero for 2 s) → back to the timer, which kept running, caption says so; switches back when readings return | U |

## LIVE — live shot

| ID | Scenario | Lvl |
|---|---|---|
| LIVE-01 | Opens automatically when espresso starts from any source | S |
| LIVE-02 | Time and weight live, same size; target time and target yield shown | S |
| LIVE-03 | Stage timeline: widths proportional with a minimum width (136 px; stages that don't fit run off the row, see LIVE-15), current stage lit with its progress, names from the profile wrap to 2 lines before "…" | U+S |
| LIVE-04 | Chart: plan as ghost dots, live pressure / flow fill in on the grid | S |
| LIVE-05 | Stop → machine idle; pending until confirmed; then Shot complete | S |
| LIVE-06 | Skip to next stage → profile frame advances | S |
| LIVE-07 | Stops at target weight with a scale (stop reason "weight") | S |
| LIVE-08 | Stage move-on reasons are recorded from shot state (shown later in history) | U |
| LIVE-09 | Scale lost mid-shot → weight shows "--", the shot continues, Stop works | D |
| LIVE-10 | Tank level dips to the refill threshold mid-shot → no message; the shot carries on | I |
| LIVE-11 | Link lost mid-shot → status says NO LINK, recorded data stays, recording resumes on reconnect | I |
| LIVE-12 | Decaid tares the scale at shot start; Mono sends no tare during a shot and weight starts near 0 | S |
| LIVE-13 | Leaving is impossible mid-shot (no back), Stop always reachable | S |
| LIVE-14 | The current stage's bar follows the exit set to finish first (time, weight, volume, pressure / flow threshold); its label names what it tracks | U+S |
| LIVE-15 | Many stages: each keeps its minimum width; the row runs off the screen and follows the current stage by itself (it can't be dragged mid-shot) | S |
| LIVE-16 | Chart time axis: the first 40 s; a longer shot widens it 10 s at a time (a second before the edge, so the now line never leaves the chart), so drawn dots hold still between steps | U |
| LIVE-17 | Seconds under the live chart every 10 s, from 10 to the current span (no 0); numbers only, like the pressure scale | U |

## DONE — shot complete

| ID | Scenario | Lvl |
|---|---|---|
| DONE-01 | Shows the finished chart frozen, time, weight, ratio, peak pressure, average flow, stop reason | S |
| DONE-02 | Target time hit / missed shown against the shot target | S |
| DONE-03 | Rate tile → the shot sheet with rating pips at the top; the rating saves with Save (read back), changes, clears by tapping the same pip; the tile names the rating for screen readers | S |
| DONE-04 | Same sheet (Rate tile): text and optional grind; Save writes only what changed to the shot; Cancel / scrim / swipe / Esc write nothing | S |
| DONE-09 | Roaster and coffee for the shot (free text, saved to the shot's context; shown in History) | S |
| DONE-05 | Notes save failing → error, text kept | I |
| DONE-06 | Done → Home; nothing else written | S |
| DONE-07 | A new shot starting while on this screen replaces it with Live shot | S |
| DONE-08 | Shot stopped very early (<5 s) still shows a valid screen | S |
| DONE-10 | Many stages: the stage row opens on the stage the shot ended in (front if it stopped early, end if it ran through) and can be scrolled | S |

## SLEEP — sleep screen (S4b)

| ID | Scenario | Lvl |
|---|---|---|
| SLEEP-01 | Shown only while the machine reports `sleeping` | S |
| SLEEP-02 | Dot-matrix clock, "SLEEPING", date; 12 / 24 h | S |
| SLEEP-03 | Backlight dims to the sleep brightness (default 10 %); goes dark (0) after the configured time; brightness set via Decaid display API | S |
| SLEEP-04 | Tap while dark → clock shows again; does not wake the machine | S |
| SLEEP-05 | Hold → machine wakes (idle), back to Home | S |
| SLEEP-06 | Hold released early → still asleep | S |
| SLEEP-07 | Woken from outside (machine button, schedule) → Home | S |
| SLEEP-08 | Normal brightness restored on wake and after reconnect | S |
| SLEEP-09 | Brightness on a real tablet | M |
| SLEEP-10 | Sleep brightness setting; never raises the backlight above the person's own brightness | S |

## LIB — profile library (A2)

| ID | Scenario | Lvl |
|---|---|---|
| LIB-01 | Lists visible profiles with slot numbers for favourites; current marked | S |
| LIB-02 | Search by name (live); no results state; clear search | S |
| LIB-03 | Show hidden toggle; hidden profiles marked | S |
| LIB-04 | Tap a profile → detail with chart, stages, notes | S |
| LIB-05 | Select → becomes the machine's profile (read back), back to Home | S |
| LIB-06 | Edit opens your own profile; Edit a copy (built-in) / Duplicate (yours) open an unsaved draft with its own version — nothing written until saved | S |
| LIB-07 | A saved copy is a separate profile even with an unchanged recipe (its version differs); importing a recipe you already have says "Already in your library as …" | S |
| LIB-08 | Hide / unhide → visibility saved | S |
| LIB-09 | Delete own profile: hold-to-confirm; release early cancels; completes → gone (read back) | S |
| LIB-10 | Delete a built-in → offered Hide instead | S |
| LIB-11 | Delete the current or a favourite profile → warned; favourites slot emptied | S |
| LIB-12 | Import from JSON file; invalid file → message, nothing added | S |
| LIB-13 | Import a de1app / Visualizer `.tcl` profile file (Streamline parity); unreadable file → message, nothing added | S |
| LIB-14 | New opens an unsaved draft of the basic profile in the editor; nothing written until saved | S |
| LIB-15 | Manage favourites → Favourites manager | S |
| LIB-16 | 100+ profiles scroll smoothly; long names truncate | S |

## FAV — favourites manager and details modal

| ID | Scenario | Lvl |
|---|---|---|
| FAV-01 | Slots on top show the shared favourites; grid shows all visible profiles | S |
| FAV-02 | Drag a profile onto an empty slot → added | S |
| FAV-03 | Drag onto a filled slot → replaces; drag slot onto slot → swap | S |
| FAV-04 | Drag dropped outside / cancelled → unchanged | S |
| FAV-05 | Remove from slot | S |
| FAV-06 | Tap a profile → details pop-up (no slot picker; slots change by dragging); Edit and Copy (Edit a copy for a built-in), Remove from slot; Close / Esc close it | S |
| FAV-07 | Done saves to Streamline's shared store (read back; same order Streamline expects) | S |
| FAV-08 | Leave with unsaved changes → asks to save or discard | S |
| FAV-09 | Favourites missing in the store → empty slots, nothing created until saved | S |

## EDIT — profile editor

| ID | Scenario | Lvl |
|---|---|---|
| EDIT-01 | Chart and stage axis aligned; tap a stage on the axis selects it | S |
| EDIT-11 | Many stages: each at least ~15 characters wide; chart and stage strip scroll sideways together under a fixed pressure scale; the selected stage is kept in view | S |
| EDIT-12 | Type is a dropdown (tap outside / Esc closes unchanged); Type, Yield and Version keep a fixed width whatever their value | S |
| EDIT-13 | At 1000 × 600 the stage controls fit without scrolling; every group has a name, its options close together under it; the columns end together | S |
| EDIT-14 | The pressure (or flow) exit is one row; its sheet has an above / below toggle; Off clears it | S |
| EDIT-02 | Stage panel: pressure / flow switch, value, ramp, duration, limit, temperature + sensor, exit condition | S |
| EDIT-03 | Each field's min / max / step; invalid combination explained | U+S |
| EDIT-04 | Add stage after the selected one; delete stage (confirm); last stage can't be deleted | S |
| EDIT-05 | Reorder stages: hold a stage in the strip and drag it (a quick drag scrolls); ← / → select the previous / next stage | S |
| EDIT-06 | Rename; notes | S |
| EDIT-07 | Save → profile updated (read back); Save as new → new id | S |
| EDIT-08 | Saving a copy of a built-in creates your own profile (its favourite slot follows); if recipe and version both match an existing profile, it says so and creates nothing | S |
| EDIT-09 | A profile copied from another offers Reset to original: the original's recipe is loaded into the unsaved draft (Decaid keeps no version history on update) | S |
| EDIT-10 | Back with unsaved changes → modal: Save / Discard / Keep editing | S |
| EDIT-11 | Save fails → error, edits kept | I |
| EDIT-12 | Saving the current profile updates the machine's profile | S |

## SET — settings

| ID | Scenario | Lvl |
|---|---|---|
| SET-01 | Every toggle / stepper / choice reads Decaid's value and writes only that key on change | S |
| SET-02 | Brewing: early-stop calibration, require scale, stop hot water at weight | S |
| SET-03 | Sleep & display: brightness (disabled where the device can't), sleep screen dark after, sleep after idle, keep awake, night mode, charging | S |
| SET-04 | Schedules: add, edit, enable / disable, delete (confirm) | S |
| SET-05 | Presence on / off (off disables "sleep after") | S |
| SET-06 | Machine & devices: connect a scale flow (scan, pick, connect, fail, cancel, forget) | S+I |
| SET-07 | Scale on machine sleep: nothing / display off / disconnect | S |
| SET-08 | Water warning level | S |
| SET-09 | Maintenance: clean, descale, transport — hold-to-confirm; release early cancels | S |
| SET-10 | Firmware: installed build; update available / up to date (the update itself runs from Decaid) | I |
| SET-11 | Mono group: accent, °C / °F, 12 / 24 h, language, completion sound — saved to `mono` store | S |
| SET-12 | Completion sound plays at shot end when on; silent when off | S |
| SET-13 | System: Decaid update check, extensions on / off (plain failure message; "failed to start" marker), backup / restore (confirm), logs | S+I |
| SET-14 | Switch active skin (confirm) | S |
| SET-15 | Back from any section returns to the section list, then Home; the back button and title never scroll with the section list | S |
| SET-16 | Machine: fan, USB port, tank temperature, steam purge, refill kit, heater values — each writes only its key; °F shown and entered | S |
| SET-17 | Night mode start / morning times (shown only with night mode on); low-battery dimming | S |
| SET-18 | Load a profile on wake: choose / clear; loads only on a sleeping → awake change Mono sees | S |
| SET-19 | Forget a scale (confirm) | S |
| SET-20 | Plugin settings: a settings button only on plugins that declare settings; text, number, switch, choice and password fields; save sends only what changed; a password is never shown and can be cleared; non-numbers block saving; load and save failures in plain words | S |

## HIST — history

| ID | Scenario | Lvl |
|---|---|---|
| HIST-01 | Lists shots newest first; search by profile, bean, note | S |
| HIST-02 | Select a shot → full chart redrawn from its data | S |
| HIST-03 | Edit rating / note / grind → saved to the shot | S |
| HIST-05 | Upload (Visualizer) → success / failure messages | I |
| HIST-06 | Empty history state | I |
| HIST-07 | 500+ shots load progressively | I |

## MODAL — shared modals

| ID | Scenario | Lvl |
|---|---|---|
| MODAL-01 | Hold-to-confirm: dot row fills while held; release early resets; completes once | S |
| MODAL-02 | Refill tank: "Got it" dismisses; reappears only when the machine asks for water again after a refill | I |
| MODAL-03 | Connect scale: lists found scales, connect, failure, cancel, rescan | I |
| MODAL-04 | Unsaved changes: Save / Discard / Keep editing each do what they say | S |

---

## Exit criteria

A change is done only when all of these hold for every screen it touches:

1. **Map complete**: every affected ID has a test or a logged **M** entry; `npm run test:map` passes.
2. **Green twice**: the full suite passes on the dev server **and** on the installed zip (`npm run test:install`).
3. **Not flaky**: three consecutive full runs pass with no retries.
4. **Both sides asserted**: every write test reads Decaid back; every cancel test proves Decaid unchanged.
5. **Leaves no trace**: Decaid's configuration snapshot after the suite equals the one before it.
6. **No unasked writes**: GLB-01 holds for every screen.
7. **Failure paths covered**: each screen has at least one error, one link-loss and one outside-change scenario.
8. **Gestures are real**: taps, holds, drags and swipes use real pointer / touch events (`hasTouch`), not `click()` shortcuts.
9. **Looks right**: `npm run screens` captures every built screen state (states faked in the browser, nothing
   written to Decaid); each affected image is looked at after **every** UI change, against `docs/STYLE.md`. Check: ink vs crema vs ghost, dots / serif / mono roles, layout, empty and error states.
10. **Manual log done**: every **M** item checked on a tablet and recorded with date and device.
11. **No new gaps**: any control added while building gets IDs here before its code is merged.
12. **Freeform text checked**: every element that renders user text has a long-text screen state and passes GLB-26.
