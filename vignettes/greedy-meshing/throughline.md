# Vignette throughline — *The Split Key*

The concrete values this vignette traces from first paragraph to last. Every claim in the prose, every value in a code excerpt, every label on a diagram refers back to this file. If a value is not here, it is not in the vignette.

## Repository

- `github.com/webspace-sdk/webspace-engine`, branch `master`, snapshot dated **2026-05-24**.
- Files touched: `src/terra/generator.js`, `src/terra/chunk.js`, `src/terra/mesher.js`.
- License: MPL-2.0. Excerpts ≤ 60 lines apiece; full attribution in the page header.

## The world

- Generator: **`islands`** (the default for new webspaces).
- Seed: **42**.
- World size: 8 chunks × 64 voxels per chunk × ⅛ m per voxel = **512 m × 512 m**, toroidally wrapped.

## The chunk we follow

- Chunk index: **`(cx = 0, cz = 0)`** — the origin chunk.
- Chunk dimensions: 64 × 64 × 64 voxels.
- Backing storage: `Uint8Array(64 × 64 × 64 × 8)` = **2,097,152 bytes** (2 MiB).
- Fields per voxel (8 bytes, `chunk.js:203–209`): `type, r, g, b, lr, lg, lb, palette`.

## The slice we examine in detail

- Plane: **y = 10** (one of the topmost grass slices for this seed in this chunk).

## The specific patch we trace

- Voxels at `(x = 4..8, z = 12..14, y = 10)` — **a 5 × 3 rectangle, 15 voxels** in total.
- Type: `4` (grass).
- Color: `r = 78`, `g = 164`, `b = 72` — the same byte triple for all 15 voxels.
- Split key (computed in `chunk.js:160`):
  `4 | (78 << 8) | (164 << 16) | (72 << 24)` → a single 32-bit integer all 15 voxels share.

## What greedy meshing does to it

- All 15 cells of the top-face boundary mask receive the same `vals[n]` value.
- The sweep starts at `(i = 4, j = 12)`, grows width to `w = 5` (until `(i = 9, j = 12)` differs), grows height to `h = 3` (until row `j = 15` differs), and **emits one quad** for all 15 top faces.
- Zeroes the rectangle in the mask. Advances `i += 5`. Continues.

## The contrast patch (used to motivate the climax)

- Voxels at `(x = 10..14, z = 12..14, y = 10)` — also 15 grass voxels.
- Same `type = 4`, but the palette+noise combo gives each voxel a slightly different green: `r ∈ {76, 77, 78, 79, 80}`, `g, b` similar variance.
- Each voxel's split key differs in the high 24 bits.
- Result: **15 quads instead of 1**, because no two adjacent cells match under the integer-equality test.

## The climax line

`chunk.js:160`

```js
return chunk.voxels[voxel] | (r << 8) | (g << 16) | (b << 24);
```

This is the line that makes the mesher color-aware without the mesher knowing about color. It is what the climax paragraph names.

## The second clever moment (sidebar / margin note candidate)

`generator.js:95–103` — `tiledSimplex` projects 2D `(x, z)` onto a 4D simplex via the parameterization
`(cos(x · 2π / L), cos(z · 2π / L), sin(x · 2π / L), sin(z · 2π / L))`.

This is the math that lets the toroidal world be seamless: the noise field is continuous across the wrap because the parameterization is. **Marked as a margin note in v1, not promoted to a second climax.** A future vignette can take this as its own throughline.

## What we deliberately do not trace

- The ±X / ±Y / ±Z face emission branches in `mesher.js` (six near-duplicate branches; we examine the top face in detail and gesture at the others).
- The protobuf encode / IndexedDB cache path (one sentence in the *Aftermath* section).
- The instanced terrain renderer (one sentence).
- The `smoothvoxels` package's smooth-voxel mesher (a separate code path, irrelevant to greedy meshing).
- LOD support (the `low = true` branch of `getSplitKey`).

## Pacing budget for v1 sketch

- Total reading target: ~10 minutes for the v1 sketch (about 40% of the production 25-minute vignette).
- Sections written in full: *Premise*, *The cast*, *The boundary*, *The mask*, *The sweep*, *The split key* (climax), *Coda*.
- Sections written short: *From noise to height*, *From height to voxels*, *Aftermath*.
- Beats placeholdered: 2 of an eventual 4–6.
- Focal media placeholdered: 2 of an eventual 3.
- Interstitial simulation placeholdered: 1 (color-jitter scrubber).
