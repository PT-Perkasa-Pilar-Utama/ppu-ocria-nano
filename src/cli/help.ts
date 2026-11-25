// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Usage text for the `ppu-ocria-nano` CLI. Printed to stdout for `help` /
 * `--help`, and to stderr (followed by a non-zero exit) on usage errors.
 */

export const USAGE = `ppu-ocria-nano - OCRia-nano-1 on the command line

Usage:
  ppu-ocria-nano <command> [args] [flags]

Commands:
  convert <file...>      Parse images and PDFs (paths, globs, or http(s) URLs)
  detect <image>         Detect text lines only (JSON quads to stdout)
  download-models        Fill the model cache (~/.cache/ppu-ocria-nano)
  clear-cache            Delete the cached model files
  models                 Print the model files, their sizes, checksums and URLs
  help                   Show this help
  version                Show the installed version

Convert flags:
  --format <f>           markdown | text | json  (default markdown; text and json as lit parse writes them)
  --out <dir>            write one file per input (.md, .txt or .json)
  --keep-headers-footers keep page headers and footers in the markdown
  --no-layout            do not run LayoutNet (heuristic tables and blocks)

PDF flags:
  --dpi <n>              render resolution for OCR (default 250)
  --max-pages <n>        read at most n pages per PDF
  --password <p>         password for encrypted PDFs

Models and session:
  --model-dir <dir>      read model files from a folder instead of downloading (used as they are)
  --execution-providers <list>  comma-separated, e.g. cpu or cuda,cpu  (default cpu)

Output:
  -o, --output <file>    write everything to one file instead of stdout
  --pretty               indent JSON output
  -q, --quiet            suppress progress on stderr
  --verbose              log each step to stderr

Examples:
  ppu-ocria-nano convert scan.png
  ppu-ocria-nano convert "scans/*.png" --out results/
  ppu-ocria-nano convert report.pdf --format json --pretty
  ppu-ocria-nano detect receipt.jpg

The model files are LlamaIndex's (https://huggingface.co/llamaindex/OCRia-nano-1),
under the OCRia-nano-1 license with use restrictions.
`;
