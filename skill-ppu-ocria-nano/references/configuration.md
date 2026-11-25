# Configuration reference

Every option of `ppu-ocria-nano`, its default and its effect. The types live
in `src/interface.ts`, `src/core/page.ts` and `src/pdf/index.ts`.

## `OcriaNanoOptions` (service constructor)

| Option               | Type             | Default                | Effect                                                              |
| -------------------- | ---------------- | ---------------------- | ------------------------------------------------------------------- |
| `models`             | `ModelSources`   | pinned v1.0.0 release  | per-file sources, see below                                         |
| `layout`             | `boolean`        | `true`                 | run LayoutNet; `false` uses LiteParse's heuristic tables and blocks |
| `keepHeadersFooters` | `boolean`        | `false`                | keep page headers and footers in the markdown                       |
| `session`            | `SessionOptions` | CPU (Node), WASM (web) | ONNX Runtime session options for every model                        |
| `verbose`            | `boolean`        | `false`                | log loading and stage steps to the console                          |

## `models` (`ModelSources`)

A partial map from a model role to a URL, a file path (Node and Bun) or an
`ArrayBuffer`. Roles and default files:

| Role              | File                     | Loads                                  |
| ----------------- | ------------------------ | -------------------------------------- |
| `det`             | `det.onnx`               | `initialize()`                         |
| `detMeta`         | `det.meta.json`          | `initialize()`                         |
| `router`          | `router.onnx`            | `initialize()`                         |
| `recLatin`        | `rec_latin.onnx`         | `initialize()`                         |
| `recLatinCharset` | `rec_latin.charset.json` | `initialize()`                         |
| `recCjk`          | `rec_cjk.onnx`           | first CJK line                         |
| `recCjkCharset`   | `rec_cjk.charset.json`   | first CJK line                         |
| `recRtl`          | `rec_rtl.onnx`           | first Arabic or Hebrew line            |
| `recRtlCharset`   | `rec_rtl.charset.json`   | first Arabic or Hebrew line            |
| `recRtlMeta`      | `rec_rtl.meta.json`      | first Arabic or Hebrew line            |
| `recWorld`        | `rec_world.onnx`         | first line of another script           |
| `recWorldCharset` | `rec_world.charset.json` | first line of another script           |
| `layout`          | `tablenet.onnx`          | `initialize()`, unless `layout: false` |

A file from the default source is checked against its size and SHA-256 pin;
a failed download falls back to the mirror. A file you pass is used as it is.

## `session` (`SessionOptions`)

ONNX Runtime's `InferenceSession.SessionOptions`, plus:

- `executionProviders`: e.g. `["cpu"]`, `["cuda", "cpu"]`, `["webgpu", "wasm"]`,
  `["nnapi"]` (Android), `["coreml"]` (iOS).
- `onSessionFallback(error)`: called when session creation with the requested
  providers failed and the service rebuilt the session on `cpu` or `wasm`.

The CPU memory arena is off unless you set `enableCpuMemArena: true`.

## `BatchOptions` (`convertBatch`, `convertStream`)

| Option        | Default | Effect                                                            |
| ------------- | ------- | ----------------------------------------------------------------- |
| `concurrency` | `1`     | images in flight at once                                          |
| `settle`      | `false` | report a failed image as `{ status: "rejected", reason }`         |
| `signal`      |         | stop scheduling further images; the batch rejects with AbortError |
| `onProgress`  |         | `(done, total)` after each image                                  |

## `PdfOptions` (`convertPdf`)

| Option               | Default                                             | Effect                                                                                                             |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `dpi`                | `250`                                               | render resolution of pages that are OCR'd                                                                          |
| `maxPages`           | all                                                 | read at most this many pages                                                                                       |
| `password`           |                                                     | password of an encrypted PDF                                                                                       |
| `keepHeadersFooters` | the service's                                       | keep page headers and footers in the markdown                                                                      |
| `fonts`              | `hostFonts()` on Node, Bun, Deno; none in a browser | Arial, Times New Roman and Courier New files that replace the standard-14 fonts; `[]` uses pdfium's built-in fonts |
| `wasmUrl`            | next to the module                                  | where `pdfium.wasm` is served                                                                                      |
| `glyphResolver`      |                                                     | last-resort glyph recovery for fonts with unusable names and cmap                                                  |

## CLI flags

`ppu-ocria-nano help` prints them all. `--format markdown|text|json`
(`text` and `json` as `lit parse` writes them), `--out <dir>`,
`--keep-headers-footers`, `--no-layout`, `--dpi`, `--max-pages`,
`--password`, `--model-dir <dir>`, `--execution-providers <list>`,
`-o <file>`, `--pretty`, `-q`, `--verbose`.

## `apps/serve` environment

| Variable                              | Default            | Effect                                          |
| ------------------------------------- | ------------------ | ----------------------------------------------- |
| `API_ENV`                             | `development`      | `development` or `production`                   |
| `PORT` / `HOST`                       | `8080` / `0.0.0.0` |                                                 |
| `SECRET_KEY`                          |                    | when set, `Bearer <key>` is required on `/v1/*` |
| `IP_WHITE_LIST` / `IP_DENY_LIST`      | `*` /              | comma lists                                     |
| `CORS_ORIGINS`                        | `*`                |                                                 |
| `DOCS_ENABLED`                        | `true`             | serve `/docs` and `/openapi.json`               |
| `RATE_LIMIT_*`                        | on, 120 per 60 s   | per client IP on `/v1/*`                        |
| `REQUEST_TIMEOUT_SECONDS`             | `30`               |                                                 |
| `MAX_UPLOAD_BYTES`                    | 10 MiB             | per image or PDF                                |
| `MAX_BATCH_IMAGES`                    | `32`               |                                                 |
| `EXECUTION_PROVIDERS`                 | `cpu`              |                                                 |
| `MODEL_DIR`                           | download           | a folder with the model files                   |
| `LAYOUT` / `KEEP_HEADERS_FOOTERS`     | `true` / `false`   | as the service options                          |
| `PDF_DPI` / `MAX_PDF_PAGES`           | `250` / `50`       |                                                 |
| `MAX_CONCURRENCY` / `MAX_QUEUE_DEPTH` | auto (1) / `100`   |                                                 |
| `TASK_TTL_SECONDS`                    | `600`              | async task retention                            |
| `SOURCE_URL_ALLOWLIST`                |                    | allowed https hosts for URL inputs              |
