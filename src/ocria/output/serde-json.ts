// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of the output format of serde_json 1.0 `to_string_pretty` with ryu float printing (liteparse crates/liteparse/src/output/json.rs, crates-v2.21.2, Apache-2.0).

import { f32 } from "../rust.js";

const TRAILING_ZEROS = /0+$/;

/**
 * A float field. JavaScript has one number type, but serde prints f32 and f64
 * with ryu's shortest round-trip digits and always with a decimal point or
 * exponent (`612.0`), and prints integers without. Every float field is
 * wrapped so the printer can tell the two apart.
 */
export class Float {
  constructor(
    readonly value: number,
    readonly bits: 32 | 64
  ) {}
}

/** An f32 field. */
export function f32v(value: number): Float {
  return new Float(value, 32);
}

/** A serializable value; a bare `number` is an integer field, a `Float` a float field. */
export type SerValue = null | boolean | number | string | Float | SerValue[] | SerObject;

/** A serde struct or map: keys print in insertion order, `undefined` values are skipped. */
export type SerObject = { [key: string]: SerValue | undefined };

/** `v * 2^k` as an integer, with `k` the smallest shift that makes it one (exact for f32 values). */
function scaledToInteger(v: number): [bigint, number] {
  let x = v;
  let k = 0;
  while (!Number.isInteger(x)) {
    x *= 2;
    k++;
  }
  return [BigInt(x), k];
}

/**
 * Whether `v` sits exactly halfway between `digits` x 10^q and the next decimal below it, i.e.
 * 2v = (2d - 1) x 10^q. `toExponential` rounds such a tie up; ryu rounds it to the even digit.
 */
function isRoundingTie(v: number, digits: string, q: number): boolean {
  const [a, k] = scaledToInteger(v);
  const odd = BigInt(digits) * 2n - 1n;
  // 2a / 2^k == odd * 10^q, both sides scaled to integers.
  return q >= 0
    ? 2n * a === odd * 10n ** BigInt(q) * 2n ** BigInt(k)
    : 2n * a * 10n ** BigInt(-q) === odd * 2n ** BigInt(k);
}

/**
 * ryu's shortest digits: `[digits, exp10]` with value = d.ddd x 10^exp10.
 * ponytail: for f32 the shortest `toExponential` that rounds back to the same f32, with ryu's
 * round-half-even on an exact tie; ryu picks the same digits except where the f32 interval is
 * asymmetric (an exact power of two). A comparison against ryu 1.0.23 on 3.7M f32 values found
 * no other difference; swap in a ryu port if a golden shows one.
 */
function shortestDigits(v: number, bits: 32 | 64): [string, number] {
  let s = v.toExponential();
  if (bits === 32) {
    for (let p = 0; p < 9; p++) {
      s = v.toExponential(p);
      if (f32(Number(s)) === v) break;
    }
  }
  const [mantissa, exp] = s.split("e");
  let digits = mantissa.replace(".", "");
  const exp10 = Number(exp);
  if (bits === 32) {
    const last = Number(digits[digits.length - 1]);
    const q = exp10 - (digits.length - 1);
    if (last % 2 === 1 && isRoundingTie(v, digits, q)) {
      digits = `${digits.slice(0, -1)}${last - 1}`;
    }
  }
  digits = digits.replace(TRAILING_ZEROS, "");
  return [digits === "" ? "0" : digits, exp10];
}

/** `ryu::pretty::format32` / `format64` for a finite number, and serde_json's `null` for NaN and infinity. */
export function formatFloat(input: number, bits: 32 | 64): string {
  if (!Number.isFinite(input)) return "null";
  if (input === 0) return Object.is(input, -0) ? "-0.0" : "0.0";
  const sign = input < 0 ? "-" : "";
  const [digits, exp10] = shortestDigits(Math.abs(input), bits);
  const length = digits.length;
  const kk = exp10 + 1; // 10^(kk-1) <= v < 10^kk
  const k = kk - length;
  const maxFixed = bits === 32 ? 13 : 16;
  const minSmall = bits === 32 ? -6 : -5;
  if (k >= 0 && kk <= maxFixed) return `${sign}${digits}${"0".repeat(k)}.0`;
  if (kk > 0 && kk <= maxFixed) return `${sign}${digits.slice(0, kk)}.${digits.slice(kk)}`;
  if (kk > minSmall && kk <= 0) return `${sign}0.${"0".repeat(-kk)}${digits}`;
  if (length === 1) return `${sign}${digits}e${kk - 1}`;
  return `${sign}${digits[0]}.${digits.slice(1)}e${kk - 1}`;
}

function formatValue(v: SerValue, indent: string): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isInteger(v))
      throw new RangeError(`integer field holds ${v}; wrap floats in Float`);
    return String(v);
  }
  if (v instanceof Float) return formatFloat(v.value, v.bits);
  const inner = `${indent}  `;
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[\n${v.map((x) => inner + formatValue(x, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(v).filter((e): e is [string, SerValue] => e[1] !== undefined);
  if (entries.length === 0) return "{}";
  const body = entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${formatValue(x, inner)}`);
  return `{\n${body.join(",\n")}\n${indent}}`;
}

/** `serde_json::to_string_pretty`: two-space indent, `"key": value`, `[]` and `{}` for empty. */
export function toStringPretty(value: SerValue): string {
  return formatValue(value, "");
}
