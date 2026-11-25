// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/encodings.rs (crates-v2.21.2, Apache-2.0).

// cmex (OMX) code table, split from encodings.ts to stay under the file-size cap.

const D: readonly string[] = [
  "(",
  ")",
  "[",
  "]",
  "\\lfloor",
  "\\rfloor",
  "\\lceil",
  "\\rceil",
  "\\{",
  "\\}",
  "\\langle",
  "\\rangle",
  "|",
  "\\|",
  "/",
  "\\backslash",
];

const inRange = (code: number, lo: number, hi: number): boolean => code >= lo && code <= hi;

/**
 * cmex: big delimiters read as their plain selves (KaTeX renders `\big(` as "("). Extension
 * pieces of tall delimiters: the top piece stands for the delimiter, the rest map to "".
 */
export function decodeOmx(code: number): string | null {
  if (code < 16) return D[code];
  switch (code) {
    case 16:
    case 18:
    case 32:
    case 48:
      return "(";
    case 17:
    case 19:
    case 33:
    case 49:
      return ")";
    case 20:
    case 34:
    case 50:
    case 104:
      return "[";
    case 21:
    case 35:
    case 51:
    case 105:
      return "]";
    case 22:
    case 36:
    case 106:
      return "\\lfloor";
    case 23:
    case 37:
    case 107:
      return "\\rfloor";
    case 24:
    case 38:
    case 108:
      return "\\lceil";
    case 25:
    case 39:
    case 109:
      return "\\rceil";
    case 26:
    case 40:
    case 56:
    case 110:
      return "\\{";
    case 27:
    case 41:
    case 57:
    case 111:
      return "\\}";
    case 28:
    case 42:
    case 68:
      return "\\langle";
    case 29:
    case 43:
    case 69:
      return "\\rangle";
    case 30:
    case 44:
    case 46:
      return "/";
    case 31:
    case 45:
    case 47:
      return "\\backslash";
    case 70:
    case 71:
      return "\\bigsqcup";
    case 72:
    case 73:
      return "\\oint";
    case 74:
    case 75:
      return "\\bigodot";
    case 76:
    case 77:
      return "\\bigoplus";
    case 78:
    case 79:
      return "\\bigotimes";
    case 80:
    case 88:
      return "\\sum";
    case 81:
    case 89:
      return "\\prod";
    case 82:
    case 90:
      return "\\int";
    case 83:
    case 91:
      return "\\bigcup";
    case 84:
    case 92:
      return "\\bigcap";
    case 85:
    case 93:
      return "\\biguplus";
    case 86:
    case 94:
      return "\\bigwedge";
    case 87:
    case 95:
      return "\\bigvee";
    case 96:
    case 97:
      return "\\coprod";
  }
  if (inRange(code, 52, 55) || inRange(code, 58, 67)) return "";
  if (inRange(code, 98, 100)) return "ACC:widehat";
  if (inRange(code, 101, 103)) return "ACC:widetilde";
  if (inRange(code, 112, 116)) return "SQRT";
  return null;
}
