# Design

This document describes what ppu-ocria-nano does, the actors it interacts
with, and how data flows through it. It complements the API reference in the
[README](../README.md).

## What it is

ppu-ocria-nano is a library (with an optional CLI and HTTP service) that runs
LlamaIndex's OCRia-nano-1 models as LiteParse runs them. A developer imports
it into their own Node, Bun, Deno, browser or React Native code and calls it
in-process. Inference runs locally through ONNX Runtime. The library does not
phone home; the only outbound traffic is the one-time model download (or
none, if models are supplied locally).

## Lifecycle

```ts
const ocr = new OcriaNanoService();
await ocr.initialize(); // load the models into ONNX Runtime sessions
const page = await ocr.convert(image); // or convertPdf(ocr, pdf) from ppu-ocria-nano/pdf
await ocr.destroy(); // free the sessions and native memory
```

## Actors

| Actor                 | Role                                                 | Trust                                                                                       |
| :-------------------- | :--------------------------------------------------- | :------------------------------------------------------------------------------------------ |
| Consuming application | Calls the API, supplies images, PDFs and options     | Trusted (it is the host)                                                                    |
| Image or PDF input    | Bytes the application passes in                      | **Untrusted** (may be malformed)                                                            |
| Model files           | Seven ONNX models, four charsets, two metadata files | Checked against pinned SHA-256 from the default source; **caller-controlled** if overridden |
| JavaScript runtime    | Node, Bun, Deno, a browser engine, React Native      | Trusted                                                                                     |
| ONNX Runtime          | Runs inference (native, WASM or mobile)              | Third-party, pinned                                                                         |
| `ppu-ocv`             | Image decoding into a canvas                         | First-party sibling, pinned                                                                 |
| pdfium (WebAssembly)  | PDF parsing and rendering, `/pdf` only               | LiteParse's build (`run-llama/pdfium-binaries` chromium/8172), linked here                  |

## Entry points

| Import                  | Inference backend          | Runtime                    |
| :---------------------- | :------------------------- | :------------------------- |
| `ppu-ocria-nano`        | `onnxruntime-node`         | Node, Bun                  |
| `ppu-ocria-nano/web`    | `onnxruntime-web` (WASM)   | Browser, worker, extension |
| `ppu-ocria-nano/mobile` | `onnxruntime-react-native` | React Native               |
| `ppu-ocria-nano/pdf`    | pdfium (WebAssembly)       | Node, Bun, Deno, browser   |

A CLI ships as the package `bin` (`npx ppu-ocria-nano ...`), and
`apps/serve` wraps the library as an HTTP service.

## Components

- **`src/ocria/`** is the platform-free pipeline, a line-by-line port of
  LiteParse `crates/liteparse/src` at tag `crates-v2.21.2`: one folder per
  Rust file (`ocr/` for the ocria-nano engine, `ocr-merge/`, `projection/`,
  `table-model/`, `resegment/`, `markdown-layout/`, `layout/`, `stages/`,
  `output/`) and `pipeline/parse-image.ts`, which composes them as
  `LiteParse::parse_resolved` does for an image. It imports no runtime: ONNX
  sessions are passed in. Its types follow serde's JSON form of the Rust
  types, so stage values compare directly with LiteParse's.
- **Services** (`src/core`, `src/processor`, `src/web`, `src/mobile`) load the
  models through a platform provider (`model-loader.ts`: pins, mirror,
  sessions; recognizers on first use), decode images, and map the result to
  the public `Page` (`page.ts`).
- **PDF** (`src/pdf`): the pdfium wrapper, text-layer extraction, OCR page
  selection and rendering, then the same stages.
- **Model catalogue** (`src/model-catalogue.ts`) pins each file by release,
  size and SHA-256.
- **Model cache** stores downloads on disk (Node, Bun).

## Data flow (an image)

```
image bytes
     |
     v
 decode -> RGB, dpi from the file (else 150) -> page of w x 72/dpi points
     |
     +------------------------------+
     v                              v
 det.onnx -> line quads        LayoutNet raster (150 dpi resample)
 gutter split, sideways retry       |
 router.onnx -> script groups       |
 rec_*.onnx -> lines (recognize())  |
     |                              |
     v                              |
 OCR merge (deskew, filters)        |
     |                              |
     v                              v
 projection -> lines, signals -> tablenet.onnx -> tables, classes, blocks
     |
     v
 resegment, document signals, block classification
     |
     v
 markdown, layout blocks, rotate back -> Page
```

The library reads its input, runs inference in memory, and returns pages. On
Node and Bun it may read model files from disk and, on first run, download
them. It makes no other network requests (a browser also fetches the ONNX
Runtime WASM files) and writes only the model cache.

## Why it is split this way

Each Rust file has one TypeScript folder, and each stage takes its inputs as
arguments, so one implementation serves every runtime and each stage is
tested against LiteParse's recorded values for that stage. A LiteParse
release then lands as a diff of the Rust applied file by file. Each model is
its own ONNX session, as upstream ships them, so a stage can be run, replaced
or skipped on its own.
