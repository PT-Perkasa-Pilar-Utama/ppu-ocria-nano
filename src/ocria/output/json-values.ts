// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of the serde derives of liteparse crates/liteparse/src/types.rs, layout.rs and output/json.rs (crates-v2.21.2, Apache-2.0): field order, skipped fields and float types.

import type { LayoutBlock, LayoutCell } from "../layout/types.js";
import type {
  DocumentAnnotation,
  FormField,
  StructureTree,
  StructureTreeElement,
} from "../types/document.js";
import type { Rect, VectorGraphics } from "../types/geometry.js";
import type { JsonImage, JsonPage, JsonTextItem, ParseResultJson } from "./json-types.js";
import type { SerObject, SerValue } from "./serde-json.js";
import { f32v } from "./serde-json.js";
import type { XfaPacket } from "./types.js";

function rectValue(r: Rect): SerObject {
  return { x: f32v(r.x), y: f32v(r.y), width: f32v(r.width), height: f32v(r.height) };
}

/** `Option<T>` with `skip_serializing_if = "Option::is_none"`: absent for `null` and `undefined`. */
function opt<T>(v: T | null | undefined, map: (x: T) => SerValue): SerValue | undefined {
  return v == null ? undefined : map(v);
}

const str = (s: string): SerValue => s;
const f32Opt = (v: number | null | undefined): SerValue | undefined => opt(v, f32v);
const nonEmpty = (v: SerValue[]): SerValue[] | undefined => (v.length === 0 ? undefined : v);

function layoutCellValue(c: LayoutCell): SerObject {
  return {
    text: c.text,
    bbox: opt(c.bbox, rectValue),
    colspan: c.colspan,
    rowspan: c.rowspan,
    text_item_indices: c.text_item_indices,
  };
}

/** `LayoutBlock` as serde writes it: unset variant fields and false flags are skipped. */
export function layoutBlockValue(b: LayoutBlock): SerObject {
  return {
    kind: b.kind,
    text: b.text,
    level: b.level,
    bold: b.bold ? true : undefined,
    italic: b.italic ? true : undefined,
    ordered: b.ordered,
    marker: b.marker,
    lines: b.lines,
    lang: b.lang,
    header: opt(b.header, (h) => h.map(layoutCellValue)),
    rows: opt(b.rows, (rows) => rows.map((r) => r.map(layoutCellValue))),
    header_rows: b.header_rows,
    id: b.id,
    format: b.format,
    bbox: opt(b.bbox, rectValue),
    text_item_indices: b.text_item_indices,
  };
}

function vectorGraphicsValue(v: VectorGraphics): SerObject {
  return {
    shapes: v.shapes.map((s) => ({
      bbox: rectValue(s.bbox),
      stroke: s.stroke,
      stroke_color: s.stroke_color,
      fill: s.fill,
      fill_color: s.fill_color,
      has_curve: s.has_curve,
    })),
    lines: v.lines.map((l) => ({
      x1: f32v(l.x1),
      y1: f32v(l.y1),
      x2: f32v(l.x2),
      y2: f32v(l.y2),
      stroke: l.stroke,
      stroke_width: f32Opt(l.stroke_width),
      stroke_color: l.stroke_color,
      fill: l.fill,
      fill_color: l.fill_color,
    })),
  };
}

function annotationValue(a: DocumentAnnotation): SerObject {
  return {
    subtype: a.subtype,
    contents: opt(a.contents, str),
    created: opt(a.created, str),
    modified: opt(a.modified, str),
    title: opt(a.title, str),
    rect: opt(a.rect, rectValue),
    quadpoint_rects: nonEmpty(a.quadpoint_rects.map(rectValue)),
    uri: opt(a.uri, str),
  };
}

function formFieldValue(f: FormField): SerObject {
  return {
    id: f.id,
    type: f.type,
    page: f.page,
    annotation_index: f.annotation_index,
    widget_index: f.widget_index,
    object_number: opt(f.object_number, (n) => n),
    name: opt(f.name, str),
    alternate_name: opt(f.alternate_name, str),
    value: opt(f.value, str),
    export_value: opt(f.export_value, str),
    field_flags: f.field_flags,
    control_count: opt(f.control_count, (n) => n),
    control_index: opt(f.control_index, (n) => n),
    checked: opt(f.checked, (c) => c),
    rect: opt(f.rect, rectValue),
    options: nonEmpty(f.options),
    selected_options: nonEmpty(f.selected_options),
  };
}

