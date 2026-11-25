// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// output/json.rs and output/text.rs: the `#[cfg(test)]` tests of both files, the
// printer's float formats (serde_json with ryu), and `format_text` / `format_json`
// on every golden's `final.pages`. No golden holds the JSON string itself, so the
// golden check parses the output back and compares it with the pages.

import { describe, expect, test } from "bun:test";

import { buildJson } from "../../src/ocria/output/build-json.js";
import {
  formatJson,
  formatJsonResult,
  formatJsonWithTextMetadata,
} from "../../src/ocria/output/json.js";
import { formatText } from "../../src/ocria/output/text.js";
import type { ParseResult } from "../../src/ocria/output/types.js";
import type { ParsedPage } from "../../src/ocria/types/page.js";
import type { TextItem } from "../../src/ocria/types/text-item.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import type { Json } from "./parse-golden.js";
import { parsedPageFromJson } from "./parse-golden.js";

function page(items: TextItem[] = [], over: Partial<ParsedPage> = {}): ParsedPage {
  return parsedPageFromJson({
    page_number: 1,
    page_width: 612,
    page_height: 792,
    text: "txt",
    text_items: items,
    ...over,
  });
}

const textPage = (n: number, text: string): ParsedPage =>
  page([], { page_number: n, text, page_width: 0, page_height: 0 });

function item(text: string, confidence?: number): TextItem {
  return textItem({
    text,
    x: 1,
    y: 2,
    width: 3,
    height: 4,
    font_name: "Helv",
    font_size: 10,
    ...(confidence === undefined ? {} : { confidence }),
  });
}

/** A printed document read back, as `serde_json::Value`. */
function parse(s: string): Json {
  // SAFETY: the printer writes JSON.
  return JSON.parse(s) as Json;
}

/** The value at a dot path (`pages.0.text`), or `undefined` when a key on the way is missing. */
function get(v: Json, path: string): Json | undefined {
  let cur: Json | undefined = v;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as { [k: string]: Json | undefined })[key];
  }
  return cur;
}

describe("format_text", () => {
  test("empty", () => {
    expect(formatText([])).toBe("");
  });

  test("single page", () => {
    const out = formatText([textPage(1, "hello")]);
    expect(out).toContain("--- Page 1 ---");
    expect(out).toContain("hello");
    expect(out).toBe("\n--- Page 1 ---\nhello");
  });

  test("multiple pages joined", () => {
    const out = formatText([textPage(1, "a"), textPage(2, "b")]);
    expect(out).toContain("--- Page 1 ---");
    expect(out).toContain("--- Page 2 ---");
    expect(out.indexOf("a")).toBeLessThan(out.indexOf("b"));
    expect(out).toBe("\n--- Page 1 ---\na\n\n\n--- Page 2 ---\nb");
  });
});

