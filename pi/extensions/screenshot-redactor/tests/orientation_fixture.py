#!/usr/bin/env python3

import binascii
import struct
import sys
import zlib

WIDTH = 2
HEIGHT = 3
ROWS = [
    bytes([255, 0, 0, 255, 0, 255, 0, 255]),
    bytes([0, 0, 255, 255, 255, 255, 0, 255]),
    bytes([255, 0, 255, 255, 0, 255, 255, 255]),
]


def chunk(kind: bytes, data: bytes) -> bytes:
    checksum = binascii.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)


def create_fixture(path: str) -> None:
    header = struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 6, 0, 0, 0)
    scanlines = b"".join(b"\x00" + row for row in ROWS)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", header)
    png += chunk(b"IDAT", zlib.compress(scanlines))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as output:
        output.write(png)


def paeth(left: int, above: int, upper_left: int) -> int:
    estimate = left + above - upper_left
    left_distance = abs(estimate - left)
    above_distance = abs(estimate - above)
    upper_left_distance = abs(estimate - upper_left)
    if left_distance <= above_distance and left_distance <= upper_left_distance:
        return left
    if above_distance <= upper_left_distance:
        return above
    return upper_left


def decode_rows(path: str) -> list[bytes]:
    with open(path, "rb") as image_file:
        encoded = image_file.read()
    if not encoded.startswith(b"\x89PNG\r\n\x1a\n"):
        raise AssertionError(f"not a PNG: {path}")

    position = 8
    compressed = bytearray()
    image_header = None
    while position < len(encoded):
        length = struct.unpack(">I", encoded[position : position + 4])[0]
        kind = encoded[position + 4 : position + 8]
        data = encoded[position + 8 : position + 8 + length]
        position += length + 12
        if kind == b"IHDR":
            image_header = struct.unpack(">IIBBBBB", data)
        elif kind == b"IDAT":
            compressed.extend(data)
        elif kind == b"IEND":
            break

    if image_header is None:
        raise AssertionError(f"missing PNG header: {path}")
    width, height, depth, color_type, compression, filtering, interlace = image_header
    if (width, height) != (WIDTH, HEIGHT):
        raise AssertionError(f"wrong dimensions: {width}x{height}")
    if depth != 8 or color_type not in (2, 6) or compression != 0 or filtering != 0 or interlace != 0:
        raise AssertionError(f"unsupported test PNG format: {image_header}")

    channels = 4 if color_type == 6 else 3
    stride = width * channels
    raw = zlib.decompress(bytes(compressed))
    rows = []
    prior = bytearray(stride)
    position = 0
    for _ in range(height):
        filter_type = raw[position]
        position += 1
        filtered = raw[position : position + stride]
        position += stride
        row = bytearray(stride)
        for index, value in enumerate(filtered):
            left = row[index - channels] if index >= channels else 0
            above = prior[index]
            upper_left = prior[index - channels] if index >= channels else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            elif filter_type == 4:
                predictor = paeth(left, above, upper_left)
            else:
                raise AssertionError(f"unsupported PNG filter: {filter_type}")
            row[index] = (value + predictor) & 0xFF
        prior = row
        if channels == 3:
            rgba = bytearray()
            for index in range(0, len(row), 3):
                rgba.extend(row[index : index + 3])
                rgba.append(255)
            rows.append(bytes(rgba))
        else:
            rows.append(bytes(row))
    return rows


def check_output(path: str) -> None:
    expected = [bytearray(row) for row in ROWS]
    expected[0][0:4] = bytes([0, 0, 0, 255])
    actual = decode_rows(path)
    if actual != [bytes(row) for row in expected]:
        raise AssertionError(
            "saved PNG changed row order; exact top-left masks must not invert the image"
        )


if len(sys.argv) != 3 or sys.argv[1] not in {"create", "check"}:
    raise SystemExit("usage: orientation_fixture.py create|check <png>")
if sys.argv[1] == "create":
    create_fixture(sys.argv[2])
else:
    check_output(sys.argv[2])
