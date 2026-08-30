# Screenshot Redactor

A dependency-free macOS Pi extension for masking screenshot pixels. **Secure Black** permanently
replaces sensitive pixels and is the default and only recommended style for secrets. **Pixelated
(not secure)** provides blocky visual obfuscation, but mosaic pixelation can leak text shapes.
The extension uses a native AppKit editor for pointer input and re-encodes a fresh PNG without
carrying source metadata forward.

## Slash command

- `/redact` — edit PNG/TIFF image data currently on the clipboard.
- `/redact screen` — take a fresh full-screen capture, then edit it.
- `/redact <file path>` — edit an image file. `file <path>`, quoted paths, and Pi's leading `@` are also accepted.

Choose **Secure Black** or **Pixelated (not secure)**, then drag any number of rectangles. The
finalized rectangle previews update immediately when the style changes. Use **Undo** (or
Command-Z), **Clear**, **Save & Copy to Clipboard** (when clipboard copying is enabled), or
**Cancel**. Save defaults to `~/Desktop/redacted-YYYYMMDD-HHMMSS.png` and copies the exact saved
PNG bytes to the clipboard. Cancel writes nothing and leaves the clipboard unchanged.

## Agent tool

`screenshot_redact` supports:

- `action: "interactive"` in Pi's TUI, using the same native editor.
- `action: "apply"` without a GUI, with one or more exact `{x, y, width, height}` integer
  rectangles. Coordinates are source pixels from the top-left and must be wholly in bounds.
- `source: "clipboard"`, `"file"`, or `"screen"`.
- Optional `style: "solid" | "pixelated"`; `solid` is the secure default.
- Optional `pixelBlockSize` from 2 through 128 source pixels; the default is 16. Each clipped
  block is replaced by its average source color and made opaque.
- Optional `outputPath`, `copyToClipboard`, and `overwrite`.
- Optional opaque `maskColor` (`#RRGGBB`) for `solid` only; it defaults to black.

Relative input and output paths resolve against Pi's current working directory. Existing output
files and symlink destinations are rejected unless replacement of a regular destination is
explicitly enabled. The source is therefore not overwritten by default.

## Choosing a style

Use `solid` for passwords, tokens, personal data, or any other sensitive content. It replaces
selected raster pixels with fully opaque color values before writing the new PNG.

Use `pixelated` only when explicitly requested for non-secret visual obfuscation. Pixelation is
not secure: text shapes and layout can remain inferable even though every selected pixel is
replaced by an opaque block average. Both interactive and non-interactive modes use the same
native raster rendering path, and previews are always rebuilt from the original raster to avoid
cumulative degradation when switching styles.

The Swift helper is compiled on first use with Apple's installed Command Line Tools and cached in
a user-only directory. No image or screen capture is cached. Full-screen capture requires macOS
Screen Recording permission for the app running Pi.

## Validation

Run `tests/validate.sh`. It compiles into a private temporary directory, generates its fixture
there, verifies exact clipped average colors for pixelation, opaque output alpha, unchanged
exterior pixels, top-to-bottom orientation, source-metadata removal, style and block-size bounds,
and no-overwrite, special-file, symlink, and rectangle-bounds failures. It also checks Swift
compilation and Pi extension loading. Tests use file input with clipboard copying disabled; they
do not capture the screen or read or write the clipboard. Generated binaries and images are deleted.
