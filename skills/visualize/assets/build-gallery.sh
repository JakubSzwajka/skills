#!/bin/sh
# Render the block gallery to /tmp/visualize/gallery.html and open it.
# Run this when you are unsure what a block looks like.
set -e
D="$(cd "$(dirname "$0")" && pwd)"
mkdir -p /tmp/visualize
python3 - "$D" <<'PY'
import sys, pathlib
d = pathlib.Path(sys.argv[1])
out = (d / "gallery.html").read_text()
out = out.replace("__CSS__", (d / "base.css").read_text())
out = out.replace("__JS__", (d / "interactive.js").read_text())
pathlib.Path("/tmp/visualize/gallery.html").write_text(out)
print("/tmp/visualize/gallery.html")
PY
open /tmp/visualize/gallery.html 2>/dev/null || true
