---
name: skill-ppu-ocria-nano
description: Use this skill whenever the user writes TypeScript/JavaScript code that imports `ppu-ocria-nano`, `ppu-ocria-nano/web`, `ppu-ocria-nano/mobile` or `ppu-ocria-nano/pdf`, or asks about running LlamaIndex's OCRia-nano-1 models (or LiteParse's ocria-nano OCR) in a JavaScript runtime - image or PDF to markdown, text-line detection, line recognition, LayoutNet tables and layout blocks, LiteParse's JSON output, ONNX Runtime OCR in Node, Bun, Deno, browsers or React Native. Trigger even when the user says "OCRia in Node" or "LiteParse OCR in the browser" without naming the package, as long as the codebase imports it. This skill covers the entry points, the service lifecycle (`new` -> `initialize` -> `convert` -> `destroy`), the Page result, the OCR stage (`detect`, `recognize`), LiteParse's later stages as exported functions, PDF input, batches, the model files, cache and license, the CLI, and the `apps/serve` REST server.
---

# Writing code with `ppu-ocria-nano`

`ppu-ocria-nano` runs LlamaIndex's OCRia-nano-1 models through a TypeScript
port of LiteParse's pipeline, on ONNX Runtime. It turns an image or a PDF into
markdown, plain text, text items with boxes and layout blocks, and its output
matches LiteParse 2.21.2 stage by stage.

Read [references/configuration.md](references/configuration.md) for every
option. Read [references/recipes.md](references/recipes.md) for task-shaped
examples.

## The model license comes first

The code is Apache-2.0. The model files (ONNX models, character sets and
metadata) are LlamaIndex's, under the OCRia-nano-1 license. That license
forbids use by organizations above USD 2M in revenue or funding (except
personal use and Research Purposes) and use in a product that competes with
LlamaParse or LlamaCloud. A hosted service on the models counts as
distribution. Point the user to `LICENSE-STATUS.md` when they plan commercial
use. Do not tell them it is fine.

## The entry points

| Import                  | Runtime                       | ONNX Runtime peer                                         |
| ----------------------- | ----------------------------- | --------------------------------------------------------- |
| `ppu-ocria-nano`        | Node.js, Bun                  | `onnxruntime-node`                                        |
| `ppu-ocria-nano/web`    | Browsers, workers, extensions | `onnxruntime-web`                                         |
| `ppu-ocria-nano/mobile` | React Native                  | `onnxruntime-react-native` + `@shopify/react-native-skia` |
| `ppu-ocria-nano/pdf`    | Any of the first two, Deno    | none (pdfium WebAssembly ships with the package)          |

Deno uses JSR: `jsr:@snowfluke/ppu-ocria-nano`. Each entry exports the same
`OcriaNanoService` class name, with the platform's adapters.

## The lifecycle

```ts
import { OcriaNanoService } from "ppu-ocria-nano";

const service = new OcriaNanoService();
await service.initialize(); // downloads and checks the models on first run
const page = await service.convert(bytes);
await service.destroy(); // releases the ONNX sessions
```

Create one service and reuse it: `initialize()` builds the ONNX sessions.
`ocr(image)` and `detect(image)` are one-shots that load, run and release.

## Inputs

`convert`, `recognize` and `detect` take encoded image bytes (`ArrayBuffer` or
`Uint8Array`), a platform canvas, or raw pixels `{ data, width, height }`
whose length tells RGBA, RGB or grey apart. The page size in points comes
from the file's DPI metadata, else 150 dpi; canvases and raw pixels use 150.

## The Page result

| Field             | Content                                                       |
| ----------------- | ------------------------------------------------------------- |
| `markdown`        | headings, paragraphs, lists, pipe or HTML tables, code        |
| `text`            | the text laid out as on the page                              |
| `items`           | text items: `text`, box in points, `rotation`, `confidence`   |
| `blocks`          | layout blocks in reading order, the source of the markdown    |
| `width`, `height` | page size in points                                           |
| `dpi`             | image resolution of an OCR'd page: pixels = points × dpi / 72 |
| `parsed`          | LiteParse's `ParsedPage`, the input of the exported stages    |

Boxes are in points, not pixels. Convert with `dpi / 72`.

## Running the stages yourself

- `service.detect(image)` returns `{ boxes, faint }`: line quads in image
  pixels (`[[x, y] x 4]`, top-left first along the text).
- `service.recognize(image)` returns the OCR stage's `OcrResult[]`: `text`,
  `confidence`, `bbox` and `polygon` in image pixels.
- The later stages are functions over LiteParse's serde-shaped types:
  `mergeOcrResults`, `projectPagesForMarkdown`, `runPage` (LayoutNet; needs
  `service.models.layout`), `resegmentByModelBlocks`, `documentSignals`,
  `extractBlocks`, `renderPageMarkdown`, `layoutBlocks`,
  `rotateBackOcrDeskew`, `formatJson`, `formatText`. `parseImage(models, rgb,
options)` composes them for one image; `service.models` gives the loaded
  engine and LayoutNet.
- `formatJson(pages.map((p) => p.parsed))` writes LiteParse's JSON, the same
  as `lit parse --format json`.

## PDF input

```ts
import { convertPdf } from "ppu-ocria-nano/pdf";

const pages = await convertPdf(service, pdfBytes, { maxPages: 20, password, dpi: 250 });
```

It runs on LiteParse's own pdfium build. Pages with a usable text layer keep
it; the others are rendered at `dpi` (default 250) and OCR'd. React Native
has no WebAssembly, so `/pdf` does not run there.

## Batches

`convertBatch(images, { concurrency, settle, signal, onProgress })` keeps the
input order; `convertStream` yields results as they finish. Keep
`concurrency` at 1 unless memory allows more: each page allocates large
tensors.

## Models and the cache

- Seven ONNX models, 30.5 MB in all with their charsets and metadata. The
  detector, router and Latin recognizer (1.5 MB) and LayoutNet (17 MB) load in
  `initialize()`; the CJK, RTL and world recognizers load on the first line
  that needs one.
- Downloads come from `llamaindex/OCRia-nano-1` at the v1.0.0 commit, checked
  against size and SHA-256 pins, with `snowfluke/ppu-ocria-nano-models` as
  the fallback. Node and Bun cache them in `~/.cache/ppu-ocria-nano`.
- `OcriaNanoService.downloadModels()` or `ppu-ocria-nano download-models`
  fills the cache for offline runs. `models: { det: "/path/det.onnx", ... }`
  overrides single files; those are used without the pin check.
- `layout: false` skips LayoutNet (heuristic tables and blocks, as LiteParse
  without the table model).

## Common mistakes to flag

- Creating a service per request: the sessions take time to build. Reuse one.
- Reading boxes as pixels: `items` and `blocks` are in points.
- Expecting text from vertical CJK pages or steeply tilted pages: the models
  do not read them (LiteParse does not either).
- Forgetting `destroy()` in long-running processes that recreate services.
- Importing `ppu-ocria-nano` (Node) in a browser bundle: use `/web`.

## The CLI and the REST server

`ppu-ocria-nano convert <files>` writes markdown (`--format text|json` for
LiteParse's text and JSON); `detect`, `download-models`, `clear-cache` and
`models` do what they say. `apps/serve` wraps the service as an HTTP API; read
its README for the endpoints and environment.
