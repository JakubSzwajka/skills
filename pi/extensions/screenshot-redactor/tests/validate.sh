#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/screenshot-redactor-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

/usr/bin/xcrun swiftc -swift-version 5 "$ROOT/native/Redactor.swift" -o "$WORK/Redactor"

cat >"$WORK/Fixture.swift" <<'SWIFT'
import CoreGraphics
import Foundation
import ImageIO

let path = CommandLine.arguments[1]
let width = 4, height = 3
let pixels: [UInt8] = [
    0,0,0,0,       40,50,60,255, 70,80,90,255, 100,110,120,255,
    11,21,31,255, 41,51,61,255, 71,81,91,255, 101,111,121,255,
    12,22,32,255, 42,52,62,255, 72,82,92,255, 102,112,122,255,
]
let data = Data(pixels)
let provider = CGDataProvider(data: data as CFData)!
let image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                    bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue),
                    provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil)!
let metadata: [CFString: Any] = [kCGImagePropertyPNGDictionary: [kCGImagePropertyPNGDescription: "SECRET-METADATA"]]
CGImageDestinationAddImage(destination, image, metadata as CFDictionary)
precondition(CGImageDestinationFinalize(destination))
SWIFT
/usr/bin/xcrun swiftc -swift-version 5 "$WORK/Fixture.swift" -o "$WORK/Fixture"
INPUT="$WORK/fixture image.png"
OUTPUT="$WORK/redacted output.png"
"$WORK/Fixture" "$INPUT"
SOURCE_HASH="$(shasum -a 256 "$INPUT" | awk '{print $1}')"

cat >"$WORK/request.json" <<JSON
{"action":"apply","source":"file","path":"$INPUT","rectangles":[{"x":1,"y":1,"width":2,"height":1}],"outputPath":"$OUTPUT","copyToClipboard":false,"overwrite":false,"maskColor":"#000000","temporaryDirectory":"$WORK"}
JSON
RESULT="$("$WORK/Redactor" "$WORK/request.json")"
echo "$RESULT" | grep -q '"status":"saved"'
echo "$RESULT" | grep -q '"width":4'
echo "$RESULT" | grep -q '"height":3'
echo "$RESULT" | grep -q '"style":"solid"'
test "$SOURCE_HASH" = "$(shasum -a 256 "$INPUT" | awk '{print $1}')"

cat >"$WORK/Check.swift" <<'SWIFT'
import CoreGraphics
import Foundation
import ImageIO

let path = CommandLine.arguments[1]
let style = CommandLine.arguments[2]
let encoded = try Data(contentsOf: URL(fileURLWithPath: path))
precondition(encoded.range(of: Data("SECRET-METADATA".utf8)) == nil, "source metadata leaked")
let source = CGImageSourceCreateWithData(encoded as CFData, nil)!
let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
precondition(image.width == 4 && image.height == 3)
var actual = Data(count: 4 * 3 * 4)
actual.withUnsafeMutableBytes { raw in
    let context = CGContext(data: raw.baseAddress!, width: 4, height: 3, bitsPerComponent: 8,
                            bytesPerRow: 16, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)!
    context.draw(image, in: CGRect(x: 0, y: 0, width: 4, height: 3))
}
let original: [UInt8] = [
    0,0,0,0,       40,50,60,255, 70,80,90,255, 100,110,120,255,
    11,21,31,255, 41,51,61,255, 71,81,91,255, 101,111,121,255,
    12,22,32,255, 42,52,62,255, 72,82,92,255, 102,112,122,255,
]
let bytes = [UInt8](actual)
for y in 0..<3 {
    for x in 0..<4 {
        let offset = (y * 4 + x) * 4
        if style == "solid" && y == 1 && (x == 1 || x == 2) {
            precondition(Array(bytes[offset..<(offset + 4)]) == [0, 0, 0, 255], "mask pixel is not opaque black at \(x),\(y)")
        } else if style.hasPrefix("pixelated") && x < 3 {
            let expected: [UInt8]
            if style == "pixelated-default" { expected = [39, 48, 57, 255] }
            else if y < 2 && x < 2 { expected = [23, 30, 38, 255] }
            else if y < 2 { expected = [70, 80, 90, 255] }
            else if x < 2 { expected = [27, 37, 47, 255] }
            else { expected = [72, 82, 92, 255] }
            precondition(Array(bytes[offset..<(offset + 4)]) == expected,
                         "pixelated block is not the exact opaque average at \(x),\(y): \(Array(bytes[offset..<(offset + 4)]))")
        } else {
            precondition(Array(bytes[offset..<(offset + 4)]) == Array(original[offset..<(offset + 4)]), "outside pixel changed at \(x),\(y)")
        }
    }
}
print("pixel and metadata checks passed")
SWIFT
/usr/bin/xcrun swiftc -swift-version 5 "$WORK/Check.swift" -o "$WORK/Check"
"$WORK/Check" "$OUTPUT" solid

