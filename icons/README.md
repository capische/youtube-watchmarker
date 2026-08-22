# Icon library

Master copies of the F2 bookmark-play icon (all share the same path data; only fill treatment, color, and scale differ). The shipped copies live in `content/` — this folder is the archive, not packaged into the .xpi.

| File | Style | Color | Scale | Used by |
|------|-------|-------|-------|---------|
| `icon-bw.svg` | outline | theme-adaptive b&w | 1.25 | toolbar `action`, `sidebar_action` (as `content/icon-bw.svg`) |
| `icon-blue.svg` | outline | #3a7bd5 | 1.15 | unused (reserve) |
| `icon-bw-filled.svg` | filled, play knockout | theme-adaptive b&w | 1.25 | unused (reserve) |
| `icon-blue-filled.svg` | filled, play knockout | #3a7bd5 | 1.15 | unused (reserve) |
| `icon-tile-red.svg` | rounded tile, white knockout glyph | tile #e0364f | tile 24×24 rx 5.5, glyph 0.82 | unused (reserve) |
| `icon-tile-blue.svg` | rounded tile, white knockout glyph | tile #3a7bd5 | tile 24×24 rx 5.5, glyph 0.82 | manifest `icons` → context menu + about:addons (as `content/icon-tile-blue.svg`) |

Base geometry (viewBox 0 0 24 24, the "F2" glyph):

- bookmark: `M6 5.5 a2 2 0 0 1 2 -2 h8 a2 2 0 0 1 2 2 v15 l-6 -4.5 l-6 4.5 z` (outline: stroke-width 1.6, round caps/joins)
- play triangle: `M10.2 7.5 l4.6 2.9 l-4.6 2.9 z`
- filled variants merge both subpaths into one path with `fill-rule="evenodd"` (triangle becomes a hole)
- resize via the wrapping `<g transform="translate(12 12) scale(S) translate(-12 -12)">` — never edit the path data

Theme adaptivity uses a `<style>` block with `@media (prefers-color-scheme: dark)` (#2b2b2b light / #f2f2f2 dark). Do not use `context-fill` — it ignores strokes and renders gray.
