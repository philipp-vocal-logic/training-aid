# Copyright (c) 2026 Philipp Kaaden
"""Training Aid static PWA compiler and local HTTP server CLI."""

import argparse
import functools
import sys
from collections.abc import Sequence
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from training_aid.compiler import DEFAULT_DIST_DIR, build_pwa

__all__ = ["NoCacheStaticRequestHandler", "build_arg_parser", "main"]


class NoCacheStaticRequestHandler(SimpleHTTPRequestHandler):
    """Static file handler enforcing conditional HTTP revalidation (`no-cache`)."""

    def end_headers(self) -> None:
        """Emit `Cache-Control: no-cache` before finalizing response headers."""
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def build_arg_parser() -> argparse.ArgumentParser:
    """Build the command-line argument parser for `training-aid`."""
    parser = argparse.ArgumentParser(
        prog="training-aid",
        description="Build and serve the zero-backend Training Aid static PWA.",
    )
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="Compile the static PWA into --out-dir and exit.",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_DIST_DIR,
        help="Target directory for compiled static PWA assets (default: dist/).",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Bind host for the local static HTTP server (default: 127.0.0.1).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Bind port for the local static HTTP server (default: 8000).",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Compile the Training Aid static PWA and optionally serve it over HTTP."""
    parser = build_arg_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    out_dir = Path(args.out_dir).resolve()
    summary = build_pwa(out_dir)
    sys.stdout.write(
        f"Built Training Aid static PWA in {out_dir} "
        f"({summary['exercise_count']} exercises, "
        f"{summary['thumbnail_count']} thumbnails)\n"
    )
    sys.stdout.flush()
    if args.build_only:
        return 0

    handler = functools.partial(NoCacheStaticRequestHandler, directory=str(out_dir))
    with ThreadingHTTPServer((args.host, args.port), handler) as server:
        sys.stdout.write(
            f"Serving Training Aid static PWA at http://{args.host}:{args.port}/\n"
        )
        sys.stdout.flush()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            sys.stdout.write("\nServer stopped.\n")
    return 0