describe("format_json", () => {
  test("structure tree uses snake_case and keeps typed attributes", () => {
    const p = page([], {
      structure_tree: {
        roots: [
          {
            type: "Figure",
            id: "figure-1",
            actual_text: "diagram",
            alt_text: "A diagram",
            attributes: { Width: 42.5, Placement: "Block", Decorative: false, Place: 1, Width2: 2 },
            marked_content_ids: [7],
            children: [],
            annotations: [],
          },
        ],
      },
    });
    const value = parse(formatJson([p]));
    const root = "pages.0.structure_tree.roots.0";
    expect(get(value, `${root}.type`)).toBe("Figure");
    expect(get(value, `${root}.actual_text`)).toBe("diagram");
    expect(get(value, `${root}.marked_content_ids.0`)).toBe(7);
    expect(get(value, `${root}.attributes.Decorative`)).toBe(false);
    expect(get(value, `${root}.attributes.Width`)).toBe(42.5);
    expect(get(value, `${root}.attributes.Placement`)).toBe("Block");
    expect(get(value, `${root}.actualText`)).toBeUndefined();
    // BTreeMap order: sorted by key.
    expect(Object.keys(get(value, `${root}.attributes`) ?? {})).toEqual([
      "Decorative",
      "Place",
      "Placement",
      "Width",
      "Width2",
    ]);
    expect(formatJson([p])).toContain('"Width": 42.5');
  });

  test("native text defaults confidence to one", () => {
    const j = buildJson([page([item("hi")])], false);
    expect(j.pages.length).toBe(1);
    expect(j.pages[0].page).toBe(1);
    expect(j.pages[0].text_items[0].confidence).toBe(1);
    expect(j.pages[0].text_items[0].font_name).toBe("Helv");
  });

  test("preserves OCR confidence", () => {
    const conf = Math.fround(0.42);
    const j = buildJson([page([item("hi", conf)])], false);
    expect(j.pages[0].text_items[0].confidence).toBe(conf);
    expect(formatJson([page([item("hi", conf)])])).toContain('"confidence": 0.42\n');
  });

  test("is pretty-printed", () => {
    const s = formatJson([page([item("hi")])]);
    expect(s).toContain("\n");
    expect(s).toContain('"text": "hi"');
    expect(s).toContain('"page": 1');
  });

  test("preserves text metadata", () => {
    const t = textItem({
      ...item("hi"),
      font_height: 11,
      font_ascent: 8,
      font_descent: -2,
      font_weight: 700,
      text_width: 9.5,
      font_is_buggy: true,
      mcid: 4,
      fill_color: "ff112233",
      stroke_color: "ff445566",
      char_codes: [104, 105, 32],
      trailing_space_generated: true,
    });
    const value = parse(formatJsonWithTextMetadata([page([t])], true));
    const at = (key: string) => get(value, `pages.0.text_items.0.${key}`);
    expect(at("font_height")).toBe(11);
    expect(at("font_ascent")).toBe(8);
    expect(at("font_descent")).toBe(-2);
    expect(at("font_weight")).toBe(700);
    expect(at("text_width")).toBe(9.5);
    expect(at("font_is_buggy")).toBe(true);
    expect(at("mcid")).toBe(4);
    expect(at("fill_color")).toBe("ff112233");
    expect(at("stroke_color")).toBe("ff445566");
    expect(at("char_codes")).toEqual([104, 105, 32]);
    expect(at("trailing_space_generated")).toBe(true);
    expect(at("rotation")).toBe(0);
    expect(formatJsonWithTextMetadata([page([t])], true)).toContain('"rotation": 0.0');
  });

  test("empty", () => {
    expect(buildJson([], false).pages).toEqual([]);
    expect(formatJson([])).toBe('{\n  "total_pages": 0,\n  "pages": []\n}');
  });

  test("text metadata is omitted by default", () => {
    const t = textItem({
      ...item("hi"),
      font_height: 11,
      font_is_buggy: true,
      mcid: 4,
      char_codes: [104, 105],
      trailing_space_generated: true,
    });
    const value = parse(formatJson([page([t])]));
    const keys = ["rotation", "font_height", "font_is_buggy", "mcid", "char_codes"];
    for (const key of [...keys, "trailing_space_generated"]) {
      expect(get(value, `pages.0.text_items.0.${key}`)).toBeUndefined();
    }
  });

  test("result includes image metadata and errors", () => {
    const result: ParseResult = {
      total_pages: 3,
      pages: [],
      page_errors: [{ page: 3, message: "page extraction failed" }],
      images: [
        {
          id: "p2_0",
          name: "img_p2_1.jpg",
          path: "/tmp/images/img_p2_1.jpg",
          page: 2,
          bbox: { x: 10, y: 20, width: 30, height: 40 },
          width: 640,
          height: 480,
          rotation: 90,
          format: "jpg",
          duplicate_of: "p1_0",
        },
      ],
      image_error_count: 2,
      form_type: null,
      xfa_packets: [{ index: 0, name: "datasets", content_length: 11, content: "<xml></xml>" }],
    };
    const s = formatJsonResult(result, false);
    const value = parse(s);
    expect(get(value, "total_pages")).toBe(3);
    for (const absent of ["creator", "producer", "doc_meta", "form_type", "images.0.bytes"]) {
      expect(get(value, absent)).toBeUndefined();
    }
    expect(get(value, "xfa_packets.0.name")).toBe("datasets");
    expect(get(value, "xfa_packets.0.content_length")).toBe(11);
    expect(get(value, "images.0.bbox.x")).toBe(10);
    expect(get(value, "images.0.width")).toBe(640);
    expect(get(value, "images.0.rotation")).toBe(90);
    expect(get(value, "images.0.duplicate_of")).toBe("p1_0");
    expect(get(value, "image_error_count")).toBe(2);
    expect(get(value, "page_errors.0.page")).toBe(3);
    expect(get(value, "page_errors.0.message")).toBe("page extraction failed");
    // Integers print without a decimal point, f32 fields with one.
    expect(s).toContain('"width": 640,');
    expect(s).toContain('"rotation": 90.0,');
    expect(s).toContain('"x": 10.0,');
  });

  test("vector graphics are absent by default and written when present", () => {
    expect(formatJson([page()])).not.toContain("vector_graphics");
    const withVectors = page([], {
      vector_graphics: {
        shapes: [
          {
            bbox: { x: 1, y: 2, width: 3, height: 4 },
            stroke: true,
            stroke_color: "ff000000",
            fill: false,
            has_curve: true,
          },
        ],
        lines: [
          {
            x1: 0,
            y1: 1,
            x2: 2.5,
            y2: 1,
            stroke: true,
            stroke_width: 0.5,
            stroke_color: "ff000000",
            fill: false,
          },
        ],
      },
    });
    const s = formatJson([withVectors]);
    expect(s).toContain('"vector_graphics"');
    expect(s).toContain('"has_curve": true');
    expect(s).toContain('"stroke_color": "ff000000"');
    expect(s).toContain('"stroke_width": 0.5');
    expect(s).toContain('"x2": 2.5');
  });

  test("annotations are omitted when disabled", () => {
    expect(get(parse(formatJson([page()])), "pages.0.annotations")).toBeUndefined();
  });

  test("annotations are written when enabled", () => {
    const p = page([], {
      annotations: [
        {
          subtype: "highlight",
          contents: "review this",
          title: "Reviewer",
          rect: { x: 10, y: 20, width: 90, height: 20 },
          quadpoint_rects: [],
        },
      ],
    });
    const value = parse(formatJson([p]));
    expect(get(value, "pages.0.annotations.0.subtype")).toBe("highlight");
    expect(get(value, "pages.0.annotations.0.rect.width")).toBe(90);
    expect(get(value, "pages.0.annotations.0.quadpoint_rects")).toBeUndefined();
  });

  test("form fields use the public snake_case schema", () => {
    const p = page([], {
      form_fields: [
        {
          id: "full_name",
          type: "text",
          page: 1,
          annotation_index: 2,
          widget_index: 0,
          object_number: 42,
          name: "full_name",
          alternate_name: "Full name",
          value: "Ada",
          field_flags: 0,
          options: [],
          selected_options: [],
        },
      ],
    });
    const value = parse(formatJson([p]));
    expect(get(value, "pages.0.form_fields.0.type")).toBe("text");
    expect(get(value, "pages.0.form_fields.0.annotation_index")).toBe(2);
    expect(get(value, "pages.0.form_fields.0.alternate_name")).toBe("Full name");
    expect(get(value, "pages.0.form_fields.0.field_type")).toBeUndefined();
  });
});
