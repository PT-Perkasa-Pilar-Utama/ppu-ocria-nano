# Roadmap

ppu-ocria-nano is in early development and is not released yet.

For released work, see [CHANGELOG.md](CHANGELOG.md).

## Next

- Follow LiteParse releases: re-diff the ported Rust against each new
  `crates-v*` tag and regenerate the goldens (see `scripts/golden/README.md`).
- Run the PNG goldens on onnxruntime-web and onnxruntime-react-native, not only
  onnxruntime-node.
- Measure page time and memory on CI's runners and on a phone.

## Not planned

- Office documents. LiteParse converts them with LibreOffice, which no
  browser or React Native runtime has.
