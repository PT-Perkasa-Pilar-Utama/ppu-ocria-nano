// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The stages after block classification against LiteParse's own values:
// `layout.input` + `layout.blocks` give each page's markdown (`layout.pages`)
// and the joined text (`layout.text`); `layout.pages` through the deskew
// rotate-back gives `final.pages`. The unit tests are the `#[cfg(test)]` tests
// of stages.rs that reach these stages, and the join of parser.rs `apply_layout`.

import { describe, expect, test } from "bun:test";

import type { PositionedBlock } from "../../src/ocria/markdown-layout/block-types.js";
import { positionedBlockFromJson } from "../../src/ocria/markdown-layout/render/index.js";
import type { ExtractedImage } from "../../src/ocria/output/types.js";
import {
  applyLayoutBlocks,
  applyLayoutPage,
  joinPageMarkdown,
} from "../../src/ocria/stages/apply-layout-join.js";
import { canonicalizeImageRefs } from "../../src/ocria/stages/canonicalize-image-refs.js";
import { renderPageMarkdown } from "../../src/ocria/stages/render-page-markdown.js";
import { rotateBackOcrDeskew } from "../../src/ocria/stages/rotate-back.js";
import type { ParsedPage } from "../../src/ocria/types/page.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import {
  canon,
  loadParseGolden,
  parsedPageFromJson,
  parseGoldenNames,
  stage,
} from "./parse-golden.js";

const MARKDOWN_AND_BLOCKS = { wantsMarkdown: true, extractBlocks: true };

function blocksOf(raw: unknown): PositionedBlock[] | null {
  return Array.isArray(raw) ? raw.map(positionedBlockFromJson) : null;
}

function page(n: number, text = "", over: Partial<ParsedPage> = {}): ParsedPage {
  return parsedPageFromJson({
    page_number: n,
    page_width: 612,
    page_height: 792,
    text,
    text_items: [],
    ...over,
  });
}

describe.each(parseGoldenNames())("%s", (name) => {
  test("layout.input and layout.blocks to layout.pages and layout.text", () => {
    const g = loadParseGolden(name);
    // SAFETY: the recorder writes layout.input as ParsedPage[]; layout.text as the joined markdown.
    const pages = (stage(g, "layout.input") as unknown[]).map(parsedPageFromJson);
    const blocks = (g.stages.get("layout.blocks") ?? []).map(blocksOf);
    const text = applyLayoutBlocks(pages, blocks, MARKDOWN_AND_BLOCKS);
    expect(canon(pages)).toEqual(canon(stage(g, "layout.pages")));
    expect(text).toBe(String(stage(g, "layout.text")));
    expect(text).toBe(g.text);
  });

  test("layout.pages through the deskew rotate-back to final.pages", () => {
    const g = loadParseGolden(name);
    // SAFETY: layout.pages is the ParsedPage[] after apply_layout.
    const pages = (stage(g, "layout.pages") as unknown[]).map(parsedPageFromJson);
    rotateBackOcrDeskew(pages);
    expect(canon(pages)).toEqual(canon(stage(g, "final.pages")));
    expect(canon(pages)).toEqual(canon(g.pages));
    // A second call is a no-op: the first consumed the angle.
    rotateBackOcrDeskew(pages);
    expect(canon(pages)).toEqual(canon(stage(g, "final.pages")));
  });
});

describe("render_page_markdown", () => {
  test("a page without projected lines falls back to fenced text", () => {
    const out = renderPageMarkdown(page(1, "hello"), null);
    expect(out).toBe("```text\nhello\n```");
  });

  test("the fence does not repeat a trailing newline", () => {
    expect(renderPageMarkdown(page(1, "hello\n"), null)).toBe("```text\nhello\n```");
    expect(renderPageMarkdown(page(1, ""), null)).toBe("```text\n\n```");
  });

  test("an empty block list renders an empty page", () => {
    expect(renderPageMarkdown(page(1, "ignored"), [])).toBe("");
  });
});

