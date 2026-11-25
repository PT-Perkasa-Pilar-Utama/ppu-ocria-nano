// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of decoded_pixels in liteparse crates/liteparse/src/ocr/image.rs (crates-v2.21.2, Apache-2.0).

/**
 * RGBA pixels (from a canvas) as the RGB buffer the engine reads, with
 * transparent pixels composited onto white as the reference does.
 */
export function rgbaToRgb(rgba: ArrayLike<number>): Uint8Array {
  const n = rgba.length >> 2;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    for (let c = 0; c < 3; c++) {
      const v = rgba[i * 4 + c];
      out[i * 3 + c] = a === 255 ? v : Math.floor((v * a + 255 * (255 - a) + 127) / 255);
    }
  }
  return out;
}
