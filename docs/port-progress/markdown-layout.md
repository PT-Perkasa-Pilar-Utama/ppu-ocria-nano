# Port progress: markdown block classification

Port of LiteParse `stages::document_signals`, `stages::extract_blocks` and `markdown_layout/*`
(crates-v2.21.2). Rust reference: `<scratchpad>/ext/liteparse/crates/liteparse/src/`.

## Module contract (fixed; all workers follow it)

Every Rust file gets a folder under `src/ocria/markdown-layout/`. Each folder has an `index.ts` barrel
that re-exports every top-level function, constant and type of the folder (private Rust items too, so a
sibling file can import them). Consumers import from the barrel: `../paragraphs/index.js`.
Names: camelCase functions (`collapse_whitespace` is `collapseWhitespace`), SCREAMING_SNAKE constants as
in Rust, PascalCase types as in Rust. A Rust method `Type::name(&self, ..)` becomes `typeName(self, ..)`
or `name(self, ..)` in the file that owns the type.

| Rust                                                                                                                                                                         | TS folder                                     | Owner       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------- |
| paragraphs.rs, inline.rs, lists.rs, hr.rs                                                                                                                                    | `paragraphs/`, `inline/`, `lists/`, `hr/`     | F1          |
| headings.rs, repetition.rs                                                                                                                                                   | `headings/`, `repetition/`                    | F2          |
| blocks.rs (non-render), table_fix.rs                                                                                                                                         | `blocks/` (has `positioned.ts`), `table-fix/` | F3          |
| tables.rs lines 1-2243 (span pieces, split_cells, try_detect_table, detect_tables, banded)                                                                                   | `tables/borderless/`                          | F4          |
| tables.rs lines 2244-3715 (description lists, run merging, union tables, cross-region headers), cross_region.rs                                                              | `tables/merge/`, `cross-region/`              | F5          |
| tables.rs lines 3716-6085 (ruled grids: CellGrid, assign_cells, build_ruled_table, detect_ruled_tables*, merge_table_runs), minus the projection and rendering agents' items | `tables/ruled/`                               | F6          |
| classify.rs                                                                                                                                                                  | `classify/`                                   | F7          |
| stages.rs (document_signals, extract_blocks, dedupe_rules), golden tests, integration                                                                                        | `src/ocria/stages/`                           | coordinator |

Shared, already present: `block-types.ts`, `blocks/positioned.ts` (Cell/PositionedBlock constructors and
mutators), `tables/types.ts` (SpanPiece, TableCell, TableRun), `constants.ts` (MIN_ROW_HEIGHT_PT),
`test-helpers.ts` (Rust test_helpers.rs, plus `blockEq`, `cellsEq`, `rowTexts` for Rust's derived
`PartialEq` that ignores cell geometry), `tables/grid-segments.ts`, `tables/detect-table-rects.ts`
(projection agent), `tables/escape.ts` (rendering agent; may not exist yet).

Conventions agreed for this port:

- `eprintln!` debug blocks and `flags.rs` (`LITEPARSE_DEBUG_*` env flags) are not ported: they only write
  stderr. Drop `if debug { .. }` blocks and the `debug` locals that feed only them.
- `HashSet<T>` is `Set<T>`; `HashMap` is `Map`; `Option<T>` is `T | null`; tuples are arrays.
- Rust copies and clones values; TS objects alias. Clone (`{ ...r }`, `structuredClone`) wherever Rust
  `.clone()`s, copies a `Rect`, or builds a new struct from another one, so no later mutation reaches the
  original.
- `&mut` parameters mutate the TS argument in place.
- Rust `usize` subtraction that could underflow panics in debug builds and wraps in release; the recorded
  goldens come from a build that did not hit it. `saturating_sub` is `Math.max(a - b, 0)`.
- f32 and string rules: `docs/PORTING.md`. `f32::max`/`min` ignore NaN, `Math.max` does not; check that a
  NaN cannot reach the call before using `Math.max`.
- Tests live in `tests/ocria/markdown-layout-<folder>.test.ts`, one bun test per Rust `#[test]`, titled with the
  Rust test name. Shared fixtures come from `src/ocria/markdown-layout/test-helpers.ts`.
- Signatures: parameter order and count match the Rust, with no options objects (the lint bans them), every
  `debug`/`dbg` parameter dropped, tuples as arrays, and the Rust return shape. `NUMERIC_FOOTER_PATH` is in
  `projection/xy-cut.ts`; `ImageMode` is in `constants.ts`; `OutlineTarget`, `StructNode`, `ImageRef` are in
  `types/document.ts`.
