// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): trim_stepped_over_tail.

import type { SteppedOver } from "./row-types.js";

/**
 * End of a run that stopped scanning at `j`: whole lines stepped over at the
 * tail are left out of the run, so they're classified normally instead of
 * being handed back out of reading order.
 */
export function trimSteppedOverTail(
  j: number,
  startIdx: number,
  steppedOver: SteppedOver[]
): number {
  let end = j;
  while (end > startIdx + 1) {
    const last = steppedOver[steppedOver.length - 1];
    if (last === undefined || !(last[1] && last[0] === end - 1)) break;
    steppedOver.pop();
    end -= 1;
  }
  return end;
}
