# VertiCut — Tomorrow's Todo

---

## 1 — Redesign the captions panel
Remove the collapsible generate zone entirely and redesign the captions panel
from scratch. The current layout is too cramped and the collapse mechanic adds
complexity without enough payoff.
**Goals for the redesign:**
- Segments list always visible and dominant
- Generate controls accessible without scrolling but not taking over the panel
- Style controls feel intentional, not like an afterthought
- Clean visual hierarchy — generate → style → segments in a way that makes sense
- Use the frontend-design skill when implementing

---

## 2 — Zoom on caption timeline lanes (not video timeline)
Currently `tlZoom` / `tlOffset` only affect the scrub bar and caption lane
rendering. But the caption lane container has no scroll/pan UI of its own —
zooming the scrub bar with scroll wheel does zoom the lanes, but there's no
way to pan the lanes independently or zoom just the lane area.
**Options:**
- Make the lane area scrollable horizontally when zoomed (overflow-x + sync scroll)
- Or wire the lane area to the same scroll wheel so zooming anywhere in the
  timeline bar (lanes included) triggers `tlZoomAt`
- Add a dedicated zoom control just for the lanes if they need to be independent
  from the scrub bar zoom

---

## 3 — Full-width timeline like DaVinci Resolve
**What this means:**
- Timeline bar stretches the full width of the bottom of the screen, spanning
  from the left edge all the way to the right panel border
- Multiple track rows: video waveform row, one row per audio track, one row
  per caption track — all time-aligned
- Scrub head is a full-height vertical line spanning all rows
- Rows are labelled on the left (like DaVinci's track headers)
- Timeline has its own resizable height (drag to make it taller)
- Zoom and pan work across all rows simultaneously

**Scope note:** This is a significant layout change. The current
`.timeline-bar` sits inside the input panel. Moving it to span the full
bottom means restructuring the main flex layout in `index.html` — the
editor area becomes a top section, timeline becomes a bottom section
that spans full width before the panel split.

---

## 4 — Test caption style settings
Go through every control in the style section and verify it renders correctly
on the output canvas:
- [ ] Font family changes
- [ ] Font size slider
- [ ] Bold / Black / Italic / Caps
- [ ] Text colour + outline colour + outline width
- [ ] Background colour + opacity + radius + padding
- [ ] Position X / Y sliders
- [ ] Alignment (left / center / right)
- [ ] Max width
- [ ] Line height + letter spacing
- [ ] Shadow toggle + shadow colour
- [ ] Word highlight toggle + colour
- [ ] Animation (pop / fade / none)
- [ ] Per-track style isolation (switching tracks updates all controls)
- [ ] Reset button reverts to defaults

---

## 5 — Enforce hint before generating + save to presets
**Enforce hint:**
- Don't hard-block generation, but show a dismissable warning toast if the
  hint field is empty: "Add a game name or keywords to the hint for better
  accuracy"
- Or show the hint field with a yellow border + tooltip if empty when Generate
  is clicked

**Save hint to presets:**
- The hint value (`cc-prompt`) is currently not included in preset save/load
- Find where preset data is serialised in `presets.js` — add `captionHint`
  to the saved object
- On preset load, populate `#cc-prompt` with the saved hint value
- The hint is game-specific so it makes sense to live on the preset

---

## 6 — Build installer and ship v1.6.0
**Steps:**
1. `npm install` — make sure `electron-updater` is in `node_modules`
2. `npm run build-installer` — builds NSIS `.exe` to `dist/`
3. Install it on a Windows machine and smoke-test:
   - [ ] App launches, ffmpeg works (load a video)
   - [ ] Captions panel visible and generate works
   - [ ] Whisper download prompt appears (first run)
   - [ ] Spacebar play/pause works
   - [ ] Export produces a valid 9:16 video
4. Create a GitHub release tagged `v1.6.0`
5. Upload the installer `.exe` as the release asset
   - electron-updater needs a `latest.yml` alongside the exe — electron-builder
     generates this automatically with `npm run publish`
   - If uploading manually, also upload the `latest.yml` from `dist/`
     otherwise auto-update won't work for future releases
6. For future releases use `npm run publish` (needs `GH_TOKEN` env var with
   `repo` scope) — this builds, creates the release, and uploads everything
   in one step