- Import cycles between sibling files are allowed for functions (ES module bindings resolve at call time),
  but no module may call into a sibling folder at module level. A constant that two parts need goes in the
  file that defines it, and that file must import no sibling folder (put it in a leaf file such as
  `constants.ts` in the folder when it would otherwise create a cycle at load time).
- Each worker first creates its barrel and stub exports (`throw new Error("not ported yet: <rust name>")`)
  with final signatures, so the other workers compile against real names within minutes, then fills them in.
- Each worker edits only its own section under "Worker sections" below (Edit tool, anchor on its own
  heading); the coordinator merges them into "Status" at the end.

## Status

Complete as of this session. Everything in scope is ported; nothing is left except the items under "Open items".

| Rust                                                                     | TS                                |
| ------------------------------------------------------------------------ | --------------------------------- |
| stages.rs `DocumentSignals`, `document_signals`                          | `stages/document-signals.ts`      |
| stages.rs `BlockOptions`, `extract_blocks`, `dedupe_rules`               | `stages/extract-blocks.ts`        |
| markdown_layout/mod.rs `MIN_ROW_HEIGHT_PT`, config `ImageMode`           | `markdown-layout/constants.ts`    |
| blocks.rs constructors and mutators of Cell / PositionedBlock / SpanCell | `blocks/positioned.ts`            |
| test_helpers.rs (plus `blockEq`, `cellsEq`, `rowTexts`)                  | `markdown-layout/test-helpers.ts` |
| Everything else                                                          | see the worker sections below     |

Not ported on purpose: `flags.rs` and the `eprintln!` debug blocks (`LITEPARSE_DEBUG_*`; they only write stderr), the
`debug`/`dbg` parameters of `classify_region`, `build_ruled_table*`, `should_stop_at_running_prose`; `mod.rs` re-exports
(each folder has its own `index.ts`). The renderer, `escape_table_cell`, `detect_table_rects` and the grid-segment helpers
belong to other agents.

Tests (`bun test tests/ocria/markdown-layout`): 330 pass, 0 fail across 30 files.

- `markdown-layout.test.ts`: the 21 goldens, `layout.input` to `layout.signals` and, with the recorded signals, to each
  page's `layout.blocks` (42 tests). `header_footer` is compared as a sorted array (a Rust `HashSet` serializes in no
  fixed order); every golden is a single page, so it is empty in all of them.
- `markdown-layout-stages.test.ts`, `-stages-pipeline.test.ts`: the stages.rs tests (dedupe_rules, heading and paragraph,
  per-page join, sideways OCR items, blocks linked to text items) and `deskewed_measured_words_keep_three_table_columns`
  from tables.rs, end to end through merge, projection, signals, blocks and the renderer.
- Every Rust `#[test]` of the ported files is present by name, except the renderer's and `escape_table_cell`'s (rendering agent).

Open items:

