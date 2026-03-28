# Plan: Stricter Aspect Ratio Maintenance

## Problem
Clips can be unintentionally stretched when resizing zones. There's no visual indicator or toggle for locked aspect ratio, and adjusting the source crop doesn't propagate proportional changes to the destination.

## Current Behavior
- **Corner handles**: Maintain aspect ratio by default; Shift = free resize
- **Edge handles** (tc/bc/ml/mr): Always free resize (stretches)
- **W/H number inputs** (`setSrc`, `setDst`): Independent — changing one doesn't affect the other
- **Source crop resize**: Never updates destination dimensions
- No UI indicator for aspect-ratio lock state

## Changes

### 1. Per-Zone `arLocked` State
**File: `state.js`**
- No new global needed — the lock state will be stored per-zone as `z.arLocked` (default: `true`)

**File: `zones.js`**
- In `addZone()` and `addAutoGameplayZone()`: set `arLocked: true` on new zones
- In `copyZone/pasteZone`: preserve `arLocked` in cloned zones

### 2. Link Icon Toggle on W/H Inputs
**File: `zones.js` → `renderZonesList()`**
- Add a clickable SVG chain icon button between W and H inputs for **both SRC and DST** sections
- Button toggles `z.arLocked` and re-renders
- When linked: icon is a solid chain link (accent color)
- When unlinked: icon is a broken chain (dim color)

**File: `css/styles.css`**
- Style `.ar-link-btn` — small inline button between W/H, 18×18px, no border, cursor pointer
- `.ar-link-btn.locked` vs `.ar-link-btn.unlocked` color states

### 3. Aspect-Ratio-Aware Number Inputs
**File: `zones.js` → `setSrc()` and `setDst()`**

`setSrc(id, prop, rawVal)`:
- If `z.arLocked` and prop is `'w'`: compute new `h` = `round(newW / oldAspect)` where `oldAspect = z.src.w / z.src.h` (captured before mutation). Clamp both. Update H input element.
- If `z.arLocked` and prop is `'h'`: compute new `w` = `round(newH * oldAspect)`. Clamp both. Update W input element.
- `x` and `y` changes are unaffected by lock.

`setDst(id, prop, rawVal)`:
- Same logic as above but using `z.dst.w / z.dst.h` aspect and no max-width clamping.

### 4. Edge Handles Default to Locked Resize
**File: `geometry.js` → `applyResize()`**

Current signature: `applyResize(ox, oy, ow, oh, handle, dx, dy, shiftKey, minW, minH, maxW, maxH)`

New signature: `applyResize(ox, oy, ow, oh, handle, dx, dy, freeResize, minW, minH, maxW, maxH)`

- `freeResize` = `true` means allow stretching (independent W/H)
- `freeResize` = `false` means maintain aspect ratio

Logic changes:
- **Corners** (tl/tr/bl/br): Already AR-locked when `!shiftKey`. Just invert the condition to use `freeResize` instead of `shiftKey`. (Currently: `!shiftKey` = locked → change to: `!freeResize` = locked.) ✅ This is already correct since `shiftKey` maps to `freeResize`.
- **Edges** (tc/bc/ml/mr): When `!freeResize`, after computing the primary dimension change, derive the other dimension from the aspect ratio:
  - `tc`/`bc` (height change): compute `w = round(h * aspect)`, center x-shift = `(ow - w) / 2`
  - `ml`/`mr` (width change): compute `h = round(w / aspect)`, center y-shift = `(oh - h) / 2`

### 5. Callers Pass Lock State
**File: `interaction.js`**

Source canvas resize (mousemove):
```js
const freeResize = !srcResizeZone.arLocked ? true : e.shiftKey;
const r = applyResize(..., freeResize, ...);
```

Output canvas resize (mousemove):
```js
const freeResize = !outResizeZone.arLocked ? true : e.shiftKey;
const r = applyResize(..., freeResize, ...);
```

Rule: **If zone is AR-locked, user must hold Shift to free-resize. If zone is AR-unlocked, always free-resize.**

### 6. Source Crop → Destination Proportional Update
**File: `interaction.js` → source canvas resize block (mousemove)**

After `applyResize()` updates `z.src.*`, also update `z.dst.*` proportionally **if `z.arLocked`**:
```js
if (z.arLocked) {
  const newAspect = z.src.w / z.src.h;
  // Keep dst width, adjust dst height to match new src aspect
  z.dst.h = Math.round(z.dst.w / newAspect);
  refreshZoneDst(z);
}
```

This ensures that when you crop differently on the source, the output rectangle adjusts to avoid stretching.

Also apply same logic in `setSrc()` when `arLocked` and prop is `'w'` or `'h'`.

### 7. Summary of Behavior Matrix

| Action | AR Locked (default) | AR Unlocked (link off) |
|---|---|---|
| Corner drag | Maintain AR | Maintain AR (hold Shift = free) |
| Edge drag | Maintain AR (both dims adjust) | Free resize (stretch) |
| Shift + any drag | Free resize | Free resize |
| W input change | H auto-adjusts | H unchanged |
| H input change | W auto-adjusts | W unchanged |
| Src crop resize | Dst updates proportionally | Dst unchanged |

## File Change Summary
| File | Changes |
|---|---|
| `static/js/state.js` | (none — lock lives on zone object) |
| `static/js/geometry.js` | `applyResize()`: invert shift semantics, add AR-lock for edge handles |
| `static/js/interaction.js` | Pass `freeResize` computed from `z.arLocked` + `e.shiftKey`; propagate src→dst on locked resize |
| `static/js/zones.js` | Add `arLocked` to zone creation; link toggle button in `renderZonesList()`; AR-aware `setSrc()`/`setDst()` |
| `static/css/styles.css` | `.ar-link-btn` styles |
| `static/index.html` | (none — zone cards are rendered dynamically) |

## Implementation Order
1. `geometry.js` — update `applyResize()` (edge AR logic + rename param)
2. `zones.js` — add `arLocked` to zone objects, link toggle UI, AR-aware input handlers
3. `css/styles.css` — link button styles
4. `interaction.js` — pass `freeResize` flag, add src→dst propagation
5. Test all interactions manually