# Pixel blocks are anchored to the rectangle, clipped at its edges, and averaged
# from the immutable source. The transparent source pixel also proves output alpha
# is forced opaque in the full redacted region.
PIXEL_OUTPUT="$WORK/pixelated output.png"
cat >"$WORK/pixel-request.json" <<JSON
{"action":"apply","source":"file","path":"$INPUT","rectangles":[{"x":0,"y":0,"width":3,"height":3}],"outputPath":"$PIXEL_OUTPUT","copyToClipboard":false,"overwrite":false,"style":"pixelated","pixelBlockSize":2,"temporaryDirectory":"$WORK"}
JSON
PIXEL_RESULT="$("$WORK/Redactor" "$WORK/pixel-request.json")"
echo "$PIXEL_RESULT" | grep -q '"status":"saved"'
echo "$PIXEL_RESULT" | grep -q '"style":"pixelated"'
echo "$PIXEL_RESULT" | grep -q '"pixelBlockSize":2'
"$WORK/Check" "$PIXEL_OUTPUT" pixelated

DEFAULT_PIXEL_OUTPUT="$WORK/default pixelated output.png"
python3 - "$WORK/pixel-request.json" "$WORK/default-pixel-request.json" "$DEFAULT_PIXEL_OUTPUT" <<'PY'
import json, sys
request = json.load(open(sys.argv[1]))
del request["pixelBlockSize"]
request["outputPath"] = sys.argv[3]
json.dump(request, open(sys.argv[2], "w"))
PY
DEFAULT_PIXEL_RESULT="$("$WORK/Redactor" "$WORK/default-pixel-request.json")"
echo "$DEFAULT_PIXEL_RESULT" | grep -q '"pixelBlockSize":16'
"$WORK/Check" "$DEFAULT_PIXEL_OUTPUT" pixelated-default

test "$SOURCE_HASH" = "$(shasum -a 256 "$INPUT" | awk '{print $1}')"

# PNG scanlines are top-to-bottom. A mask at y=0 must affect the top row
# without reversing the untouched rows above and below it.
ORIENTATION_INPUT="$WORK/orientation-input.png"
ORIENTATION_OUTPUT="$WORK/orientation-output.png"
python3 "$ROOT/tests/orientation_fixture.py" create "$ORIENTATION_INPUT"
cat >"$WORK/orientation-request.json" <<JSON
{"action":"apply","source":"file","path":"$ORIENTATION_INPUT","rectangles":[{"x":0,"y":0,"width":1,"height":1}],"outputPath":"$ORIENTATION_OUTPUT","copyToClipboard":false,"overwrite":false,"maskColor":"#000000","temporaryDirectory":"$WORK"}
JSON
"$WORK/Redactor" "$WORK/orientation-request.json" >/dev/null
python3 "$ROOT/tests/orientation_fixture.py" check "$ORIENTATION_OUTPUT"
echo "orientation check passed"

# Existing destinations fail closed and remain unchanged.
OUTPUT_HASH="$(shasum -a 256 "$OUTPUT" | awk '{print $1}')"
if "$WORK/Redactor" "$WORK/request.json" >"$WORK/existing.json"; then
    echo "expected existing-output request to fail" >&2
    exit 1
fi
grep -q 'Output already exists' "$WORK/existing.json"
test "$OUTPUT_HASH" = "$(shasum -a 256 "$OUTPUT" | awk '{print $1}')"

# Exact rectangles are rejected instead of silently clamped.
python3 - "$WORK/request.json" "$WORK/bounds.json" <<'PY'
import json, sys
request = json.load(open(sys.argv[1]))
request["rectangles"] = [{"x": 3, "y": 2, "width": 2, "height": 1}]
request["outputPath"] += ".bounds"
json.dump(request, open(sys.argv[2], "w"))
PY
if "$WORK/Redactor" "$WORK/bounds.json" >"$WORK/bounds-result.json"; then
    echo "expected out-of-bounds request to fail" >&2
    exit 1
fi
grep -q 'outside the 4x3 image' "$WORK/bounds-result.json"

# Pixel block sizes are bounded, and maskColor is never accepted for pixelation.
python3 - "$WORK/pixel-request.json" "$WORK/block-bounds.json" <<'PY'
import json, sys
request = json.load(open(sys.argv[1]))
request["pixelBlockSize"] = 129
request["outputPath"] += ".bounds"
json.dump(request, open(sys.argv[2], "w"))
PY
if "$WORK/Redactor" "$WORK/block-bounds.json" >"$WORK/block-bounds-result.json"; then
    echo "expected oversized pixel block request to fail" >&2
    exit 1
fi
grep -q 'pixelBlockSize must be between 2 and 128' "$WORK/block-bounds-result.json"