- Cross-page header/footer suppression (`compute_header_footer_set`, the signals' `header_footer`) is checked by unit tests
  only: every golden is a single page, so `header_footer` is empty in all 21.
- About 50 tests were added beyond the Rust `#[test]`s, for ported lines no Rust test or golden reaches. Their expected
  values are derived by hand from the Rust source, not from a Rust run. A Rust build (`cargo` is installed; the crate needs
  the pdfium and tesseract build scripts) was not attempted, so no differential run against Rust exists beyond the goldens.
- Ported lines still uncovered after the final run (unit tests plus goldens), as `file: lines`:
  blocks/header-cuts 112-117; classify/body-lines 35-38, 41-42, 45; classify-page 63-65; classify-region 81;
  flow-state 66-69; list-lines 28-29, 60-63, 101; model-page 86-95; model-tables 82, 103-106; stitch 16; table-block 49-50;
  headings/bold-heading 122, sources 37 and 107, toc 125; repetition/chrome-pattern 95; table-fix/absorb-header-band 80-81,
  92-98, fold-rows 13-16, 78-79, 85-86, 89-91, 153-154, group-headers 46-47, 63-64, rules 62-63, 118-119, 125-126;
  tables/borderless/absorb-header-lines 126, detect-tables 106-107, finalize-table-run 53-54, try-detect-inferred 53 and
  169-171, try-detect-table 36-43, 132-133, 170-179; tables/merge/cluster 44, 135-158, 188-189, 231-246, 284,
  description-split 44, description-text 59, 77, 126-127, union-header 74, 81, 100-101, 131-132, 175;
  tables/ruled/assign-cells 102, 170-176, boundaries 96-97, build-ruled-table 116-117, 143-144, 194, 200-201,
  grid-axes 35-37, 93-95, grid-filters 60-62; blocks/positioned `spanCellWithBbox`, `clearTextItems` (no caller yet).
- Helper files that hold shared test fixtures are named `*.test.ts` so they match the allowed pattern (the repo does the
  same in `ocr-merge-builders.test.ts`): `tests/ocria/markdown-layout-borderless-helpers.test.ts`,
  `tests/ocria/markdown-layout-classify-helpers.test.ts`.
- `ImageMode` is a config type this port added in `constants.ts` (no TS port of config.rs exists).
- `RuleSegments` / `extractRuleSegments` are in `tables/ruled/rule-segments.ts` (the projection agent's grid-segments.ts no
  longer holds them).
- Signature changes against the Rust: `dehyphenateJoin` and `appendInlineContinuation` return the new string (Rust mutates a
  `&mut String`); `parseListMarker`, `splitOrderedMarkerForEmit` and `mathRuns` return arrays for tuples; the `debug`/`dbg`
  parameters are dropped; `positionedBlock` and `sourcedBlock` copy the box and index list they are given, because Rust moves
  or clones what a caller passes and the deskew rotate-back later edits block boxes in place.
- `Grid::to_span_rows` is `toSpanRows` in `table-model/grid.ts` (another agent's port); classify imports it.

## Worker sections

### F1 paragraphs inline lists hr

Done. 59 bun tests pass (Rust `#[cfg(test)]` ports plus extra tests for branches the Rust tests skip);
every ported line is covered, flow.ts has one uncovered branch only.

Signature deviation for everyone: a Rust `&mut String` cannot mutate in TS, so
`dehyphenateJoin(prev, check, toAppend): string` and `appendInlineContinuation(prev, nextRaw, nextInline): string`
return the new string. `appendToParagraph(accum, line)` mutates `accum` (an object) in place; `accum.last` keeps the
line reference (Rust clones it; nothing mutates a line after classification starts, so the reference is equal).
`parseListMarker` returns `[ordered, marker, rest] | null`, `splitOrderedMarkerForEmit` `[marker, rest] | null`,
`mathRuns` `Array<[isMath, run]>`, `detectHorizontalRules` `Rect[]`.

| Rust                                                                                                              | TS                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| inline.rs SpanStyle                                                                                               | `inline/style.ts` (`SpanStyle`, `spanStyleFromItem`, `spanStyleIsPlain`, `spanStyleEq`) |
| inline.rs escape_inline, math_runs                                                                                | `inline/escape.ts`                                                                      |
| inline.rs style_body, apply_style, render_span, apply_link                                                        | `inline/apply-style.ts`                                                                 |
| inline.rs styled_spans, render_line_inline, spans_separated, line_uniform_style, line_all_bold                    | `inline/render-line.ts`                                                                 |
| inline.rs render_list_item_text, strip_leading_marker_from_inline, append_inline_continuation, continued_emphasis | `inline/list-item.ts`                                                                   |
| paragraphs.rs collapse_whitespace, ends_*, is_soft_hyphen_break, dehyphenate_join                                 | `paragraphs/text.ts` (+ `startsLowercase` helper)                                       |
| paragraphs.rs runs_on, font_size_paragraph_tolerance, continues_*, paragraph_flow                                 | `paragraphs/flow.ts`                                                                    |
| paragraphs.rs ParaAccum, append_to_paragraph                                                                      | `paragraphs/accum.ts`                                                                   |
| lists.rs parse_list_marker, split_ordered_marker(_for_emit), LIST_INDENT_STEP_PT                                  | `lists/markers.ts`                                                                      |
| lists.rs roman_value, marker_interpretations, detect_ordered_list_lines                                           | `lists/ordered.ts`                                                                      |
| hr.rs detect_horizontal_rules                                                                                     | `hr/index.ts`                                                                           |

Tests: `tests/ocria/markdown-layout-{inline,inline-extra,paragraphs,lists,hr}.test.ts`.
Not ported: none. Notes: `inline` and `paragraphs` import each other's barrels (functions only, no module-level calls).
`mathRuns` scans UTF-16 units where Rust scans bytes (same runs: every tested byte is ASCII). bun mangles non-ASCII
text inside `String.raw` templates, so tests use plain strings for that.

### F2 headings repetition

Done. `headings/` (bold-heading, constants, heading-map, sources, text-patterns, toc) and `repetition/` (chrome-pattern, furniture, header-footer, single-page) hold every non-test function of headings.rs and repetition.rs.
Tests: `tests/ocria/markdown-layout-headings.test.ts` (6 Rust tests + 10 added), `-repetition.test.ts` (14 Rust tests + 6 added); 36 pass.
Golden check (scratch test, not committed): body_size, heading_map and header_footer match `layout.signals` on all 21 goldens.
HashMap order: `compute_body_size` and `build_heading_map` do not depend on iteration order (max and threshold are order-free; kept sizes are sorted, and distinct keys hold distinct sizes). `compute_header_footer_set` returns a set, so its map order does not reach the output.
Not ported: `flags.rs` debug blocks (stderr only). Added helpers: `bandCutoffs` (header-footer.ts), `hasYear`/`hasDigitRange` exported for the Rust tests.
Uncovered ported lines: bold-heading.ts 122, sources.ts 37 and 107, toc.ts 125, chrome-pattern.ts 95, furniture.ts 64-65 (defensive branches).

### F3 blocks table-fix

Done. Tests: `tests/ocria/markdown-layout-blocks.test.ts` (9 pass), `tests/ocria/markdown-layout-table-fix.test.ts` (11 pass).

| Rust                                                                       | TS                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| blocks.rs `paragraph_from_accum`                                           | `blocks/paragraph-from-accum.ts`                                   |
| `rejoin_paragraphs_around_figures`, `ends_sentence`, `starts_continuation` | `blocks/rejoin-figures.ts`                                         |
| `split_repeated_header_tables`                                             | `blocks/split-header-tables.ts`                                    |
| `side_by_side_gutter`, `nonempty`, `repeated_header_cuts`, `union_cells`   | `blocks/header-cuts.ts` (`unionCells` takes an iterable of `Rect`) |
| `splice_soft_hyphens`                                                      | `blocks/splice-soft-hyphens.ts`                                    |
| table_fix.rs `fix_block`                                                   | `table-fix/fix-block.ts`                                           |
| `absorb_header_band`                                                       | `table-fix/absorb-header-band.ts`                                  |
| Dense, `from_span_rows`, `to_span_rows`, `at`, `single`, `remove_row`      | `table-fix/dense.ts`                                               |
| leaders, `move_currency`, `drop_empty_columns`                             | `table-fix/rules.ts`                                               |
| `fold_continuation_rows`, `is_value`, `union` (`unionRect`)                | `table-fix/fold-rows.ts`                                           |
| `span_group_headers`                                                       | `table-fix/group-headers.ts`                                       |

Not ported here: the renderer (rendering agent). `taken` in `absorbHeaderBand` is a `Map<number, ProjectedLine | null>`.
Added beyond upstream: four tests of `fold_continuation_rows` branches, one of `absorb_header_band`, one of `paragraph_from_accum`, one of the MergedTable split. Uncovered: unreached branches of `foldSpanned` early exits, `unionCells` empty case, `Cell`/`SpanCell` helpers in `positioned.ts` (used by other workers).

### F4 tables/borderless

Done: all of tables.rs lines 1-2243 ported to `src/ocria/markdown-layout/tables/borderless/` (barrel `index.ts`).
Rust to TS: constants -> `constants.ts`; verified_words, split_span_at_gutters, piece_from_words, line_pieces,
compute_line_pieces -> `span-pieces.ts`; TableCell::partition_items (`partitionItems`), lines_bbox, cell_rect,
located_cell, line_items_in_reading_order, line_cell, split_cells, recover_merged_cell -> `cells.ts`;
split_words_at_x_anchors, split_text_at_x_anchors, split_span_at_anchors -> `anchors.ts`; table_rows_adjacent,
row_spacing_cv, cell_aligns_track, spanning_track_indices, spanning_header_eligible, is_label_fragment,
match_track_idx, infer_tracks_from_raw_items, cells_from_raw_items_with_tracks, cells_from_pieces,
is_alpha_dominant -> `tracks.ts`; run_text_kept, lines_left_out, is_value_like -> `run-text.ts`;
trim_stepped_over_tail -> `stepped-over.ts`; absorb_header_lines -> `absorb-header-lines.ts`;
finalize_table_run -> `finalize-table-run.ts`; try_detect_table_inferred, two_row_run_plausible ->
`try-detect-inferred.ts`; try_detect_table -> `try-detect-table.ts`; detect_tables, detect_tables_banded,
rule_bands, two_col_band_pass, count_text_table_runs, validated_ruled_table_rects, detect_tables_impl,
detect_tables_with_pieces, two_row_second_pass -> `detect-tables.ts`. Tuple shapes (`CandidateRow`, `SteppedOver`)
are in `row-types.ts`. `eprintln!` debug blocks dropped.
Tests (all pass): `tests/ocria/markdown-layout-tables-borderless-{pieces,detect,try}.test.ts` (41 Rust tests),
`-extra.test.ts` (8 tests with no Rust counterpart, for uncovered lines), `-classify.test.ts` (2 Rust tests that
render through classify; wait for F7's classify to load). Shared fixtures: `tests/ocria/markdown-layout-borderless-helpers.test.ts`.
Not ported here (other owners): the `deskewed_measured_words_keep_three_table_columns` test (coordinator), escape tests (rendering).
`recoverMergedCell` splices the array it is given (Rust takes ownership): callers pass a copy when they keep the original.

### F5 tables/merge cross-region

Done. All of tables.rs 2244-3715 and cross_region.rs (non-test and tests) are ported.

| Rust                                                                                                                                                          | TS                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| DESC_LIST__, TABLE_HEADER_MAX_ABSORB_ROWS, TABLE_MERGE__, TABLE_CLUSTER_*, TABLE_SUBSET_TRACK_TOLERANCE_PT                                                    | `tables/merge/constants.ts`                                       |
| is_label_like, is_page_ref, is_bullet_only, looks_like_caption                                                                                                | `tables/merge/description-text.ts` (plus helper `hasAlphabetic`)  |
| split_description_cell_at_anchor, split_merged_at_anchor                                                                                                      | `tables/merge/description-split.ts`                               |
| try_detect_description_list                                                                                                                                   | `tables/merge/description-list.ts`                                |
| run_column_count, run_body_tracks, cross_region_header_tracks, subset_match_score, matching_track_count, tracks_align_same, subset_mapping, pad_row_to_layout | `tables/merge/track-match.ts`                                     |
| is_absorbable_interstitial, try_merge_pair, merge_consecutive_table_runs                                                                                      | `tables/merge/merge-pair.ts`                                      |
| union_header_from_above, absorb_cross_region_headers                                                                                                          | `tables/merge/union-header.ts`                                    |
| cluster_adjacent, union_tracks_in_window, sparse_row_via_cells, build_union_table, merge_fragmented_table_clusters                                            | `tables/merge/cluster.ts`                                         |
| cross_region.rs thresholds, Leaf and prose gates, clusters and fusion, validation A and B, find_cross_region_table_merge                                      | `cross-region/{constants,leaves,clusters,validate,find-merge}.ts` |

Tests (all pass, 27 + 12 = 39 incl. 2 added): `tests/ocria/markdown-layout-tables-merge.test.ts`,
`-tables-description.test.ts`, `-tables-clusters.test.ts`, `-cross-region.test.ts`, `-cross-region-fusion.test.ts`.
Two tests in `-tables-clusters` are not Rust tests (direct checks of `merge_fragmented_table_clusters`).
Not ported: debug `eprintln!` blocks. Uncovered lines: `tables/merge/cluster.ts` 135-158 (`sparseRowViaCells`),
188-189, 231-246 (failed-row path), `union-header.ts` 74, 81, 100-101, 131-132, 175 (assign-nearest fallback and
single-cell interstitial skip), `description-list.ts` 105-121 (caption/cadence guards, 1-cell continuation).

### F6 tables/ruled

Done: tables.rs lines 3716-6085 (ruled grids) in `src/ocria/markdown-layout/tables/ruled/`, barrel `index.ts`.

| Rust                                                                                                                                          | TS file                  |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| RuleSegments, extract_rule_segments (removed from grid-segments.ts by the projection agent, so ported here)                                   | `rule-segments.ts`       |
| TABLE_COL_BOUNDARY_CLUSTER_PT, TABLE_MAX_EMPTY_CELL_FRACTION*, TABLE_SPINE__, RULED___MIN_COVERAGE, RuledPass                                 | `constants.ts`           |
| filter_by, push_cell_text, CellGrid and methods (`cellGridNew`, `cellGridPushText`, `cellGridRetainRows`, `cellGridCollapsePhantomRows`, ...) | `cell-grid.ts`           |
| running_prose_sentence_shape, prose_line_x_ranges, prose_boundary_crossing, prose_line_font_height, should_stop_at_running_prose              | `prose-stop.ts`          |
| assign_cells                                                                                                                                  | `assign-cells.ts`        |
| flatten_header_band, merge_stacked_header, rowspan_mask                                                                                       | `header-band.ts`         |
| passes_density_gate, collapse_gutter_columns, filter_short_vlines, extend_to_perpendicular_extent                                             | `grid-filters.ts`        |
| cluster_boundaries, dedup_close, bucket_words_into_columns, find_bucket                                                                       | `boundaries.ts`          |
| column and row boundary part of build_ruled_table_from                                                                                        | `grid-axes.ts`           |
| build_ruled_table_from, build_ruled_table, STRADDLE_IMPROVEMENT                                                                               | `build-ruled-table.ts`   |
| GridBand, split_component_at_grid_gaps, detect_ruled_tables_impl, detect_ruled_tables, detect_ruled_tables_global                             | `detect-ruled-tables.ts` |
| run_filled_cells, merge_table_runs, merge_continuation_rows, is_continuation_row, cell_continues                                              | `merge-runs.ts`          |

Not ported on purpose: `dbg` parameters and `eprintln!` blocks; `should_stop_at_running_prose` also drops its `row` and
`idx` parameters (they only fed the debug log).
Tests: `tests/ocria/markdown-layout-tables-ruled{,-prose,-grid,-helpers}.test.ts`, 43 pass: the 34 Rust tests whose subject
is in this range plus 9 hand-computed extras for code the Rust tests do not reach.
Coverage gaps (ported lines no test reaches): assign-cells.ts 102, 170-176, 230; boundaries.ts 96-97;
build-ruled-table.ts 116-117, 143-144, 194, 200-201; grid-axes.ts 35-37, 93-95; grid-filters.ts 60-62, 109.

### F7 classify

Status: all of classify.rs ported (production code lines 1-1751 and 2567-2854, plus the cfg(test) tests).
`bun test` on the 4 classify test files and `tests/ocria/markdown-layout.test.ts` (42 golden tests): 81 pass, 0 fail.

Files in `src/ocria/markdown-layout/classify/` (barrel `index.ts`):

- `classify-page.ts`: `classify_page_with_filters` (TOC, chrome filter, footer split, cross-region merge, region loop, stitch, fix_block).
- `toc.ts` (page_is_toc fallback), `model-tables.ts` (learned-table pass), `global-ruled.ts` (global ruled pass).
- `classify-region.ts` (`classify_region` driver), `region-ctx.ts` (the locals of `classify_region` as one record), `region-tables.ts` (per-region table detection, `emit` of a run), `heading-level.ts` (priority chain), `heading-emit.ts` (heading wrap merge and demotion), `list-lines.ts`, `body-lines.ts` (bold heading, paragraph).
- `flow-state.ts` (FlowState), `interruption.ts` (Interruption, queue), `stitch.ts` (stitch_regions), `code.ts`, `divider.ts`, `rotated.ts`, `table-block.ts`, `model-page.ts` (model_* and page_boxes).

Deviations and notes:

- `Grid::to_span_rows` is in `table_model/mod.rs` upstream and has no TS port; classify imports `toSpanRows` from `table-model/grid.ts`.
- `classify_region` lost its `debug` parameter (debug blocks not ported); its 700 lines are split over several files with a `RegionCtx` record.
- The `HashMap`s in the source (`groups`, `model_edits`, `pool`, `hist`) are only looked up or reduced with order-independent checks; none reaches the output in iteration order. `max_by_key` in `page_boxes` keeps the last of equal keys.
- `classify_page` (cfg(test) helper) lives in `tests/ocria/markdown-layout-classify-helpers.test.ts`.
  Tests: `tests/ocria/markdown-layout-classify{,-tables,-items}.test.ts` (26 Rust tests), `markdown-layout-classify-extra.test.ts` (13 hand-derived tests for paths no Rust test reaches).
  Uncovered ported lines after the classify tests plus the goldens: body-lines 35-38,41-42,45 (bold heading); classify-page 63-65 (cross-region merge loop); classify-region 42-43,81; flow-state 66-69 (prose-reading mono run); list-lines 28-29,60-63,101 (lettered list, numbered bold heading, continuation edge); model-page 86-95; model-tables 82,103-106; region-tables (a branch); stitch 16; table-block 49-50.
