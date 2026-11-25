// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): the ligature control-character map of extract_page_text_items.

import { charFromU32 } from "./chars.js";

/** Some PDF fonts encode ligatures as control characters: the first char and the tail to append. */
export function mapUnicode(unicode: number): [string, string] | null {
  switch (unicode) {
    // SOH is the space glyph of some buggy subset fonts (Calibri/Cambria embeds): left as a raw
    // control char it fuses adjacent words, as a space it drives the normal word break.
    case 0x01:
      return [" ", ""];
    case 0x02:
      return ["-", ""];
    case 0x1a:
      return ["f", "f"];
    case 0x1b:
      return ["f", "t"];
    case 0x1c:
      return ["f", "i"];
    case 0x1d:
      return ["T", "h"];
    case 0x1e:
      return ["f", "fi"];
    case 0x1f:
      return ["f", "l"];
    default: {
      const c = charFromU32(unicode);
      return c === null ? null : [c, ""];
    }
  }
}
