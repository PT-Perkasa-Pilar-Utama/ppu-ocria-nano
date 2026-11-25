# Porting rules

`src/ocria/` is a line-by-line port of LiteParse `crates/liteparse/src` at tag
`crates-v2.21.2`. These rules keep the port exact, and they keep each later
upstream sync to a diff of the Rust.

## Layout

- One TypeScript folder per Rust file or module, named in kebab case:
  `ocr_merge.rs` becomes `src/ocria/ocr-merge/`, and `markdown_layout/tables.rs`
  becomes `src/ocria/markdown-layout/tables/`.
- Each file has a third header line that names its source, for example
  `// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0).`
- A file holds at most 300 lines of code (oxlint `max-lines`). Split a large
  Rust file into files named for their function groups.
- Name functions and types after the Rust ones in camelCase
  (`merge_ocr_results` becomes `mergeOcrResults`), so a search for the Rust
  name finds the port.
- Keep the Rust comments that explain why. Drop comments that narrate.

## Data shapes

- Types mirror the serde JSON form of the Rust types: snake_case fields and
  externally tagged enums (`{ Leaf: { item_indices } }`, unit variants as
  strings). Stage values from the goldens load without adapters.
- `Option<T>` that serde writes as `null` is `T | null`. `Option<T>` with
  `skip_serializing_if` is `field?: T`. Read either with `== null` or `??`,
  never `=== undefined`.
- Shared types live in `src/ocria/types/`, `table-model/types.ts`,
  `layout/types.ts`, `markdown-layout/block-types.ts` and
  `projection/signals.ts`. Add a field there only with the owner of that file.

## Numbers

- f32 arithmetic: wrap every f32 operation in `f32()` (`Math.fround`), and wrap
  every f32 literal too (`f32(0.3)`, never a bare `0.3` in an f32 comparison).
  Integer-valued f32 constants such as `2.0` need no wrap.
- f64 arithmetic is JavaScript's own.
- Casts: `as usize` is `asUsize`, `as i64` and `as i32` are `asInt`,
  `round_ties_even` is `roundTiesEven`, and `f32::round` / `f64::round` is
  `Math.sign(v) * Math.round(Math.abs(v))` (ties away from zero; JS
  `Math.round` rounds ties up).
- Comparators: `total_cmp` is `totalCmp`. `partial_cmp().unwrap()` sorts the
  same as `a - b` for non-NaN values.

## Iteration and order

- `sort_by` and `sort_by_key` are stable, like JavaScript's `sort`.
  `sort_unstable*` is not: when equal keys can occur, check whether the order
  of equal elements reaches the output, and say so in a comment.
- `Iterator::max_by` and `max_by_key` keep the last of equal maxima.
  `min_by` and `min_by_key` keep the first. `position` and `find` keep the first.
- A Rust `HashMap` iterates in random order. When upstream iterates one and
  the order reaches the output, upstream is nondeterministic: report it rather
  than invent an order. `BTreeMap` iterates sorted by key.
- `dedup` removes consecutive duplicates only.

## Strings

- Iterate by code point (`for (const c of s)`, `chars()` from `rust.ts`),
  never by UTF-16 unit, wherever the Rust uses `chars()`.
- Byte offsets (`&s[a..b]`, `s.len()`, `find` returning an index) are UTF-8
  byte offsets in Rust. Port them through code-point or explicit UTF-8 logic.
- Use the `rust.ts` predicates: `char::is_whitespace` (`isWhitespace`),
  `is_alphabetic`, `is_alphanumeric`, `is_numeric`, `is_uppercase`,
  `is_lowercase`, `str::trim` (`trim`, not JS `trim()`).
- Rust `regex` classes `\d`, `\w`, `\s` and `\b` are Unicode-aware; JS classes
  are ASCII unless written as `\p{..}` with the `u` flag.
- `to_lowercase` / `to_uppercase` are Unicode case maps, as JS
  `toLowerCase()`; `to_ascii_lowercase` touches only A to Z.
- Define a regex at module level. Do not call `test` or `exec` on one with
  the `g` or `y` flag.

## Code rules

- The lint bans `!` non-null assertions, `as` casts without a `// SAFETY:`
  comment, `new Array(n)`, nested ternaries and `any`. Indexing an array is
  typed as the element (`noUncheckedIndexedAccess` is off), so `arr[i]` needs
  no `!`.
- Each exported function declares its return type.
- Keep the Rust's structure. Simplify only where the result is provably the same.

## Tests

- Each ported folder has a `tests/ocria/<folder>.test.ts` that feeds the stage
  upstream's recorded input from `tests/fixtures/golden/parse` and compares the
  output with `canon()` (`tests/ocria/parse-golden.ts`).
- Port each Rust file's `#[cfg(test)]` unit tests as bun tests in the same file
  or next to it.
- Run `bun test --coverage` on the folder's tests and list the ported lines
  that no test reaches.
- Never regenerate the shared goldens. Write any extra dump to
  `tests/fixtures/golden/extra/<folder>/`.
