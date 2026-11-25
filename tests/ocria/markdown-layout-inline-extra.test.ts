// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Extra tests for liteparse markdown_layout/inline.rs (crates-v2.21.2): branches the Rust
// #[cfg(test)] tests do not reach. Expected values follow the Rust source.

import { describe, expect, test } from "bun:test";

import {
  applyLink,
  applyStyle,
  lineAllBold,
  lineUniformStyle,
  renderLineInline,
  renderListItemText,
  spanStyleIsPlain,
  spansSeparated,
} from "../../src/ocria/markdown-layout/inline/index.js";
import { styledLine } from "../../src/ocria/markdown-layout/test-helpers.js";
import { textItem } from "../../src/ocria/types/text-item.js";

describe("inline: untested branches", () => {
  test("raised, lowered and underlined spans use HTML tags and abut their word", () => {
    const l = styledLine(
      [
        ["Taha", 50, "Arial"],
        ["1", 70, "Arial"],
        ["x", 90, "Arial"],
      ],
      100,
      10
    );
    l.spans[1].sup = true;
    l.text = "Taha1 x";
    expect(renderLineInline(l)).toBe("Taha<sup>1</sup> x");
    const u = styledLine(
      [
        ["a", 50, "Arial"],
        ["b", 80, "Arial"],
      ],
      100,
      10
    );
    u.spans[1].underline = true;
    u.spans[1].sub = true;
    expect(renderLineInline(u)).toBe("a <u><sub>b</sub></u>");
  });

  test("a right-to-left line reads from the highest x down", () => {
    const l = styledLine(
      [
        ["one", 50, "Arial-Bold"],
        ["two", 200, "Arial"],
      ],
      100,
      10
    );
    l.rtl = true;
    expect(renderLineInline(l)).toBe("two **one**");
  });

  test("a merged item contributes its style pieces", () => {
    const l = styledLine([["merged text", 50, "Arial"]], 100, 10);
    l.spans[0].style_pieces = [
      textItem({ text: "plain", x: 50, width: 25, height: 10, font_name: "Arial" }),
      textItem({ text: "bold", x: 80, width: 20, height: 10, font_name: "Arial-Bold" }),
    ];
    l.text = "plain bold";
    expect(renderLineInline(l)).toBe("plain **bold**");
  });

  test("a line without spans falls back to its collapsed text", () => {
    const l = styledLine([["  ", 50, "Arial"]], 100, 10);
    l.text = "a   b";
    expect(renderLineInline(l)).toBe("a b");
    expect(lineUniformStyle(l)).toBeNull();
    expect(lineAllBold(l)).toBe(false);
  });

  test("spans_separated reads the line text first and the page geometry second", () => {
    const a = textItem({ text: "Note", x: 0, width: 20, height: 10 });
    const b = textItem({ text: ":", x: 20, width: 3, height: 10 });
    expect(spansSeparated(a, b, "Note:", false)).toBe(false);
    expect(spansSeparated(a, b, "Note :", false)).toBe(true);
    expect(spansSeparated(a, b, "other", false)).toBe(false);
    expect(spansSeparated(a, { ...b, x: 25 }, "other", false)).toBe(true);
    expect(spansSeparated({ ...a, x: 30 }, { ...b, x: 0 }, "other", true)).toBe(true);
  });

  test("line_all_bold tolerates italic and rejects mono", () => {
    expect(
      lineAllBold(
        styledLine(
          [
            ["a", 0, "Arial-Bold"],
            ["b", 20, "Arial-BoldItalic"],
          ],
          0,
          10
        )
      )
    ).toBe(true);
    expect(lineAllBold(styledLine([["a", 0, "Courier-Bold"]], 0, 10))).toBe(false);
  });

  test("render_list_item_text keeps a uniform style and strips the marker of a mixed line", () => {
    const uniform = styledLine([["• item", 50, "Arial-Bold"]], 100, 10);
    expect(renderListItemText(uniform, "•", "item")).toBe("**item**");
    const mixed = styledLine(
      [
        ["•", 50, "Arial"],
        ["item", 60, "Arial-Bold"],
      ],
      100,
      10
    );
    expect(renderListItemText(mixed, "•", "item")).toBe("• **item**".slice(2));
    const noMarker = styledLine(
      [
        ["x", 50, "Arial"],
        ["item", 60, "Arial-Bold"],
      ],
      100,
      10
    );
    expect(renderListItemText(noMarker, "•", "item_1")).toBe("item_1");
  });

  test("apply_link brackets a URL with parentheses and span_style_is_plain", () => {
    expect(applyLink("t", "https://x.y/a(b)")).toBe("[t](<https://x.y/a(b)>)");
    const plain = lineUniformStyle(styledLine([["a", 0, "Arial"]], 0, 10));
    expect(plain === null ? null : spanStyleIsPlain(plain)).toBe(true);
    const both = lineUniformStyle(styledLine([["a", 0, "Arial-BoldItalic"]], 0, 10));
    expect(both === null ? null : applyStyle("x", both)).toBe("***x***");
  });
});