describe("apply_layout", () => {
  const para = (text: string): PositionedBlock => ({
    block: { Paragraph: { text, bold: false, italic: false } },
    bbox: null,
    text_item_indices: [],
  });

  test("pages join with a rule and keep their own markdown without it", () => {
    const pages = [page(1), page(2)];
    const out = applyLayoutBlocks(
      pages,
      [[para("A page.")], [para("B page.")]],
      MARKDOWN_AND_BLOCKS
    );
    expect(out).toBe("A page.\n\n-----\n\nB page.");
    expect(pages.map((p) => p.markdown)).toEqual(["A page.", "B page."]);
    expect(pages[0].blocks?.[0]).toMatchObject({ kind: "paragraph", text: "A page." });
  });

  test("a page with no blocks reports an empty block list and fenced markdown", () => {
    const pages = [page(1, "raw")];
    const out = applyLayoutBlocks(pages, [null], MARKDOWN_AND_BLOCKS);
    expect(pages[0].blocks).toEqual([]);
    expect(out).toBe("```text\nraw\n```");
  });

  test("blocks only: no markdown, no joined text", () => {
    const pages = [page(1)];
    const out = applyLayoutBlocks(pages, [[para("A.")]], {
      wantsMarkdown: false,
      extractBlocks: true,
    });
    expect(out).toBeNull();
    expect(pages[0].markdown).toBe("");
    expect(pages[0].blocks?.length).toBe(1);
  });

  test("markdown only: pages carry no blocks", () => {
    const pages = [page(1)];
    const out = applyLayoutBlocks(pages, [[para("A.")]], {
      wantsMarkdown: true,
      extractBlocks: false,
    });
    expect(out).toBe("A.");
    expect(pages[0].blocks).toBeUndefined();
  });

  test("neither output wanted: nothing runs", () => {
    const pages = [page(1)];
    const out = applyLayoutBlocks(pages, [[para("A.")]], {
      wantsMarkdown: false,
      extractBlocks: false,
    });
    expect(out).toBeNull();
    expect(pages[0].blocks).toBeUndefined();
  });

  test("a page with model blocks takes the model's blocks", () => {
    const p = page(1, "", {
      text_items: [textItem({ text: "Head", x: 10, y: 10, width: 50, height: 10 })],
      model_blocks: [{ bbox: { x: 5, y: 5, width: 100, height: 20 }, class: 1, text: "Head" }],
    });
    const md = applyLayoutPage(p, [para("Heuristic")], MARKDOWN_AND_BLOCKS);
    // The markdown still comes from the heuristic blocks; `blocks` from the model.
    expect(md).toBe("Heuristic");
    expect(p.blocks?.map((b) => b.kind)).toEqual(["heading"]);
    expect(p.blocks?.[0]).toMatchObject({ level: 2, text: "Head", text_item_indices: [0] });
  });

  test("joinPageMarkdown sets each page's markdown", () => {
    const pages = [page(1), page(2)];
    expect(joinPageMarkdown(pages, ["x", "y"])).toBe("x\n\n-----\n\ny");
    expect(pages.map((p) => p.markdown)).toEqual(["x", "y"]);
    expect(joinPageMarkdown([], [])).toBe("");
  });
});

