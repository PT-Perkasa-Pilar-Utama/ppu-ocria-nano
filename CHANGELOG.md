# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - Unreleased

First release: OCRia-nano-1 v1.0.0 through a TypeScript port of LiteParse
crates-v2.21.2.

### Added

- `OcriaNanoService` for Node.js and Bun (`ppu-ocria-nano`), browsers and web
  workers (`ppu-ocria-nano/web`), and React Native (`ppu-ocria-nano/mobile`):
  `initialize`, `convert` (an image to a `Page` with markdown, text, items and
  blocks), `recognize` (the OCR stage), `detect` (line quads),
  `convertBatch`, `convertStream`, `destroy`. One-shots `ocr()` and
  `detect()`.
- The OCR stage of LiteParse's ocria-nano engine: the line detector with the
  faint short-token pass, the column-gutter split, the sideways-page retry,
  the script router, the four recognizers with the script rescue, homoglyph
  folding and the junk filter.
- LiteParse's stages after OCR as exported functions: OCR merge with deskew,
  grid projection, LayoutNet (`tablenet.onnx` on ONNX Runtime) with table
  decoding and resegmentation, block classification, markdown, layout
  blocks, and LiteParse's JSON and text output.
- PDF input (`ppu-ocria-nano/pdf`) on LiteParse's patched pdfium, linked into
  WebAssembly by this repository (`scripts/pdfium/build.sh`). It ports
  LiteParse's text extraction, OCR page selection and the table inputs. With
  the host's standard-14 substitute fonts (`hostFonts()`, the default on Node,
  Bun and Deno) it matches LiteParse's output on the ten test PDFs.
- The model files download from `llamaindex/OCRia-nano-1` at the v1.0.0 commit
  and are checked against LiteParse's size and SHA-256 pins, with
  `snowfluke/ppu-ocria-nano-models` as the mirror.
- CLI `ppu-ocria-nano` (`convert`, `detect`, `download-models`,
  `clear-cache`, `models`), the REST server in `apps/serve`, and the
  playground.
