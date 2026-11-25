// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): tuple shapes of the row scan.

import type { ProjectedLine } from "../../../types/page.js";
import type { Cell } from "../../block-types.js";
import type { TableCell } from "../types.js";

/** A candidate table row: the line index, the line, and the cells read from it. */
export type CandidateRow = [number, ProjectedLine, TableCell[]];

/**
 * A line or cell a run steps over: the line index, whether the whole line was
 * stepped over (as opposed to one trimmed cell), and the cell handed back.
 */
export type SteppedOver = [number, boolean, Cell];
