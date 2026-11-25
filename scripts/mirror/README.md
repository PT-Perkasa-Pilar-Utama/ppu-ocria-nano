---
license: other
license_name: ocria-nano-1-license
license_link: https://huggingface.co/snowfluke/ppu-ocria-nano-models/blob/main/v1.0.0/LICENSE
tags:
  - onnx
  - ocr
---

# OCRia-nano-1 model files (mirror)

This repository is an unmodified copy of the OCRia-nano-1 v1.0.0 model files
by **LlamaIndex, Inc.** The original is
[llamaindex/OCRia-nano-1](https://huggingface.co/llamaindex/OCRia-nano-1),
tag `v1.0.0`, commit `11f092be242844361666e8bac97da168b0f4a299`.

[ppu-ocria-nano](https://github.com/PT-Perkasa-Pilar-Utama/ppu-ocria-nano)
downloads from LlamaIndex's repository and reads this copy only when that
download fails. Every file here has the size and SHA-256 that LiteParse
crates-v2.21.2 pins, and the library checks both.

No file is modified. This repository is not affiliated with or endorsed by
LlamaIndex.

## License

The files are licensed by LlamaIndex under the OCRia-nano-1 license, a
modified AI Pubs Open RAIL-M license. A copy is in
[`v1.0.0/LICENSE`](v1.0.0/LICENSE). The use restrictions of its Attachment A
apply to you when you download or use these files. In short, they forbid use:

- by an entity with more than USD 2,000,000 in gross revenue in the prior
  year, or more than USD 2,000,000 in total funding, except for personal use
  or Research Purposes;
- to provide, or as part of, a product or service that offers document
  parsing, OCR or extraction and competes with a product of LlamaIndex or its
  affiliates (such as LlamaParse and LlamaCloud), except for Research
  Purposes.

Read the license itself; this summary does not replace it. For other uses,
contact LlamaIndex at <https://www.llamaindex.ai/contact>.

## Files

| File                     | Role                         | SHA-256                                                            |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------ |
| `det.onnx`               | text-line detector           | `70ea641d74c4d7d3acb734002cc1507350d8350ad44aeedc6f8ac6017dbcff7a` |
| `det.meta.json`          | detector threshold           | `ada6b3c5de0800eb43fa81dbec714d47cd2a712a22952ef23cf38c805b27350e` |
| `router.onnx`            | script router                | `daccb2e3ce3891b7cb95037ada3861e05fd288d7678d2a1e662d9483e04dd361` |
| `rec_latin.onnx`         | Latin recognizer             | `7ac8f6815b4b127f244c14f86c51f65224c82e022c1ee71f867f2be955be4da4` |
| `rec_latin.charset.json` | Latin character set          | `d386eea5691a4f3d9e40f48a3979cf859caf626c3ec43214c7911a713e1f4ed0` |
| `rec_cjk.onnx`           | CJK recognizer               | `ad7154b54a549dbfead48dd49142bcc76ee168cb0cd874f6efacab543f0b9262` |
| `rec_cjk.charset.json`   | CJK character set            | `0e48eca81c1c0afa5a3e081fdf5fcbdc669e746e7e0a7f264e85ac76c496035b` |
| `rec_rtl.onnx`           | Arabic and Hebrew recognizer | `9ccee36bb07b81ef310c6b50e707adabe8c6b92caea61105213686ea8977f4cf` |
| `rec_rtl.charset.json`   | RTL character set            | `8ad9b8f6c1bdc17b42a2351948e84a73c487f5bed7f783bc5e8474efad126a80` |
| `rec_rtl.meta.json`      | RTL recognizer metadata      | `31fd2893cc4d48ec50b4b21a1f113f527ae9a4ac1b3ea395b0cc5969f56d46b5` |
| `rec_world.onnx`         | world-script recognizer      | `c57d01a945d741886d356bdedc636f0572d0810c6a7c2f26dbb9ce0466b92220` |
| `rec_world.charset.json` | world-script character set   | `ebfd39142cec3f267eda2b81b42966ac9b0f73841a52285770f4db40a016d689` |
| `tablenet.onnx`          | LayoutNet (tables, layout)   | `3b913866067d6e43f73a4e4c9c1eace955b7959447043cc39ea1d30e4c552a95` |

`tablenet.bin` (the same LayoutNet weights in LiteParse's own format) is not
mirrored, because ppu-ocria-nano does not read it.
