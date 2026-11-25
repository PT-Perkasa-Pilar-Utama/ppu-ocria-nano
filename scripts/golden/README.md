# Goldens

The parity tests compare each ported stage with the values LiteParse itself
computes. LiteParse is the reference: tag `crates-v2.21.2` (commit
`517ef3173c0aede4429d9ad32ba1fd629ba9dfd0`) of
<https://github.com/run-llama/liteparse>, Apache-2.0. The models are
OCRia-nano-1 v1.0.0 (`llamaindex/OCRia-nano-1` at commit
`11f092be242844361666e8bac97da168b0f4a299`).

`liteparse-crates-v2.21.2.patch` adds a stage recorder to a clone of that tag.
The recorder writes values only when `OCRIA_DUMP` is set and changes no
pipeline logic. The patch also adds two example programs:

| Program            | Writes                                        | What it records                                                                                      |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ocria_dump`       | `tests/fixtures/golden/ocr/*.ocr.json.gz`     | The OCR stage on each PNG: detector input and boxes, gutter split, crops, routing, readings, results |
| `ocria_parse_dump` | `tests/fixtures/golden/parse/*.parse.json.gz` | The full parse of each PNG and PDF: extract, merge, projection, LayoutNet, blocks, markdown          |

The patch makes three changes that are not recording:

- It derives `serde::Serialize` on the table-model and projection-signal types,
  and serializes `TextItem` and `ParsedPage` fields that are `#[serde(skip)]`
  upstream, so the internal state between stages is in the goldens.
- When `OCRIA_RAW_IMAGE` names an image, `table_model::features::render_raw`
  builds the LayoutNet raster from that image (area resample to the 150 dpi
  page size, in PDFium's BGR order) instead of a PDFium render. This is what
  the TypeScript image path does (see `docs/decisions/`).
- It makes `ocr::ocria::img` public so the override can use `resize_area`.

## Regenerate

Run these steps only when the reference version or a fixture changes. Then
commit the new goldens with the change.

```sh
git clone https://github.com/run-llama/liteparse.git /tmp/liteparse
cd /tmp/liteparse && git checkout crates-v2.21.2
git apply /path/to/ppu-ocria-nano/scripts/golden/liteparse-crates-v2.21.2.patch
CARGO_TARGET_DIR=/tmp/lp-target cargo build --release -p liteparse \
  --no-default-features --features ocria-nano --examples
```

Download the v1.0.0 model files into one directory (`MODELS`). Use the ONNX
Runtime library that `onnxruntime-node` ships (`ORT`), so that both sides run
the same kernels, for example
`node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/libonnxruntime.1.29.0.dylib`.

```sh
cd /path/to/ppu-ocria-nano
OCRIA_DUMP=1 /tmp/lp-target/release/examples/ocria_dump "$MODELS" "$ORT" \
  tests/fixtures/golden/ocr tests/fixtures/pages/*.png
OCRIA_DUMP=1 /tmp/lp-target/release/examples/ocria_parse_dump "$MODELS" "$ORT" \
  tests/fixtures/golden/parse tests/fixtures/pages/*.png tests/fixtures/pages/*.pdf
gzip -9 -f tests/fixtures/golden/ocr/*.json tests/fixtures/golden/parse/*.json
```

`locked.pdf` needs a password and is skipped.

## Fixtures

The PNG and PDF pages in `tests/fixtures/pages` are made by PT Perkasa Pilar
Utama. `make-pdf-fixtures.py` writes `structured.pdf`, `borderless.pdf` and
`multipage.pdf`:

```sh
uv run --with reportlab==4.4.4 python -I scripts/golden/make-pdf-fixtures.py tests/fixtures/pages
```

No golden contains a model file, a charset or a model metadata file. Those
are Licensed Code under the OCRia-nano-1 license and stay out of this
repository.
