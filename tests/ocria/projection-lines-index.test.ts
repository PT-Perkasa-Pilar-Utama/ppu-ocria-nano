// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// projection.rs `lines_index_the_returned_text_items`: every projected line's
// `span_item_indices` index the page's returned `text_items`.

import { expect, test } from "bun:test";

import { projectPagesToGrid } from "../../src/ocria/projection/index.js";
import type { Page } from "../../src/ocria/types/page.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import type { TextItem } from "../../src/ocria/types/text-item.js";

test("lines index the returned text items", () => {
  const textItems: TextItem[] = [];
  for (let row = 0; row < 5; row++) {
    const y = 100 + row * 14;
    for (const [text, x] of [
      [`left${row}`, 50],
      [`right${row}`, 350],
    ] as const) {
      textItems.push(textItem({ text, x, y, width: 200, height: 10 }));
    }
  }
  const page: Page = {
    page_number: 1,
    page_width: 612,
    page_height: 792,
    text_items: textItems,
    graphics: [],
    struct_nodes: [],
    image_refs: [],
  };
  const projected = projectPagesToGrid([page])[0];
  const seen: number[] = [];
  for (const line of projected.projected_lines) {
    expect(line.spans.length).toBe(line.span_item_indices.length);
    line.spans.forEach((span, k) => {
      const i = line.span_item_indices[k];
      expect(projected.text_items[i].text).toBe(span.text);
      seen.push(i);
    });
  }
  seen.sort((a, b) => a - b);
  expect(seen).toEqual(projected.text_items.map((_, i) => i));
});
