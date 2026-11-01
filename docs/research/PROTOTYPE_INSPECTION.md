# Research Note — Prototype Inspection (31 Oct 2026, Phase 0)

> Visual reference only. These prototypes are **not** OmSuite, not implemented modules,
> and not test fixtures. See DECISION_LOG.md D-14.

## Files inspected

| File | Size class | What it actually is |
|---|---|---|
| `~/workspace/omsuite/prototypes/index.html` (Windows) | Single HTML file, Tailwind via CDN (`cdn.tailwindcss.com` — i.e. it needs network to render as designed, unlike the real offline app) | Static mockup: 5-item sidebar (Home / Recent, Files, Writer, Sheets, Settings), 3 cards (New Document, Universal File Manager, Format Converter), theme switcher (dark / light / green) persisted to `localStorage`. Buttons/cards are dead links or theme toggles; no file I/O, no editor, no conversion. |
| `~/workspace/omsuite/prototypes/android_app.html` (Android) | Single HTML file, Tailwind via CDN | Static mockup: header with search icon (dead), "Recent Files" list with exactly 2 hardcoded rows — `Project_Brief.docx` ("Local Storage • 2 mins ago") and `Financial_Q3.xlsx` ("Downloads • 1 hour ago") — a floating action button (dead), bottom nav (Home / Files / Settings). No file access, no SAF, no editor. |
| `~/workspace/omsuite/prototypes/OmSuite_Prototypes.zip` | 8.0 KB (source copy) | The ZIP the two HTML files were supplied in. Not opened as an app; contents match the two HTML files above. |

## What may be taken from the prototypes (visual direction only)

- Brand shape: "OmSuite" wordmark, emerald accent (`#10b981` family), dark-first
  surfaces (`#09090b` on black), light and green theme variants.
- Navigation shape: Windows = persistent sidebar; Android = bottom nav + FAB.
- Home shape: recent files + quick-action cards.
- Nothing else. In particular, the prototypes cover only 5 of the 12 modules in
  navigation (Windows) and 3 in navigation (Android) — the other modules exist only in
  the Master Instructions and Design Brief, not in any prototype.

## What must NOT be taken from the prototypes

- The 2 Android "recent files" are **hardcoded sample strings**, not files on any
  device. They must never appear as recents in the real app, never be used as test
  fixtures pretending to be user files, and never be cited as evidence that DOCX/XLSX
  opening works. (Master §3.1: demo fixtures must be visibly identified as sample data;
  the real File Manager never uses hardcoded sample data as a filesystem.)
- The 3 Windows cards ("Create a local text file", "Browse local storage securely",
  "Convert files offline") describe *intentions*, not implemented operations. Clicking
  them does nothing.
- The theme switcher (including the "green" theme) is a CSS toggle in a mockup. The
  real Settings module specifies light / dark / system (Master §3.12, Brief §17); a
  "green" accent variant is a design question for Phase 6, not a shipped setting.
- The CDN dependency (Tailwind via network) is a property of the mockup, not of the
  product: the real apps must work offline, so no runtime CDN dependency may be
  carried into the real builds.

## Inspection method

Files were read directly (head of each HTML file + full structure scan) on 31 Oct 2026.
No prototype was executed as an app, no screenshot was treated as a running product,
and no prototype behaviour was recorded as a product capability. This note is the
Phase 0 record for these assets.
