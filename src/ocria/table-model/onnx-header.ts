// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/net.rs `from_onnx` (crates-v2.21.2, Apache-2.0): the header in the ONNX file's metadata.

// onnxruntime-node and -web expose no custom metadata, so `metadata_props`
// (ModelProto field 14: repeated StringStringEntryProto { key = 1, value = 2 })
// is read from the protobuf bytes. Only the top-level fields are walked; the
// graph is skipped by its length.

const METADATA_PROPS = 14;

type Reader = { buf: Uint8Array; pos: number };

/** A varint, as a number (multiplication, not `<<`, so values past 2^31 stay exact). */
function varint(r: Reader): number {
  let v = 0;
  let scale = 1;
  for (;;) {
    if (r.pos >= r.buf.length) throw new Error("ONNX protobuf ends inside a varint");
    const b = r.buf[r.pos++];
    v += (b & 0x7f) * scale;
    if (b < 0x80) return v;
    scale *= 128;
  }
}

/** Skip a field's value of wire type `wire`; returns the length-delimited payload span for wire type 2. */
function skip(r: Reader, wire: number): [number, number] | null {
  switch (wire) {
    case 0:
      varint(r);
      return null;
    case 1:
      r.pos += 8;
      return null;
    case 2: {
      const len = varint(r);
      const span: [number, number] = [r.pos, r.pos + len];
      r.pos += len;
      return span;
    }
    case 5:
      r.pos += 4;
      return null;
    default:
      throw new Error(`ONNX protobuf has an unsupported wire type ${wire}`);
  }
}

/** One StringStringEntryProto: its key and value. */
function entry(buf: Uint8Array): [string, string] {
  const r: Reader = { buf, pos: 0 };
  const dec = new TextDecoder();
  let key = "";
  let value = "";
  while (r.pos < buf.length) {
    const tag = varint(r);
    const field = Math.floor(tag / 8);
    const span = skip(r, tag % 8);
    if (span === null) continue;
    const text = dec.decode(buf.subarray(span[0], span[1]));
    if (field === 1) key = text;
    else if (field === 2) value = text;
  }
  return [key, value];
}

/** The value of the `metadata_props` entry named `key` in an ONNX model, or null when it has none. */
export function readOnnxMetadata(bytes: Uint8Array, key: string): string | null {
  const r: Reader = { buf: bytes, pos: 0 };
  while (r.pos < bytes.length) {
    const tag = varint(r);
    const span = skip(r, tag % 8);
    if (span === null || Math.floor(tag / 8) !== METADATA_PROPS) continue;
    const [k, v] = entry(bytes.subarray(span[0], span[1]));
    if (k === key) return v;
  }
  return null;
}