describe("canonicalize_image_refs", () => {
  const image = (id: string, dup: string | null): ExtractedImage => ({
    id,
    name: `img_${id}.jpg`,
    page: 1,
    bbox: { x: 0, y: 0, width: 0, height: 0 },
    width: 1,
    height: 1,
    rotation: 0,
    format: "jpg",
    duplicate_of: dup,
  });

  test("points duplicates at the canonical file", () => {
    const pages = [page(1)];
    pages[0].markdown = "intro\n\n![](img_p2_1.jpg)\n\noutro";
    const images = [image("p1_1", null), image("p2_1", "p1_1")];
    const fullText = canonicalizeImageRefs(pages, pages[0].markdown, images);
    expect(pages[0].markdown).toBe("intro\n\n![](img_p1_1.jpg)\n\noutro");
    expect(fullText).toBe(pages[0].markdown);
  });

  test("rewrites every occurrence and ignores a duplicate_of that names no image", () => {
    const pages = [page(1)];
    pages[0].markdown = "![](img_p2_1.jpg) ![](img_p2_1.jpg) ![](img_p3_1.jpg)";
    const images = [image("p1_1", null), image("p2_1", "p1_1"), image("p3_1", "missing")];
    const out = canonicalizeImageRefs(pages, "![](img_p2_1.jpg)", images);
    expect(pages[0].markdown).toBe("![](img_p1_1.jpg) ![](img_p1_1.jpg) ![](img_p3_1.jpg)");
    expect(out).toBe("![](img_p1_1.jpg)");
  });

  test("a canonical name with a dollar sign is inserted literally", () => {
    const pages = [page(1)];
    pages[0].markdown = "![](img_b.jpg)";
    const canonical = { ...image("a", null), name: "img_$&.jpg" };
    canonicalizeImageRefs(pages, "", [canonical, image("b", "a")]);
    expect(pages[0].markdown).toBe("![](img_$&.jpg)");
  });

  test("no duplicates leaves everything alone", () => {
    const pages = [page(1)];
    pages[0].markdown = "![](img_p1_1.jpg)";
    expect(canonicalizeImageRefs(pages, "t", [image("p1_1", null)])).toBe("t");
    expect(pages[0].markdown).toBe("![](img_p1_1.jpg)");
  });
});

describe("rotate_back_ocr_deskew", () => {
  test("pages without a deskew are untouched, native items never move", () => {
    const items = [textItem({ x: 10, y: 20, width: 30, height: 5 })];
    const pages = [page(1, "", { text_items: items })];
    rotateBackOcrDeskew(pages);
    expect(pages[0].text_items[0]).toMatchObject({ x: 10, y: 20, width: 30, height: 5 });
  });

  test("a deskewed page moves its OCR items and block boxes back and clears the angle", () => {
    const ocr = textItem({
      text: "a",
      x: 100,
      y: 100,
      width: 50,
      height: 10,
      confidence: 0.9,
      words: [{ text: "a", x: 100, y: 100, width: 50, height: 10 }],
    });
    const native = textItem({ text: "n", x: 100, y: 200, width: 50, height: 10 });
    const p = page(1, "", { text_items: [ocr, native], ocr_deskew: 90 });
    p.blocks = [
      {
        kind: "table",
        bold: false,
        italic: false,
        text_item_indices: [],
        bbox: { x: 100, y: 100, width: 50, height: 10 },
        rows: [
          [{ text: "c", text_item_indices: [], bbox: { x: 100, y: 100, width: 50, height: 10 } }],
        ],
      },
      { kind: "paragraph", bold: false, italic: false, text_item_indices: [] },
    ];
    rotateBackOcrDeskew([p]);
    expect(p.ocr_deskew).toBeNull();
    // 90 degrees about (306, 396) sends (x, y) to (306 - (y - 396), 396 + (x - 306)).
    const b = p.text_items[0];
    expect(b.x).toBeCloseTo(592, 3);
    expect(b.y).toBeCloseTo(190, 3);
    expect([b.width, b.height]).toEqual([10, 50]);
    expect(p.text_items[1]).toMatchObject({ x: 100, y: 200 });
    expect(p.blocks?.[0].bbox).toMatchObject({ width: 10, height: 50 });
    expect(p.blocks?.[0].rows?.[0][0].bbox).toMatchObject({ width: 10, height: 50 });
    expect(p.blocks?.[1].bbox).toBeUndefined();
    // The word keeps its size and its centre follows the item.
    const w = b.words[0];
    expect([w.width, w.height]).toEqual([50, 10]);
    expect(w.x + w.width / 2).toBeCloseTo(b.x + b.width / 2, 3);
    expect(w.y + w.height / 2).toBeCloseTo(b.y + b.height / 2, 3);
  });
});