/** `StructureAttributeValue`, untagged: a number is `Number(f32)`. */
function attributeValue(v: boolean | number | string): SerValue {
  return typeof v === "number" ? f32v(v) : v;
}

/** `BTreeMap<String, _>` iterates sorted by key, in UTF-8 byte order (code point order). */
function sortedEntries<T>(map: Record<string, T>): Array<[string, T]> {
  return Object.entries(map).sort(([a], [b]) => {
    const pa = Array.from(a, (c) => c.codePointAt(0) ?? 0);
    const pb = Array.from(b, (c) => c.codePointAt(0) ?? 0);
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }
    return pa.length - pb.length;
  });
}

function structureElementValue(e: StructureTreeElement): SerObject {
  const attributes = sortedEntries(e.attributes);
  return {
    type: e.type,
    id: opt(e.id, str),
    actual_text: opt(e.actual_text, str),
    alt_text: opt(e.alt_text, str),
    title: opt(e.title, str),
    attributes:
      attributes.length === 0
        ? undefined
        : Object.fromEntries(attributes.map(([k, v]) => [k, attributeValue(v)])),
    marked_content_ids: e.marked_content_ids,
    children: e.children.map(structureElementValue),
    annotations: e.annotations.map(annotationValue),
  };
}

function structureTreeValue(t: StructureTree): SerObject {
  return { roots: t.roots.map(structureElementValue) };
}

function textItemValue(t: JsonTextItem): SerObject {
  return {
    text: t.text,
    x: f32v(t.x),
    y: f32v(t.y),
    width: f32v(t.width),
    height: f32v(t.height),
    rotation: f32Opt(t.rotation),
    font_name: t.font_name,
    font_size: f32Opt(t.font_size),
    font_height: f32Opt(t.font_height),
    font_ascent: f32Opt(t.font_ascent),
    font_descent: f32Opt(t.font_descent),
    font_weight: t.font_weight,
    text_width: f32Opt(t.text_width),
    font_is_buggy: t.font_is_buggy,
    mcid: t.mcid,
    fill_color: t.fill_color,
    stroke_color: t.stroke_color,
    char_codes: nonEmpty(t.char_codes),
    trailing_space_generated: t.trailing_space_generated ? true : undefined,
    confidence: f32Opt(t.confidence),
  };
}

function pageValue(p: JsonPage): SerObject {
  return {
    page: p.page,
    page_label: p.page_label,
    width: f32v(p.width),
    height: f32v(p.height),
    content_bounds: opt(p.content_bounds, rectValue),
    text: p.text,
    text_items: p.text_items.map(textItemValue),
    vector_graphics: opt(p.vector_graphics, vectorGraphicsValue),
    annotations: opt(p.annotations, (a) => a.map(annotationValue)),
    form_fields: opt(p.form_fields, (f) => f.map(formFieldValue)),
    structure_tree: opt(p.structure_tree, structureTreeValue),
    blocks: opt(p.blocks, (b) => b.map(layoutBlockValue)),
  };
}

function imageValue(i: JsonImage): SerObject {
  return {
    id: i.id,
    name: i.name,
    path: i.path,
    page: i.page,
    bbox: rectValue(i.bbox),
    width: i.width,
    height: i.height,
    rotation: f32v(i.rotation),
    format: i.format,
    duplicate_of: i.duplicate_of,
  };
}

function xfaPacketValue(x: XfaPacket): SerObject {
  return {
    index: x.index,
    name: opt(x.name, str),
    content_length: x.content_length,
    content: opt(x.content, str),
  };
}

/** `ParseResultJson` as serde writes it. */
export function parseResultValue(r: ParseResultJson): SerObject {
  return {
    total_pages: r.total_pages,
    pages: r.pages.map(pageValue),
    page_errors: nonEmpty(r.page_errors.map((e) => ({ page: e.page, message: e.message }))),
    images: nonEmpty(r.images.map(imageValue)),
    image_error_count: r.image_error_count === 0 ? undefined : r.image_error_count,
    form_type: r.form_type,
    xfa_packets: opt(r.xfa_packets, (x) => x.map(xfaPacketValue)),
  };
}
