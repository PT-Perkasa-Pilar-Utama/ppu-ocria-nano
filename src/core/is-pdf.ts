// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

/** Whether bytes start with the PDF header `%PDF-` (after up to 1 KiB of leading junk, as readers allow). */
export function isPdf(bytes: ArrayBuffer | Uint8Array): boolean {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const end = Math.min(d.length - 5, 1024);
  for (let i = 0; i <= end; i++) {
    if (
      d[i] === 0x25 &&
      d[i + 1] === 0x50 &&
      d[i + 2] === 0x44 &&
      d[i + 3] === 0x46 &&
      d[i + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}
