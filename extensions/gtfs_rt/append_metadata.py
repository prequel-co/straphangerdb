#!/usr/bin/env python3
"""Append DuckDB 512-byte C_STRUCT extension metadata footer wrapped in a WASM custom section."""
import sys


def pad32(val: bytes) -> bytes:
    return val[:32].ljust(32, b"\x00")


def uleb128(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n == 0:
            out.append(b)
            break
        out.append(b | 0x80)
    return bytes(out)


def main() -> None:
    if len(sys.argv) != 5:
        print(f"Usage: {sys.argv[0]} <wasm_path> <platform> <capi_version> <ext_version>", file=sys.stderr)
        sys.exit(1)

    path, platform, capi_version, ext_version = sys.argv[1:5]
    with open(path, "rb") as f:
        data = f.read()

    # Strip previous custom-section footer or raw 512-byte footer if re-running
    if len(data) >= 521 and data[-521:-512] == b"\x00\x87\x04\x06duckdb":
        data = data[:-521]
    elif len(data) >= 512 and data[-288:-256] == pad32(b"4"):
        data = data[:-512]

    footer = (
        pad32(b"")
        + pad32(b"")
        + pad32(b"")
        + pad32(b"C_STRUCT")
        + pad32(ext_version.encode("utf-8"))
        + pad32(capi_version.encode("utf-8"))
        + pad32(platform.encode("utf-8"))
        + pad32(b"4")
        + b"\x00" * 256
    )

    name = b"duckdb"
    section_body = uleb128(len(name)) + name + footer
    custom_section = b"\x00" + uleb128(len(section_body)) + section_body

    with open(path, "wb") as f:
        f.write(data + custom_section)


if __name__ == "__main__":
    main()
