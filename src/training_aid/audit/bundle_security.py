# Copyright (c) 2026 Philipp Kaaden
"""Static PWA bundle structure, Service Worker precache, CSP, and privacy audit."""

from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

__all__ = [
    "ALLOWED_W3C_NAMESPACE_URLS",
    "FORBIDDEN_CDN_TOKENS",
    "REQUIRED_CSP_DIRECTIVES",
    "check_shell_and_privacy",
]

ALLOWED_W3C_NAMESPACE_URLS: frozenset[str] = frozenset(
    {
        "http://www.w3.org/2000/svg",
        "http://www.w3.org/1999/xlink",
    }
)
FORBIDDEN_CDN_TOKENS: tuple[str, ...] = (
    "unpkg.com",
    "jsdelivr.net",
    "cdnjs.cloudflare.com",
    "fonts.googleapis.com",
    "htmx.org",
    "chart.js",
)
REQUIRED_CSP_DIRECTIVES: tuple[str, ...] = (
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
)
_IGNORED_SUFFIXES: frozenset[str] = frozenset({".pyc", ".pyo"})
_SW_ASSETS_RE = re.compile(r"APP_SHELL_ASSETS\s*=\s*(\[[^\]]*\])", flags=re.DOTALL)
_SW_STAMPED_VERSION_RE = re.compile(r'CACHE_VERSION\s*=\s*"v1-[0-9a-f]{12}"')
_URL_RE = re.compile(r"https?://[^\s\"'<>()\\]+", re.IGNORECASE)


class _IndexHtmlInspector(HTMLParser):
    """HTML parser extracting CSP meta content, script tags, and element IDs."""

    def __init__(self) -> None:
        super().__init__()
        self.csp_contents: list[str] = []
        self.scripts: list[dict[str, str]] = []
        self.element_ids: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Record meta CSP tags, script attributes, and DOM IDs."""
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        if elem_id := attr_map.get("id"):
            self.element_ids.add(elem_id)
        tag_lower = tag.lower()
        if (
            tag_lower == "meta"
            and attr_map.get("http-equiv", "").lower() == "content-security-policy"
        ):
            self.csp_contents.append(attr_map.get("content", ""))
        elif tag_lower == "script":
            self.scripts.append(attr_map)


def _iter_bundle_files(dist_dir: Path) -> list[tuple[str, Path]]:
    """Return sorted `(rel_posix, path)` pairs for all compiled files in `dist_dir`."""
    files = [
        (fp.relative_to(dist_dir).as_posix(), fp)
        for fp in dist_dir.rglob("*")
        if (
            fp.is_file()
            and "__pycache__" not in fp.parts
            and fp.suffix not in _IGNORED_SUFFIXES
        )
    ]
    files.sort(key=lambda item: item[0])
    return files


def _check_index_html(index_path: Path, errors: list[str]) -> None:
    """Verify index.html CSP directives, module entrypoint, and dead-node removal."""
    inspector = _IndexHtmlInspector()
    inspector.feed(index_path.read_text(encoding="utf-8"))

    if not inspector.csp_contents:
        errors.append("index.html is missing Content-Security-Policy <meta> tag")
    else:
        csp_val = inspector.csp_contents[0]
        errors.extend(
            f"index.html CSP missing required directive: {directive}"
            for directive in REQUIRED_CSP_DIRECTIVES
            if directive not in csp_val
        )
        errors.extend(
            f"index.html CSP allows forbidden origin token: {forbidden_origin}"
            for forbidden_origin in ("http:", "https:", "*")
            if forbidden_origin in csp_val
        )

    if "toast-root" in inspector.element_ids:
        errors.append("index.html must not contain legacy #toast-root element")

    if len(inspector.scripts) != 1 or inspector.scripts[0] != {
        "type": "module",
        "src": "./app.js",
    }:
        errors.append(
            "index.html must load exactly one <script type='module' src='./app.js'>"
        )


def _check_service_worker(
    sw_path: Path,
    dist_dir: Path,
    bundle_files: list[tuple[str, Path]],
    errors: list[str],
) -> None:
    """Verify sw.js stamped CACHE_VERSION and exact APP_SHELL_ASSETS parity."""
    sw_src = sw_path.read_text(encoding="utf-8")
    if not _SW_STAMPED_VERSION_RE.search(sw_src):
        errors.append("sw.js is missing stamped CACHE_VERSION = 'v1-<12hex>'")

    match = _SW_ASSETS_RE.search(sw_src)
    if match is None:
        errors.append("sw.js is missing APP_SHELL_ASSETS array declaration")
        return

    try:
        normalized_array = re.sub(r",\s*\]", "]", match.group(1))
        assets = json.loads(normalized_array)
    except json.JSONDecodeError as exc:
        errors.append(f"sw.js APP_SHELL_ASSETS is not valid JSON: {exc}")
        return

    expected_assets = {
        "./",
        *(
            f"./{rel_posix}"
            for rel_posix, _ in bundle_files
            if rel_posix != "sw.js" and not rel_posix.startswith("svgs/thumbs/")
        ),
    }
    actual_assets = {str(a) for a in assets}
    if actual_assets != expected_assets:
        missing = sorted(expected_assets - actual_assets)
        extra = sorted(actual_assets - expected_assets)
        errors.append(
            f"sw.js APP_SHELL_ASSETS mismatch (missing={missing}, extra={extra})"
        )

    for asset_url in actual_assets:
        rel_target = asset_url.removeprefix("./")
        if rel_target and not (dist_dir / rel_target).exists():
            errors.append(f"sw.js precache asset does not exist in dist/: {asset_url}")


def check_shell_and_privacy(dist_dir: Path) -> list[str]:
    """Verify PWA shell files, CSP, Service Worker precache, and zero external URLs."""
    errors: list[str] = []

    if (dist_dir / "static").exists():
        errors.append("dist/static/ directory must not exist in unified 1:1 PWA bundle")
    if (dist_dir / "qr.js").exists():
        errors.append("dist/qr.js must not exist after dead QR removal")

    manifest_path = dist_dir / "manifest.webmanifest"
    sw_path = dist_dir / "sw.js"
    index_path = dist_dir / "index.html"
    if not (manifest_path.is_file() and sw_path.is_file() and index_path.is_file()):
        errors.append("Missing manifest.webmanifest, sw.js, or index.html in dist/")
        return errors

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("display") != "standalone" or manifest.get("start_url") != "./":
        errors.append(
            "manifest.webmanifest must specify display='standalone' and start_url='./'"
        )

    bundle_files = _iter_bundle_files(dist_dir)
    _check_index_html(index_path, errors)
    _check_service_worker(sw_path, dist_dir, bundle_files, errors)

    for rel_posix, file_path in bundle_files:
        text = file_path.read_text(encoding="utf-8")
        text_lower = text.lower()
        errors.extend(
            f"{rel_posix}: contains forbidden CDN token '{token}'"
            for token in FORBIDDEN_CDN_TOKENS
            if token in text_lower
        )
        urls = [u.rstrip(".,;:'\"`") for u in _URL_RE.findall(text)]
        errors.extend(
            f"{rel_posix}: contains non-W3C external URL '{url}'"
            for url in urls
            if url not in ALLOWED_W3C_NAMESPACE_URLS
        )

    return errors
