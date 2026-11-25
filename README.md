# ppu-ocria-nano

[![NPM](https://img.shields.io/npm/dw/ppu-ocria-nano)](https://www.npmjs.com/package/ppu-ocria-nano) [![npm version](https://img.shields.io/npm/v/ppu-ocria-nano)](https://www.npmjs.com/package/ppu-ocria-nano) [![JSR](https://jsr.io/badges/@snowfluke/ppu-ocria-nano)](https://jsr.io/@snowfluke/ppu-ocria-nano) [![License: Apache-2.0](https://img.shields.io/npm/l/ppu-ocria-nano)](./LICENSE) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/PT-Perkasa-Pilar-Utama/ppu-ocria-nano/badge)](https://scorecard.dev/viewer/?uri=github.com/PT-Perkasa-Pilar-Utama/ppu-ocria-nano)

OCRia-nano-1 in TypeScript. You pass an image or a PDF and get markdown, plain text, text boxes and layout blocks back. [OCRia-nano-1](https://www.llamaindex.ai/blog/introducing-ocria-nano-1) by LlamaIndex is seven small ONNX models (8.1M parameters in total): a line detector, a script router, four line recognizers and LayoutNet, a table and layout model. This package runs them as [LiteParse](https://github.com/run-llama/liteparse) runs them, through a line-by-line TypeScript port of LiteParse's pipeline, on ONNX Runtime in Node.js, Bun, Deno, browsers, web workers and React Native.

Need an HTTP service? See [apps/serve](apps/serve/README.md). Need a CLI? See [Command Line](#command-line). Are you an AI agent? The `skill-ppu-ocria-nano` folder teaches the API.

> [!WARNING]
> **Read the OCRia-nano-1 license before you use this package.**
>
> The model files (the ONNX models, their character sets and metadata) are
> LlamaIndex's. They are not under this package's Apache-2.0 license; they are
> under the OCRia-nano-1 license, and you accept it when the library downloads
> them for you. Attachment A of that license forbids use:
>
> - by an organization with more than USD 2M in revenue last year, or more than
>   USD 2M in funding, unless your use is personal or for Research Purposes; or
> - to provide, or as part of, a document parsing, OCR or extraction product
>   that competes with LlamaIndex products such as LlamaParse and LlamaCloud,
>   whatever your revenue, unless your use is for Research Purposes.
>
> You are responsible for your own compliance. Read
> [LICENSE-STATUS.md](LICENSE-STATUS.md) for the terms and what may change.
> This is a community project. LlamaIndex does not endorse it.

```ts
import { OcriaNanoService } from "ppu-ocria-nano";

const service = new OcriaNanoService();
await service.initialize();

const page = await service.convert(await Bun.file("scan.png").arrayBuffer());
console.log(page.markdown);

await service.destroy();
```

## Table of Contents

- [What It Does](#what-it-does)
- [Runtime Support](#runtime-support)
- [Installation](#installation)
- [Core Usage](#core-usage)
- [Command Line](#command-line)
- [Batch Conversion](#batch-conversion)
- [PDF Input](#pdf-input)
- [Web / Browser Support](#web--browser-support)
- [React Native (Mobile)](#react-native-mobile)
- [Models and Languages](#models-and-languages)
- [Configuration Reference](#configuration-reference)
- [How the Port Is Checked](#how-the-port-is-checked)
- [Benchmarks](#benchmarks)
- [Contributing](#contributing)
- [License](#license)

## What It Does

- **The whole page.** One `convert()` call detects lines, routes each line to its script's recognizer (Latin, CJK, Arabic and Hebrew, or about 17 other scripts), turns sideways and upside-down pages, removes small tilts, finds tables with LayoutNet, and writes markdown with headings, lists, tables and code.
- **The same output as LiteParse.** For every test page, each stage gives the values LiteParse 2.21.2 computes, and an image's markdown is identical. See [How the Port Is Checked](#how-the-port-is-checked).
- **Small.** About 1.5 MB of OCR models load at start, plus 17 MB for LayoutNet. The CJK, RTL and world recognizers (2.8 to 5.1 MB each) load on the first line that needs them.
- **Every stage public.** `detect()` and `recognize()` run the OCR stage alone; LiteParse's later stages (OCR merge, projection, LayoutNet, blocks, markdown, JSON and text output) are exported functions you can call on `page.parsed`.
- **TypeScript**, with full type definitions.

## Runtime Support

| Runtime           | How to install                                                                                                   | Notes                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Node.js           | `npm install ppu-ocria-nano onnxruntime-node`                                                                    | [npm package](https://www.npmjs.com/package/ppu-ocria-nano) |
| Bun               | `bun add ppu-ocria-nano onnxruntime-node`                                                                        |                                                             |
| Deno              | `deno add jsr:@snowfluke/ppu-ocria-nano`                                                                         | [JSR package](https://jsr.io/@snowfluke/ppu-ocria-nano)     |
| Web browser       | `npm install ppu-ocria-nano onnxruntime-web`, import `ppu-ocria-nano/web`                                        | [Web / Browser Support](#web--browser-support)              |
| Web worker        | Same as web; the `/web` entry runs in workers.                                                                   | [Web Workers](#web-workers)                                 |
| Browser extension | Same as web; bundle `ppu-ocria-nano/web`.                                                                        |                                                             |
| React Native      | `npm install ppu-ocria-nano onnxruntime-react-native @shopify/react-native-skia`, import `ppu-ocria-nano/mobile` | [React Native](#react-native-mobile)                        |
| PDF input         | import `ppu-ocria-nano/pdf` (Node, Bun, Deno, browsers; not React Native)                                        | [PDF Input](#pdf-input)                                     |

## Installation

```bash
npm install ppu-ocria-nano onnxruntime-node onnxruntime-web
```

Omit `onnxruntime-node` or `onnxruntime-web` for the target you do not need.

The first `initialize()` downloads the model files from LlamaIndex's Hugging Face repository, pinned to the v1.0.0 commit, and checks each file's size and SHA-256 against the values LiteParse pins. On Node and Bun the files are cached in `~/.cache/ppu-ocria-nano`. When the download from LlamaIndex fails, the library reads the same files from this project's mirror and checks the same pins. `OcriaNanoService.downloadModels()` (or `ppu-ocria-nano download-models`) fetches every file up front, so later runs need no network.

**When the models download, you accept the OCRia-nano-1 license.** Read [LICENSE-STATUS.md](LICENSE-STATUS.md) first.

### CLI (global install)

```bash
npm install -g ppu-ocria-nano onnxruntime-node      # or: bun add -g ppu-ocria-nano onnxruntime-node
ppu-ocria-nano convert scan.png
```

`onnxruntime-node` is an optional peer dependency with native binaries, so install it next to the CLI. Release builds also attach standalone executables for Linux, macOS and Windows; see the release page.

## Core Usage

### Basic Conversion

`convert()` takes encoded image bytes (PNG, JPEG, WebP and what else the platform's decoder reads), a canvas, or raw pixels `{ data, width, height }` (RGBA, RGB or grey).

```ts
import { OcriaNanoService } from "ppu-ocria-nano";

const service = new OcriaNanoService();
await service.initialize();

const page = await service.convert(bytes);
console.log(page.markdown); // headings, paragraphs, lists, tables
console.log(page.text); // the text laid out as on the page

await service.destroy();
```

For one image without managing a service, `ocr(image, options)` loads the models, converts, and releases them.

### The Page Result

| Field             | Content                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pageNumber`      | 1-based page number                                                                                                         |
| `width`, `height` | page size in points (72 per inch)                                                                                           |
| `dpi`             | for an OCR'd page, the image resolution: pixels = points × dpi / 72                                                         |
| `markdown`        | headings, paragraphs, lists, tables (pipe tables, or HTML for merged cells) and code                                        |
| `text`            | the page's text in its spatial layout                                                                                       |
| `items`           | text items with boxes in points, rotation, OCR confidence, font name and size                                               |
| `blocks`          | layout blocks in reading order (`heading`, `paragraph`, `list_item`, `table`, ...), the blocks the markdown is written from |
| `parsed`          | the page as LiteParse's stages hold it, for the stage functions below                                                       |

An image becomes one page. Its size in points comes from the resolution the file states (PNG `pHYs`, JPEG JFIF), else 150 dpi, as LiteParse sizes it. Page headers and footers stay out of the markdown unless you set `keepHeadersFooters: true`.

### Running the Stages Yourself

`detect()` returns the detector's line quads; `recognize()` runs the whole OCR stage and returns each line's text, confidence and box in image pixels:

```ts
const { boxes } = await service.detect(bytes); // [[x, y], [x, y], [x, y], [x, y]] per line
const lines = await service.recognize(bytes); // [{ text, confidence, bbox, polygon }, ...]
```

The stages after OCR are exported functions over LiteParse's own types, in pipeline order: `mergeOcrResults`, `projectPagesForMarkdown`, `runPage` (LayoutNet), `resegmentByModelBlocks`, `documentSignals`, `extractBlocks`, `renderPageMarkdown`, `layoutBlocks`, `rotateBackOcrDeskew`, and the output formatters `formatJson` and `formatText`. `parseImage()` composes them; read [`src/ocria/pipeline/parse-image.ts`](src/ocria/pipeline/parse-image.ts) for the order and the configuration. `formatJson(pages.map((p) => p.parsed))` writes the JSON that `lit parse --format json` writes.

### Custom Models

Pass a URL, a file path (Node and Bun) or the bytes for any model file. A file you pass is used as it is, without the pin check:

```ts
const service = new OcriaNanoService({
  models: {
    det: "/models/det.onnx",
    recLatin: "https://example.com/rec_latin.onnx",
    recLatinCharset: await Bun.file("/models/rec_latin.charset.json").arrayBuffer(),
  },
});
```

Set `layout: false` to skip LayoutNet. Tables and blocks then come from LiteParse's heuristics, which is what LiteParse does when the table model is not installed.

## Command Line

```bash
# one image or PDF -> markdown on stdout
ppu-ocria-nano convert scan.png

# many images (glob), one output file per input
ppu-ocria-nano convert "scans/*.png" --out results/

# LiteParse's JSON (as lit parse --format json writes it)
ppu-ocria-nano convert report.pdf --format json --pretty

# detection only: line quads as JSON
ppu-ocria-nano detect receipt.jpg

# fill or clear the model cache, list the model files
ppu-ocria-nano download-models
ppu-ocria-nano clear-cache
ppu-ocria-nano models
```

`ppu-ocria-nano help` lists every flag. `--keep-headers-footers`, `--dpi`, `--max-pages` and `--password` mean what they mean for `lit parse`.

## Batch Conversion

`convertBatch()` keeps the input order; `convertStream()` yields each result as it finishes. Both take an iterable or an async iterable of images:

```ts
const pages = await service.convertBatch(images, { concurrency: 1 });

for await (const r of service.convertStream(images, { settle: true })) {
  if (r.status === "fulfilled") console.log(r.index, r.value.markdown);
  else console.error(r.index, r.reason);
}
```

`concurrency` defaults to 1: each page allocates large tensors, so more pages at once mostly add memory. `settle: true` reports a failed image as a rejected item instead of failing the batch; `signal` stops scheduling; `onProgress(done, total)` reports progress.

## PDF Input

```ts
import { OcriaNanoService } from "ppu-ocria-nano";
import { convertPdf } from "ppu-ocria-nano/pdf";

const service = new OcriaNanoService();
await service.initialize();
const pages = await convertPdf(service, pdfBytes, { maxPages: 20 });
```

PDF input runs on LiteParse's own patched pdfium (release `chromium/8172` of `run-llama/pdfium-binaries`), which this repository links into WebAssembly (`scripts/pdfium/build.sh`, 4 MB). LiteParse's text extraction calls pdfium functions that stock pdfium builds lack, so only that build reads a PDF's text layer as LiteParse does. Pages without a usable text layer are rendered at `dpi` (default 250) and OCR'd.

| Option               | Default                                         | Effect                                                  |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| `dpi`                | `250`                                           | render resolution of pages that are OCR'd               |
| `maxPages`           | all                                             | read at most this many pages                            |
| `password`           |                                                 | password of an encrypted PDF                            |
| `keepHeadersFooters` | the service's                                   | keep page headers and footers                           |
| `fonts`              | the host's (Node, Bun, Deno); none in a browser | substitutes for the standard-14 fonts, see below        |
| `wasmUrl`            | next to the module                              | where `pdfium.wasm` is served, for a browser or bundler |

A PDF that names a standard font (Helvetica, Times-Roman, Courier) without embedding it is laid out with a substitute, and every text box depends on the substitute's metrics. A native pdfium, as in LiteParse, uses the host's Arial, Times New Roman and Courier New. On Node, Bun and Deno, `convertPdf` reads the same files (`hostFonts()`: the macOS font folders, `%WINDIR%\Fonts`, or Debian's `msttcorefonts`). On macOS the boxes then equal LiteParse's on all ten test PDFs; the Windows and Linux paths are untested. In a browser, or with `fonts: []`, pdfium uses its built-in fonts and boxes move by up to about 0.6 pt; the markdown of the test PDFs stays the same. Pass the font files as `fonts` to get LiteParse's boxes in a browser.

## Web / Browser Support

Import from `ppu-ocria-nano/web`:

```ts
import { OcriaNanoService } from "ppu-ocria-nano/web";

const service = new OcriaNanoService();
await service.initialize();

const file = document.querySelector("input[type=file]").files[0];
const page = await service.convert(await file.arrayBuffer());
```

The models download from the pinned URLs, or from the sources in `models`.

### Web Workers

Keep the service in a worker and send image bytes across, so inference never blocks the page:

```ts
// worker.ts
import { OcriaNanoService } from "ppu-ocria-nano/web";

const service = new OcriaNanoService();
const ready = service.initialize();

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  await ready;
  const page = await service.convert(event.data);
  self.postMessage({ markdown: page.markdown, blocks: page.blocks });
};
```

```ts
// main.ts
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
worker.onmessage = (event) => console.log(event.data.markdown);
const bytes = await file.arrayBuffer();
worker.postMessage(bytes, [bytes]); // transferred, not copied
```

### WebGPU

ONNX Runtime runs on WASM unless you ask for more. The OCRia-nano-1 models are untested on the WebGPU provider, so it is opt-in:

```ts
import { OcriaNanoService, getDefaultWebExecutionProviders } from "ppu-ocria-nano/web";

const service = new OcriaNanoService({
  session: { executionProviders: await getDefaultWebExecutionProviders() }, // ["webgpu", "wasm"] or ["wasm"]
});
```

When session creation with the requested providers fails, the service retries on `wasm`; pass `session.onSessionFallback` to be told. The WASM binaries load from jsDelivr at the exact `onnxruntime-web` version you use, unless you set `ort.env.wasm.wasmPaths` yourself.

### Multithreaded WASM (Cross-Origin Isolation)

ONNX Runtime uses more than one WASM thread only on a [cross-origin isolated](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated) page. Set these response headers on your server:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

On a static host that cannot set headers, load the bundled `coi-serviceworker.js` (`ppu-ocria-nano/coi-serviceworker.js`) before anything else. It reloads the page once to apply the headers.

## React Native (Mobile)

```bash
npm install ppu-ocria-nano onnxruntime-react-native @shopify/react-native-skia
```

```ts
import { OcriaNanoService } from "ppu-ocria-nano/mobile";

const service = new OcriaNanoService();
await service.initialize();
const page = await service.convert(imageBuffer); // ArrayBuffer of an encoded image
```

You need React Native 0.74 or later (Expo SDK 51 or later) and onnxruntime-react-native 1.24.1 or later. Both peer packages ship native code, so use a development build or `expo prebuild`; Expo Go cannot load them. Inference runs on the CPU; opt into NNAPI (Android) or CoreML (iOS) with `session.executionProviders`. React Native has no WebCrypto, so model downloads are checked by size only. PDF input does not run on React Native, because Hermes has no WebAssembly.

## Models and Languages

| File             | Role                                    | Size     | Loads                            |
| ---------------- | --------------------------------------- | -------- | -------------------------------- |
| `det.onnx`       | text-line detector                      | 0.35 MB  | at start                         |
| `router.onnx`    | script router, upside-down detection    | 0.16 MB  | at start                         |
| `rec_latin.onnx` | Latin recognizer (791 characters)       | 0.94 MB  | at start                         |
| `rec_cjk.onnx`   | Chinese, Japanese and Korean recognizer | 5.08 MB  | on first CJK line                |
| `rec_rtl.onnx`   | Arabic and Hebrew recognizer            | 2.84 MB  | on first RTL line                |
| `rec_world.onnx` | recognizer for about 17 other scripts   | 3.91 MB  | on first such line               |
| `tablenet.onnx`  | LayoutNet: tables, headings, blocks     | 17.18 MB | at start, unless `layout: false` |

Each recognizer comes with a `.charset.json`; the detector and the RTL recognizer carry small `.meta.json` files. All files total 30.5 MB.

The model card lists the languages. Two limits show on the test pages: vertical Chinese and Japanese text and pages tilted 30 degrees come out unreadable, in LiteParse as here. The blog notes that the models have no chart model and keep charts as images.

## Configuration Reference

### `OcriaNanoOptions`

| Option               | Default                | Meaning                                                             |
| -------------------- | ---------------------- | ------------------------------------------------------------------- |
| `models`             | pinned release         | per-file sources: URL, path (Node, Bun) or bytes                    |
| `layout`             | `true`                 | run LayoutNet; `false` uses LiteParse's heuristic tables and blocks |
| `keepHeadersFooters` | `false`                | keep page headers and footers in the markdown                       |
| `session`            | CPU (Node), WASM (web) | ONNX Runtime session options, plus `onSessionFallback`              |
| `verbose`            | `false`                | log loading and stage steps                                         |

### `BatchOptions`

| Option        | Default | Meaning                                               |
| ------------- | ------- | ----------------------------------------------------- |
| `concurrency` | `1`     | images in flight at once                              |
| `settle`      | `false` | report failures as rejected items                     |
| `signal`      |         | stop scheduling further images                        |
| `onProgress`  |         | called after each image with the done count and total |

## How the Port Is Checked

A recorder patch on LiteParse `crates-v2.21.2` writes the input and output of every stage for 21 test pages (11 images, 10 PDFs, some generated for headings, lists, ruled and borderless tables, code, links and page chrome). Each TypeScript stage is tested on LiteParse's recorded input for that stage, and the image path is also run end to end in TypeScript and compared with LiteParse's markdown. [`scripts/golden/README.md`](scripts/golden/README.md) has the patch and the steps, and [`docs/PORTING.md`](docs/PORTING.md) the rules the port follows.

What matches: every OCR line's text, box, polygon and confidence; the merged page; the projection; the LayoutNet units, features, tables and blocks; the layout blocks; the markdown; and the final page. Two places differ from LiteParse in the last floating-point bit: LiteParse's `f32::exp` and `f32::sin` call the platform's math library, which rounds differently from JavaScript's, so script-router shares and LayoutNet class probabilities differ by about 1e-7. LayoutNet's raw outputs differ by at most 2e-5. No decision on the test pages changes.

An image here is OCR'd at its own pixels, through LiteParse's `ocr_page_images` path. `lit parse image.png` instead wraps the image in a PDF and OCRs a 250 dpi render of it, which changes single words on some pages. See the [decision log](docs/decisions/2026-11-25-ppu-ocria-nano-scope.md) (Q10).

## Benchmarks

LlamaIndex reports these scores for OCRia-nano-1 in LiteParse ([model card](https://huggingface.co/llamaindex/OCRia-nano-1)): ParseBench-2 59.2 overall (tables 59.5, layout 72.4), OmniParseBench 74.8, olmOCR-bench 60.9, and 426 ms per page on one CPU core. This package has not re-run those benchmarks. On an Apple Silicon laptop, `convert()` of a 1700 × 2200 pixel page takes 0.6 to 0.75 s with the default ONNX Runtime threads.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Port changes follow [docs/PORTING.md](docs/PORTING.md).

## License

The code is Apache-2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)); it includes a port of LiteParse (Apache-2.0, LlamaIndex). The OCRia-nano-1 model files are under the OCRia-nano-1 license; see [LICENSE-STATUS.md](LICENSE-STATUS.md).
