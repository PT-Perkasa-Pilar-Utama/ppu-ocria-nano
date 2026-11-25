// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/resegment.rs (crates-v2.21.2, Apache-2.0): numeric_token.

import { charCount } from "../rust.js";
import { trimEndChars } from "../rust-extra.js";

const MARGIN_CHARS = new Set([":", ".", ",", "-", "–", "—", "(", ")", "/", "§"]);

/** A line number, time, time range or section number: "19", "14:00-14:10", "2pm", "(3)", "§3.1". */
export function numericToken(token: string): boolean {
  const t = trimEndChars(token, "apAPmM.");
  if (t === "" || charCount(t) > 14) return false;
  const cs = Array.from(t);
  return (
    cs.some((c) => c >= "0" && c <= "9") &&
    cs.every((c) => (c >= "0" && c <= "9") || MARGIN_CHARS.has(c))
  );
}