python3 - "$WORK/pixel-request.json" "$WORK/pixel-color.json" <<'PY'
import json, sys
request = json.load(open(sys.argv[1]))
request["maskColor"] = "#123456"
request["outputPath"] += ".color"
json.dump(request, open(sys.argv[2], "w"))
PY
if "$WORK/Redactor" "$WORK/pixel-color.json" >"$WORK/pixel-color-result.json"; then
    echo "expected pixelated maskColor request to fail" >&2
    exit 1
fi
grep -q 'maskColor applies only when style is solid' "$WORK/pixel-color-result.json"

# File sources must be regular files; a FIFO must be rejected without blocking.
mkfifo "$WORK/input.fifo"
python3 - "$WORK/request.json" "$WORK/fifo-input.json" "$WORK/input.fifo" <<'PY'
import json, sys
request = json.load(open(sys.argv[1]))
request["path"] = sys.argv[3]
request["outputPath"] += ".fifo-input"
json.dump(request, open(sys.argv[2], "w"))
PY
python3 - "$WORK/Redactor" "$WORK/fifo-input.json" <<'PY'
import subprocess, sys
try:
    result = subprocess.run(sys.argv[1:], capture_output=True, text=True, timeout=3)
except subprocess.TimeoutExpired:
    raise SystemExit("FIFO input blocked instead of being rejected")
assert result.returncode != 0, result.stdout
assert "Input image is not a regular file" in result.stdout, result.stdout
PY

# overwrite=true may replace only regular destinations, never a FIFO or socket.
mkfifo "$WORK/output.fifo"
python3 - "$WORK/request.json" "$WORK/fifo-output.json" "$WORK/output.fifo" <<'PY'
import json, sys
request = json.load(open(sys.argv[1]))
request["outputPath"] = sys.argv[3]
request["overwrite"] = True
json.dump(request, open(sys.argv[2], "w"))
PY
if "$WORK/Redactor" "$WORK/fifo-output.json" >"$WORK/fifo-output-result.json"; then
    echo "expected FIFO destination to fail" >&2
    exit 1
fi
grep -q 'Refusing to overwrite a non-regular destination' "$WORK/fifo-output-result.json"
test -p "$WORK/output.fifo"

# Output symlinks are rejected rather than followed.
ln -s "$WORK/symlink-target.png" "$WORK/symlink-output.png"
python3 - "$WORK/request.json" "$WORK/symlink.json" "$WORK/symlink-output.png" <<'PY'
import json, sys
request = json.load(open(sys.argv[1]))
request["outputPath"] = sys.argv[3]
request["overwrite"] = True
json.dump(request, open(sys.argv[2], "w"))
PY
if "$WORK/Redactor" "$WORK/symlink.json" >"$WORK/symlink-result.json"; then
    echo "expected symlink destination to fail" >&2
    exit 1
fi
grep -q 'Refusing to write through an output symlink' "$WORK/symlink-result.json"
test -L "$WORK/symlink-output.png"
test ! -e "$WORK/symlink-target.png"

# Load the TypeScript extension through Pi's RPC startup path without invoking a
# model, tool, clipboard source, or screen capture.
RPC_OUTPUT="$(printf '%s\n' '{"type":"get_state"}' | pi --mode rpc --no-session --offline --no-extensions -e "$ROOT/index.ts")"
echo "$RPC_OUTPUT" | grep -q '"command":"get_state"'
echo "$RPC_OUTPUT" | grep -q '"success":true'
grep -q 'style: Type.Optional(StringEnum(\["solid", "pixelated"\]' "$ROOT/index.ts"

# Pixelated results must never call themselves sanitized, and one rectangle must
# use singular grammar. The default native label remains Secure Black while a
# custom solid color receives the accurate Secure Solid label.
grep -Fq 'Saved pixelated PNG — NOT SAFE FOR SECRETS:' "$ROOT/index.ts"
grep -Fq 'Saved sanitized PNG:' "$ROOT/index.ts"
grep -Fq 'mask${rectangleCount === 1 ? "" : "s"}' "$ROOT/index.ts"
grep -Fq 'result.style === "pixelated" ? "warning" : "info"' "$ROOT/index.ts"
grep -Fq '? "Secure Black" : "Secure Solid"' "$ROOT/native/Redactor.swift"
grep -Fq 'Saved the pixelated PNG at \(outputPath), but macOS refused to copy it to the clipboard. Pixelated output is NOT SAFE FOR SECRETS.' "$ROOT/native/Redactor.swift"
if grep -Fq 'Saved the sanitized PNG, but macOS refused to copy it to the clipboard' "$ROOT/native/Redactor.swift"; then
    echo "pixelated clipboard failures must not inherit the solid sanitized message" >&2
    exit 1
fi

echo "screenshot-redactor validation passed"
