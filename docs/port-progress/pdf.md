# Port progress: PDF input (`ppu-ocria-nano/pdf`)

Port of LiteParse's PDF path (crates-v2.21.2): `stages::{open, apply_orientation, outline, extract}`,
`extract.rs`, `text_clip.rs`, `font_cmap.rs`, `glyph_names.rs`, `glyph_resolver.rs`, `tex_math/*`, the PDF half of
`LiteParse::parse_resolved` (`parser.rs`), the rendering half of `ocr_merge.rs`, the PDFium half of
`table_model/{mod,units,features}.rs`, and `crates/pdfium` (replaced by an emscripten build of LiteParse's patched
pdfium). Rust reference: `<scratchpad>/ext/liteparse/crates/`. Rules: `docs/PORTING.md`.

Configuration the goldens record: Markdown output, `extract_blocks`, OCR on at **150 dpi** (LiteParse's
`DEFAULT_DPI`; the package default for `convertPdf` is 250, OCRia-nano's `OCRIA_NANO_DPI`), table model on,
`extract_links` on. Off: `extract_images`, `extract_vector_graphics`, `extract_annotations`, `extract_form_fields`,
`extract_structure_tree`, `extract_content_bounds`, `include_complexity`, `extract_screenshots`,
`page_orientation_corrections`, `crop_box`, `skip_diagonal_text`. `glyph_resolver` is none (the font DB resolver
needs `LITEPARSE_FONT_DB_DIR`).

## Done

- `scripts/pdfium/`: `build.sh` (pinned archive `chromium/8172` with sha256 check, emsdk 3.1.72, writes
  `.pdfium-build/{pdfium.mjs,pdfium.wasm,licenses/,VERSION}`); `exports.txt` (every `FPDF*`/`FORM_*` call of
  `src/pdf/**` is in it; checked by diffing the used names against the list and the list against the wasm exports).
  Output: wasm 4,034,703 bytes, 203 exports. The first build of the previous session lacked four clip-path exports
  that `exports.txt` named; rebuilt.
- `src/pdf/pdfium/*`: wrapper. Added `page-scan.ts` (`form_image_bounds`, `filled_path_bounds`,
  `has_annotation_text`, image bits per pixel) and `system-fonts.ts` (pdfium's `FPDF_SYSFONTINFO` in JavaScript).
- `src/pdf/extract/*`: `extract_page_text_items` and helpers (inherited), plus `pages.ts`
  (`extract_pages_and_images`, `extract_single_page`, `extract_page_image_refs`), `math-spans.ts`
  (`page_math_spans`, `math_item`), and the splits that bring every file under 300 lines (`segment-bounds`,
  `segment-item`, `segment-words`, `unicode-map`).
- `src/pdf/tex-math/*`: `tex_math/{mod,structures,encodings}.rs` (bit-compared against the Rust on about 20,000
  random pages).
- `src/pdf/stages/`: `open`, `applyOrientation`, `outline`, `extract`.
- `src/pdf/ocr-render/`: `calculate_page_complexity` and its helpers, `despeckle`, `is_bilevel_scan`,
  `render_pages_for_ocr_capped`, `fitting_dpi`, `mask_native_text`.
- `src/pdf/table-inputs/`: `pdf_units`, `char_bold`, `render_raw`, `page_input`, `attach_render`.
- `src/pdf/pipeline/`: `parsePdf` (parse_resolved for a PDF), `ocr-pass.ts` (the OCR loop).
- `src/pdf/index.ts`: `convertPdf(service, bytes, options)`, `loadPdfium`, wasm loading for Node and Bun (file next to
  the module, or `PPU_OCRIA_NANO_PDFIUM_WASM`) and browsers (`wasmUrl`).
- Packaging: `scripts/build.ts` copies `pdfium.mjs`, `pdfium.wasm`, `licenses/` and `VERSION` to `lib/pdf/`;
  `scripts/prepare-publish.ts` fails when they are missing; `scripts/binary/build-binaries.ts` embeds the wasm and
  bundles `pdfium.mjs` (`registerPdfiumFactory`); `playground/build-pages.ts` warns when the wasm is missing;
  `NOTICE` paragraph; `jsr.json` include list; `@embedpdf/pdfium` removed from `package.json`.

## Not ported (nothing in `PdfOptions` reaches it)

- Extract: embedded image bytes and the image cache, `build_vector_graphics`, annotations, form fields, the
  structure tree (`extract_structure_tree`; the `struct_nodes` list is ported), content bounds.
  `extractPagesAndImages` throws when an option asks for one of them. Widget flattening is ported
  (`flatten_form_widgets`, `restore_flattened_over_text`, `reflatten_pages`): LiteParse runs it for every document
  with an AcroForm, whatever the options. No golden has a form; `tests/pdf-extract-form.test.ts` builds one.
- `apply_content_filters`, `calculate_native_page_complexity`, `calculate_layout_complexity`,
  `render_for_ocr` caller page images, form rendering, request fields. Grayscale rasters: the OCRia engine does not
  override `prefers_grayscale` (false), so RGB is what the Rust renders.
- `raw_text.rs` (raw item mode), `acroform_repair.rs`, `font_db_resolver.rs`, `document_metadata.rs`,
  screenshots, `OcrTaskPool` concurrency (the TS pass renders and recognizes one page at a time).
- `font_db_resolver`: needs BLAKE3 and msgpack and a database of outline hashes
  (`LITEPARSE_FONT_DB_DIR`); the `GlyphResolver` hook (`PdfOptions.glyphResolver`) takes the same role. A browser
  can supply a resolver function; it cannot supply a directory.
- `PdfOptions.maxPages` defaults to 1000 (LiteParse's `max_pages`); `Page.dpi` is the OCR raster's dpi for every page
  that was rendered for OCR, including a page whose OCR found nothing (`borderless`), and null otherwise.
- `PdfOptions.keepHeadersFooters` defaults to the service's `keepHeadersFooters` (a public getter), so the CLI flag
  and `KEEP_HEADERS_FOOTERS` reach PDFs.

## Rust to TS map

| Rust                                                                      | TS                                                          |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `crates/pdfium/src/*`                                                     | `src/pdf/pdfium/*`                                          |
| `stages.rs` open, apply_orientation, outline, extract                     | `src/pdf/stages/index.ts`                                   |
| `extract.rs` extract_pages_and_images, extract_single_page                | `src/pdf/extract/pages.ts`                                  |
| `extract.rs` extract_page_text_items and helpers                          | `src/pdf/extract/*`                                         |
| `extract.rs` page_math_spans, math_item                                   | `src/pdf/extract/math-spans.ts`                             |
| `tex_math/*`                                                              | `src/pdf/tex-math/`                                         |
| `text_clip.rs`, `font_cmap.rs`, `glyph_names.rs`, `glyph_resolver.rs`     | `src/pdf/{text-clip,font-cmap,glyph-names,glyph-resolver}/` |
| `ocr_merge.rs` calculate_page_complexity                                  | `src/pdf/ocr-render/complexity.ts`                          |
| `ocr_merge.rs` despeckle, is_bilevel_scan                                 | `src/pdf/ocr-render/despeckle.ts`                           |
| `ocr_merge.rs` render_pages_for_ocr_capped, fitting_dpi, mask_native_text | `src/pdf/ocr-render/render.ts`                              |
| `table_model` page_input, attach_render, pdf_units, char_bold, render_raw | `src/pdf/table-inputs/index.ts`                             |
| `parser.rs` parse_resolved (PDF)                                          | `src/pdf/pipeline/parse-pdf.ts`, `ocr-pass.ts`              |
| the rest of the chain                                                     | `src/ocria/pipeline/parse-image.ts` stages, reused          |

## Test status

`tests/ocria/pdf-extract.test.ts` (10), `tests/ocria/pdf-parse.test.ts` (50: per golden `table.inputs`, `merge.input`
outcomes, `table.raster`, markdown, `pages`), `tests/pdf-extract-*.test.ts` and font/glyph tests (50 ported Rust
tests), `tests/pdf-tex-math.test.ts` (12), `tests/pdf-ocr-render.test.ts` (8), `tests/pdf-system-fonts.test.ts`,
`tests/pdf-extract-math.test.ts`, `tests/pdf-entry.test.ts` (7), `tests/cli.test.ts` (17, PDF tests on).

All 10 PDF goldens match at `extract.pages`, `table.inputs`, `merge.input`, `merge.pages`, `project.pages`,
`project.signals`, `table.inputs.final`, `table.raster` (ruling lines and the image input's hash), the markdown and
the final pages (apart from LayoutNet's class probabilities, as in the image path), **when the system fonts the
goldens were made with are installed** (`PdfOptions.fonts`; the tests read Arial, Times New Roman and Courier New
from macOS).

Without them (a browser, Linux): the three fixtures without standard-14 fonts (rtl-text, scanned, vertical-text)
still match at every checkpoint, and the other seven differ as below. The tests then compare what the substituted
font does not change (`PDF_TEST_FONT_DIR=/nonexistent bun test tests/ocria/pdf-parse.test.ts` runs that mode).

## Render and font parity

- Cause: a native macOS pdfium substitutes Arial, Times New Roman and Courier New for Helvetica, Times and Courier
  when a PDF names them without embedding; the wasm build has no system fonts and uses pdfium's built-in Foxit fonts.
  Ascent, descent and glyph advances set every text box.
- The OCR passes reopen the input (as the Rust does each round); the table inputs' units come from the extraction
  document, their renders from the reopened one.
- Measured without the fonts, on the seven affected fixtures: `font_ascent` and `font_descent` differ on every item
  (Helvetica 18 pt: ascent 17.316 against 16.290, descent -4.086 against -3.798); `y` and `height` follow (item
  height 21.40 against 20.09); `x`/`width` differ on 1 to 30 items per page (`digital`: 3 of 25 widths, up to 0.6 pt);
  `rotate-90` splits 155 items into 158 (`rn` becomes `r`, `n`). `table.inputs` differ in `bx` by up to 0.4 pt and in
  unit count (`legacy-font` 5 against 4, `structured` 53 against 55). The markdown still matches the golden on all ten at 150 dpi.
- The 150 dpi page render (`table.raster`): the ruling lines match without the fonts; the grey image input's hash
  differs on every page with text. With the fonts it is identical on all 10. The OCR render of `scanned`
  (a page-sized image) is bit-identical either way: its OCR results equal the reference's.
- With the fonts installed the wasm render and the native macOS render give identical pixels at 150 dpi on all ten
  fixtures (hash of the resampled image). The OCR outcomes (render dpi, flags, image rects, recognized lines) are
  equal on all ten with and without the fonts; only `scanned` has recognized lines (42), the other nine pages
  were masked to nothing OCR finds.
- What a browser can supply: any TrueType files named `Arial`, `Arial Bold`, ... in `PdfOptions.fonts`.
  Metric-compatible fonts (Liberation) should reproduce the advances; not tested.

## Helpers added

`tests/ocria/pdf-golden.ts` (fixture list, one pdfium instance, `runPdf` with the stage observer, the macOS font
loader). `ParsePdfOptions.observe` (tests only: a copy of each stage value under the golden's checkpoint name).
`registerPdfiumFactory` (compiled binaries).

## Open items for others

- `PdfOptions.fonts` defaults to `hostFonts()` (`src/pdf/host-fonts.ts`) on Node, Bun and Deno: the host's Arial,
  Times New Roman and Courier New, read once per process. Verified on macOS (exact goldens). The Windows file names
  and the Debian `msttcorefonts` path are untested, and whether a native pdfium on those hosts picks the same
  substitutes is unknown. In a browser the default is none (pdfium's built-in fonts, boxes within about 0.6 pt).
- On a host without the macOS fonts the golden tests run in the weaker mode (what the substituted font does not
  change). They run in the exact mode on macOS.
- The goldens were recorded at 150 dpi; `convertPdf` defaults to 250. The 250 dpi path (despeckle, bilevel scans) has
  one smoke test (`tests/pdf-entry.test.ts`) and no golden; record PDF goldens at 250 to cover it.
- Little or no test coverage of default-reachable code (see `bun test --coverage`): `struct-tree`, `page-links`,
  `text-clip/clip-geometry` (the goldens have no clipped text), the annotation path of `page-scan`
  (`has_annotation_text`, `form_image_bounds`), `glyph-decoder` recovery branches, `segment-rtl`.
- `scripts/build.ts` now writes an empty module for a types-only source file (`export * from "./row-types.js"` in
  `src/ocria/` made the transpiled `lib/` unimportable). With it, `lib/pdf` converts a PDF under Bun and Node 25.
  Verified on 2026-11-25: the darwin-arm64 compiled binary converts `digital.pdf` to the golden markdown, and
  `jsr publish --dry-run` lists `.pdfium-build/pdfium.mjs` and `pdfium.wasm`. Not verified: a browser (`wasmUrl`),
  the other binary targets (CI smoke-tests them), and Deno loading pdfium from a jsr URL.
- The CI, publish, binaries and deploy workflows run `scripts/pdfium/build.sh` (cache `~/.cache/ppu-ocria-nano-pdfium`);
  these steps have not run in CI yet, and `build.sh` from an empty cache (emsdk clone and install) is untested.
- `scripts/pdfium/build.sh` clones emsdk at the 3.1.72 tag; the pdfium archive is sha256-pinned.
- `multipage.pdf` was one page (14 short sections fit on A4); it is three pages now, and its golden was re-recorded
  with the same LiteParse build, so the cross-page header and footer detection is tested.
