# Copyright (c) 2026 Philipp Kaaden
"""End-to-end catalog, coaching, kinematic rig, safe-grip, and static PWA audit."""

import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from training_aid.builder import (
    CANONICAL_EQUIPMENT_MODES,
    PWA_SRC_DIR,
    STATIC_SRC_DIR,
    CatalogExercise,
    build_pwa,
    load_catalog_exercises,
    load_programs_config,
)
from training_aid.coaching import (
    build_exercise_metadata,
    load_archetype_coaching,
)
from training_aid.svg_assets import (
    lerp_pose,
    load_animation_registry,
    normalize_equipment,
    solve_fk,
)

type JsonMap = dict[str, Any]
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR, STATIC_DIR, PWA_DIR = REPO_ROOT / "data", STATIC_SRC_DIR, PWA_SRC_DIR
EXPECTED_CATALOG_COUNT, EXPECTED_ARCHETYPE_COUNT = 876, 18
EXPECTED_SVG_COMBO_COUNT = EXPECTED_ARCHETYPE_COUNT * len(CANONICAL_EQUIPMENT_MODES)
MIN_HOLD_REPS = 20
MIN_WEIGHT_KG, MAX_WEIGHT_KG = 2.0, 250.0
VIEWPORT_MIN, VIEWPORT_MAX_X, VIEWPORT_MAX_JOINT_Y, FLOOR_Y = 0.0, 240.0, 174.0, 175.0
HEAD_RADIUS, MAX_KB_HANDLE_DIST, MAX_RACK_HAND_SHOULDER_DIST = 11.5, 3.0, 28.0
SVG_COORD_TOL, BONE_LEN_TOL = 0.03, 1e-6

SAMPLE_TS = (0.0, 0.25, 0.5, 0.75, 1.0)
_CAT_STR_KEYS = (
    "id",
    "name",
    "category",
    "equipment",
    "primary_muscle",
    "archetype",
    "tempo_mode",
)
_CAT_BOOL_KEYS = ("is_hold", "is_alternating")
EXPECTED_CATALOG_KEYS = frozenset(_CAT_STR_KEYS + _CAT_BOOL_KEYS)
_META_1 = ("archetype", "rep_seconds", "is_hold", "unit", "how_to")
_META_2 = ("cue_work", "cue_return", "tempo_mode", "is_alternating")
EXPECTED_METADATA_KEYS = frozenset(_META_1 + _META_2)
_COMP_1 = ("id", "name", "category", "equipment", "primary_muscle")
_COMP_2 = ("eq_mode", "svg_key", "thumb_url")
EXPECTED_COMPILED_EXERCISE_KEYS = EXPECTED_METADATA_KEYS | frozenset(_COMP_1 + _COMP_2)
_SCAN_1 = ("index.html", "manifest.webmanifest", "icon.svg", "sw.js", "app.js")
_SCAN_2 = ("domain.js", "codec.js", "store.js", "qr.js", "dom.js", "static/style.css")
_SCAN_3 = ("views/setup.js", "views/plan.js", "views/edit.js", "views/workout.js")
_SCAN_4 = ("views/progress.js", "static/motion.js", "static/sound.js")
PRIVACY_SCAN_FILES = _SCAN_1 + _SCAN_2 + _SCAN_3 + _SCAN_4
_PRECACHE_REL = tuple(f"./{p}" for p in PRIVACY_SCAN_FILES if p != "sw.js")
REQUIRED_PRECACHE_ASSETS = frozenset(("./", "./data/catalog.json", *_PRECACHE_REL))
_W3C_URLS = ("http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink")
ALLOWED_W3C_NAMESPACE_URLS = frozenset(_W3C_URLS)
_CDN_1 = ("unpkg.com", "jsdelivr.net", "cdnjs.cloudflare.com")
FORBIDDEN_CDN_TOKENS = (*_CDN_1, "fonts.googleapis.com", "htmx.org", "chart.js")
_CSP_1 = ("default-src 'self'", "script-src 'self'", "connect-src 'self'")
_CSP_2 = ("img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'")
REQUIRED_CSP_DIRECTIVES = _CSP_1 + _CSP_2
VALID_TEMPO_MODES = frozenset(("standard", "explosive", "alternating", "hold"))
HANDHELD_WEIGHT_MODES = frozenset(("barbell", "dumbbell", "kettlebells"))
RACK_ARCHETYPES = frozenset(("squat", "lunge", "calf_raise"))
WEIGHTED_EQUIPMENT = HANDHELD_WEIGHT_MODES | {"cable", "machine", "e-z curl bar"}
_BASE_BODY_EQ = frozenset(("body only", "foam roll", "exercise ball", "other"))
TIER_ALLOWED_EQUIPMENT: dict[str, frozenset[str] | None] = {
    "body_only": _BASE_BODY_EQ,
    "dumbbells": _BASE_BODY_EQ | {"dumbbell", "medicine ball"},
    "kettlebell_bands": _BASE_BODY_EQ | {"kettlebells", "bands"},
    "full_gym": None,
}
_SEG_1 = (("hip", "mid_spine", "lumbar"), ("mid_spine", "shoulder", "thoracic"))
_SEG_2 = (("shoulder", "head", "neck"), ("shoulder", "elbow_f", "uarm"))
_SEG_3 = (("elbow_f", "hand_f", "farm"), ("shoulder_b", "elbow_b", "uarm"))
_SEG_4 = (("elbow_b", "hand_b", "farm"), ("hip", "knee_f", "thigh"))
_SEG_5 = (("knee_f", "foot_f", "shin"), ("hip_b", "knee_b", "thigh"))
_SEG_6 = (("knee_b", "foot_b", "shin"),)
_SEGMENT_PAIRS = _SEG_1 + _SEG_2 + _SEG_3 + _SEG_4 + _SEG_5 + _SEG_6
_KB_CIRCLES = (("hand_f", 2.5, 5.0), ("hand_f", 9.0, 8.4), ("hand_b", 8.0, 7.2))
_PROP_CIRCLES: dict[str, tuple[tuple[str, float, float], ...]] = {
    "barbell": (("hand_f", 0.0, 11.5), ("hand_b", 0.0, 10.0)),
    "dumbbell": (("hand_f", 0.0, 8.2), ("hand_b", 0.0, 7.0)),
    "kettlebells": _KB_CIRCLES,
}
_SW_ASSETS_RE = re.compile(r"APP_SHELL_ASSETS\s*=\s*(\[[^\]]*\])", flags=re.DOTALL)
_SW_STAMPED_VERSION_RE = re.compile(r'CACHE_VERSION\s*=\s*"v1-[0-9a-f]{12}"')
_CSP_PAT = r'<meta\s+[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>'
_CSP_META_RE = re.compile(_CSP_PAT, re.IGNORECASE)
_ATTR_PAT = r'(?:content="([^"]+)"|content=\'([^\']+)\')'
_CONTENT_ATTR_RE = re.compile(_ATTR_PAT, re.IGNORECASE)
_URL_RE = re.compile(r"https?://[^\s\"'<>()\\]+", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class AuditConfig:
    """File-path configuration for the end-to-end static PWA audit."""

    exercises_path: Path = DATA_DIR / "exercises.json"
    animations_path: Path = DATA_DIR / "animations.json"
    programs_path: Path = DATA_DIR / "programs.json"
    motion_js_path: Path = STATIC_DIR / "motion.js"
    pwa_dir: Path = PWA_DIR
    expected_count: int = EXPECTED_CATALOG_COUNT


@dataclass(frozen=True, slots=True)
class AuditSectionResult:
    """Pass/fail status and diagnostic messages for a single audit section."""

    name: str
    checked: int
    errors: tuple[str, ...]

    @property
    def passed(self) -> bool:
        """Return True when the audit section recorded zero errors."""
        return len(self.errors) == 0


@dataclass(frozen=True, slots=True)
class AuditReport:
    """Aggregated end-to-end catalog, coaching, rig, and static PWA audit report."""

    exercise_count: int
    archetype_count: int
    sections: tuple[AuditSectionResult, ...]

    @property
    def errors(self) -> list[str]:
        """Return all error strings flattened across every audit section."""
        return [f"[{sec.name}] {err}" for sec in self.sections for err in sec.errors]

    @property
    def passed(self) -> bool:
        """Return True when every audit section passed with zero errors."""
        return all(sec.passed for sec in self.sections)


def find_node_binary() -> str | None:
    """Locate a Node.js executable on PATH or under standard user-local directories."""
    env_bin = os.environ.get("TA_NODE_BIN")
    if env_bin and Path(env_bin).is_file() and os.access(env_bin, os.X_OK):
        return env_bin
    if which_bin := shutil.which("node"):
        return which_bin
    home = Path.home()
    roots = (home / ".local" / "share", home / ".nvm" / "versions" / "node")
    for base_dir, pat in zip(roots, ("*/node-v*/bin/node", "*/bin/node"), strict=True):
        if base_dir.is_dir():
            for cand in sorted(base_dir.glob(pat), reverse=True):
                if cand.is_file() and os.access(cand, os.X_OK):
                    return str(cand)
    return None


def _run_cmd(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    kw: dict[str, Any] = {"env": env, "capture_output": True, "text": True}
    return subprocess.run(args, check=False, timeout=30, **kw)  # noqa: S603


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _parse_svg(markup: str) -> ET.Element:
    return ET.fromstring(markup)  # noqa: S314


def _circle_err(label: str, center: tuple[float, float], r: float) -> list[str]:
    cx, cy = center
    x_ok = cx - r >= -SVG_COORD_TOL and cx + r <= VIEWPORT_MAX_X + SVG_COORD_TOL
    y_ok = cy - r >= -SVG_COORD_TOL and cy + r <= FLOOR_Y + SVG_COORD_TOL
    return [] if (x_ok and y_ok) else [f"{label} circle ({cx:.2f}, {cy:.2f}) r={r} OOB"]


def _check_compiled_catalog_payload(
    dist_dir: Path, catalog: dict[str, Any], expected_ids: set[str], errors: list[str]
) -> None:
    if (dist_dir / "static" / "svgs").exists():
        errors.append("dist/static/svgs/ directory must not exist")
    if catalog.get("schema_version") != 1:
        errors.append(f"catalog.json schema_version={catalog.get('schema_version')}")
    compiled = catalog.get("exercises")
    if not isinstance(compiled, list):
        errors.append("catalog.json 'exercises' is not a list")
        return
    svgs = catalog.get("svgs") if isinstance(catalog.get("svgs"), dict) else {}
    thumbs = list((dist_dir / "svgs" / "thumbs").glob("*.svg"))
    c_ok = len(compiled) == len(expected_ids) and len(svgs) == EXPECTED_SVG_COMBO_COUNT
    t_ok = len(thumbs) == EXPECTED_SVG_COMBO_COUNT and all(":" in str(k) for k in svgs)
    if not (c_ok and t_ok):
        errors.append("catalog.json exercise/svg/thumbnail counts or keys invalid")
    comp_ids = {str(it.get("id") or "") for it in compiled if isinstance(it, dict)}
    if comp_ids != expected_ids:
        errors.append("Compiled catalog.json IDs diverge from exercises.json IDs")
    for it in compiled:
        if not isinstance(it, dict):
            errors.append("catalog.json non-dict exercise")
            continue
        t_rel = str(it.get("thumb_url") or "").removeprefix("./")
        k_ok = set(it.keys()) == EXPECTED_COMPILED_EXERCISE_KEYS
        svg_ok = str(it.get("svg_key") or "") in svgs and (dist_dir / t_rel).is_file()
        if not (k_ok and svg_ok):
            errors.append(f"{it.get('id')}: invalid compiled exercise")


def _check_shell_and_privacy(dist_dir: Path, errors: list[str]) -> None:
    m_path = dist_dir / "manifest.webmanifest"
    sw_path, idx_path = dist_dir / "sw.js", dist_dir / "index.html"
    if not (m_path.is_file() and sw_path.is_file() and idx_path.is_file()):
        errors.append("Missing manifest.webmanifest, sw.js, or index.html in dist/")
        return
    manifest = json.loads(m_path.read_text(encoding="utf-8"))
    if manifest.get("display") != "standalone" or manifest.get("start_url") != "./":
        errors.append("manifest.webmanifest invalid display or start_url")
    sw_src = sw_path.read_text(encoding="utf-8")
    match = _SW_ASSETS_RE.search(sw_src)
    assets = json.loads(re.sub(r",\s*\]", "]", match.group(1))) if match else []
    v_ok = bool(_SW_STAMPED_VERSION_RE.search(sw_src))
    a_ok = set(assets) == REQUIRED_PRECACHE_ASSETS
    f_ok = all((dist_dir / str(u).removeprefix("./")).exists() for u in assets)
    if not (v_ok and a_ok and f_ok):
        errors.append("sw.js CACHE_VERSION or APP_SHELL_ASSETS validation failed")
    csp_match = _CSP_META_RE.search(idx_path.read_text(encoding="utf-8"))
    attr = _CONTENT_ATTR_RE.search(csp_match.group(0)) if csp_match else None
    csp_val = (attr.group(1) or attr.group(2) or "") if attr else ""
    csp_ok = all(d in csp_val for d in REQUIRED_CSP_DIRECTIVES)
    if not csp_ok or any(b in csp_val for b in ("http:", "https:", "*")):
        errors.append("index.html CSP missing or allows external origins")
    for rel_file in PRIVACY_SCAN_FILES:
        fp = dist_dir / rel_file
        if not fp.is_file():
            errors.append(f"Missing expected PWA file in dist/: {rel_file}")
            continue
        text = fp.read_text(encoding="utf-8")
        urls = [u.rstrip(".,;:'\"`") for u in _URL_RE.findall(text)]
        cdn_hit = any(t in text.lower() for t in FORBIDDEN_CDN_TOKENS)
        if cdn_hit or any(u not in ALLOWED_W3C_NAMESPACE_URLS for u in urls):
            errors.append(f"{rel_file}: contains forbidden CDN or external URL")


def _is_valid_raw_exercise(item: object) -> bool:
    if not isinstance(item, dict) or set(item.keys()) != EXPECTED_CATALOG_KEYS:
        return False
    str_ok = all(
        isinstance(item.get(k), str) and bool(item[k].strip()) for k in _CAT_STR_KEYS
    )
    bool_ok = all(isinstance(item.get(k), bool) for k in _CAT_BOOL_KEYS)
    return str_ok and bool_ok


def _audit_catalog_and_pwa_bundle(
    cfg: AuditConfig, dist_dir: Path, *, reuse: bool
) -> tuple[AuditSectionResult, list[CatalogExercise], set[str], dict[str, Any]]:
    if not cfg.exercises_path.is_file():
        msg = f"Missing exercises catalog: {cfg.exercises_path}"
        return (AuditSectionResult("catalog_and_pwa_bundle", 0, (msg,)), [], set(), {})
    raw = json.loads(cfg.exercises_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    if len(raw) != cfg.expected_count:
        errors.append(f"exercises.json count {len(raw)} != {cfg.expected_count}")
    for i, it in enumerate(raw):
        if not _is_valid_raw_exercise(it):
            errors.append(f"exercises.json[{i}] invalid schema or field types")
    r_ids = {str(it.get("id") or "").strip() for it in raw if isinstance(it, dict)}
    if len(r_ids) != len(raw):
        errors.append("Duplicate exercise IDs in exercises.json")
    exs = load_catalog_exercises(cfg.exercises_path)
    f_ok = all(getattr(ex, f, "").strip() for ex in exs for f in _CAT_STR_KEYS)
    if {ex.id for ex in exs} != r_ids or not f_ok:
        errors.append("load_catalog_exercises mismatch or empty required field")
    if reuse:
        cat = json.loads((dist_dir / "data" / "catalog.json").read_text("utf-8"))
    else:
        s_dir, d_dir = cfg.motion_js_path.parent, cfg.exercises_path.parent
        kw = {"data_dir": d_dir, "static_dir": s_dir, "pwa_dir": cfg.pwa_dir}
        cat = build_pwa(dist_dir, **kw)["catalog"]
    _check_compiled_catalog_payload(dist_dir, cat, r_ids, errors)
    _check_shell_and_privacy(dist_dir, errors)
    sec = AuditSectionResult("catalog_and_pwa_bundle", len(exs), tuple(errors))
    return (sec, exs, r_ids, cat)


def _check_single_exercise_coaching(
    ex: CatalogExercise, meta: JsonMap, specs: JsonMap, comp: JsonMap | None
) -> list[str]:
    arch = str(meta.get("archetype") or "")
    tempo, is_hold = str(meta.get("tempo_mode") or ""), bool(meta.get("is_hold"))
    s_ok = set(meta.keys()) == EXPECTED_METADATA_KEYS and arch in specs
    e_ok = ex.archetype == arch and ex.is_hold == is_hold and ex.tempo_mode == tempo
    t_ok = tempo in VALID_TEMPO_MODES and is_hold == (tempo == "hold")
    h_ok = ex.category.lower() != "stretching" or is_hold
    cues = ("how_to", "cue_work", "cue_return")
    cues_ok = all(str(meta.get(k) or "").strip() for k in cues)
    comp_ok = comp is None or all(
        comp.get(k) == meta[k] for k in EXPECTED_METADATA_KEYS
    )
    if not (s_ok and e_ok and t_ok and h_ok and cues_ok and comp_ok):
        return [f"{ex.id}: coaching metadata invariant failed"]
    return []


def _audit_coaching_integration(
    cfg: AuditConfig,
    exs: list[CatalogExercise],
    cat: JsonMap,
    sp: JsonMap,
) -> tuple[AuditSectionResult, dict[str, JsonMap]]:
    metas: dict[str, JsonMap] = {}
    errors: list[str] = []
    a_coach = load_archetype_coaching(cfg.animations_path)
    if len(sp) != EXPECTED_ARCHETYPE_COUNT or set(a_coach) != set(sp):
        errors.append("archetype_coaching validation failed")
    cat_ex = cat.get("exercises", [])
    comp_map = {str(x["id"]): x for x in cat_ex if isinstance(x, dict) and "id" in x}
    for ex in exs:
        meta = build_exercise_metadata(ex, archetype_coaching=a_coach)
        metas[ex.id] = meta
        comp = comp_map.get(ex.id)
        errors.extend(_check_single_exercise_coaching(ex, meta, sp, comp))
    sec = AuditSectionResult("coaching_integration", len(exs), tuple(errors))
    return (sec, metas)


def _check_pose_and_props(
    lbl: str, bones: dict[str, float], pts: dict[str, Any], eq: str, bar: str
) -> list[str]:
    errs = [
        f"{lbl}: {b}"
        for p1, p2, b in _SEGMENT_PAIRS
        if abs(_dist(pts[p1], pts[p2]) - bones[b]) > BONE_LEN_TOL
    ]
    for j, (jx, jy) in pts.items():
        in_x = VIEWPORT_MIN <= jx <= VIEWPORT_MAX_X
        if not (in_x and VIEWPORT_MIN <= jy <= VIEWPORT_MAX_JOINT_Y):
            errs.append(f"{lbl}: {j} OOB")
    hx, hy = pts["head"]
    h_in_x = HEAD_RADIUS <= hx <= VIEWPORT_MAX_X - HEAD_RADIUS
    if not (h_in_x and HEAD_RADIUS <= hy <= VIEWPORT_MAX_JOINT_Y):
        errs.append(f"{lbl}: head clips viewport")
    if bar == "shoulder":
        errs.append(f"{lbl}: forbidden bar_mode='shoulder'")
    for joint_key, dy, radius in _PROP_CIRCLES.get(eq, ()):
        jx, jy = pts[joint_key]
        errs.extend(_circle_err(f"{lbl} {eq}", (jx, jy + dy), radius))
    return errs


def _check_inline_svg_safe_grip(
    label: str, root: ET.Element, arch: str, eq_mode: str, errors: list[str]
) -> None:
    a_ok = (root.get("data-archetype"), root.get("data-equipment")) == (arch, eq_mode)
    if not a_ok or root.get("data-bar-mode") == "shoulder":
        errors.append(f"{label}: invalid data-archetype/equipment/bar-mode")
    farm_f = root.find(".//*[@class='js-farm-f']")
    farm_b = root.find(".//*[@class='js-farm-b']")
    wf_el = root.find(".//*[@class='js-weight']")
    wb_el = root.find(".//*[@class='js-weight-b']")
    if farm_f is None or farm_b is None:
        errors.append(f"{label}: missing .js-farm-f/.js-farm-b")
        return
    if eq_mode not in HANDHELD_WEIGHT_MODES:
        if wf_el is not None:
            errors.append(f"{label}: {eq_mode} unexpectedly renders .js-weight")
        return
    if wf_el is None or wb_el is None:
        errors.append(f"{label}: {eq_mode} missing .js-weight/.js-weight-b")
        return
    hf = (float(farm_f.attrib["x2"]), float(farm_f.attrib["y2"]))
    hb = (float(farm_b.attrib["x2"]), float(farm_b.attrib["y2"]))
    wf = (float(wf_el.attrib["cx"]), float(wf_el.attrib["cy"]))
    wb = (float(wb_el.attrib["cx"]), float(wb_el.attrib["cy"]))
    errors.extend(_circle_err(f"{label} .js-weight", wf, float(wf_el.attrib["r"])))
    errors.extend(_circle_err(f"{label} .js-weight-b", wb, float(wb_el.attrib["r"])))
    if eq_mode in {"barbell", "dumbbell"}:
        if _dist(wf, hf) > SVG_COORD_TOL or _dist(wb, hb) > SVG_COORD_TOL:
            errors.append(f"{label}: {eq_mode} weight detached from hands")
    elif eq_mode == "kettlebells":
        hdl = root.find(".//*[@class='js-kb-handle-f']")
        cx, cy = (hdl.get("cx", 0), hdl.get("cy", 0)) if hdl is not None else (0, 0)
        if hdl is None or _dist((float(cx), float(cy)), hf) > MAX_KB_HANDLE_DIST:
            errors.append(f"{label}: kettlebell handle missing or detached")


def verify_motion_js_safe_grip(
    motion_js_path: Path, combos: list[tuple[str, str]]
) -> list[str]:
    """Verify motion.js safe-grip invariants via static source check and Node helper."""
    if not motion_js_path.is_file():
        return [f"Missing motion.js: {motion_js_path}"]
    src = motion_js_path.read_text(encoding="utf-8")
    if "function renderPoseState" not in src:
        return ["motion.js missing function renderPoseState"]
    errors: list[str] = []
    body = src[src.index("function renderPoseState") :]
    bad = ("querySelector", 'barMode === "shoulder"', "Math.min(159", "Math.min(165")
    if any(tok in body for tok in bad):
        errors.append("motion.js violates renderPoseState safe-grip static invariants")
    node_bin, helper = find_node_binary(), REPO_ROOT / "tests" / "check_motion_rig.cjs"
    hh = [(a, e) for a, e in combos if e in HANDHELD_WEIGHT_MODES]
    if node_bin is not None and hh and helper.is_file():
        specs = load_animation_registry()[2]
        tm = {a: s["coaching"]["tempo_mode"] for a, s in specs.items()}
        it = [{**specs[a], "arch": a, "eq_mode": e, "tempo_mode": tm[a]} for a, e in hh]
        js_p, c_json = str(motion_js_path), json.dumps(it)
        env = {**os.environ, "TA_MOTION_JS": js_p, "TA_COMBOS_JSON": c_json}
        proc = _run_cmd([node_bin, str(helper)], env)
        if proc.returncode != 0:
            errors.append(f"Node motion.js helper failed: {proc.stderr.strip()}")
        else:
            fails = json.loads(proc.stdout).get("failures", [])
            errors.extend(f"Node motion.js: {m}" for m in fails)
    return errors


def _check_combo_svg_and_thumb(
    combo: tuple[str, str], spec: JsonMap, svgs: JsonMap, dist: Path, errs: list[str]
) -> None:
    arch, eq_mode = combo
    inline = str(svgs.get(f"{arch}:{eq_mode}") or "")
    if not inline:
        errs.append(f"Missing inline SVG for {arch}:{eq_mode}")
    else:
        lbl = f"svgs[{arch}:{eq_mode}]"
        _check_inline_svg_safe_grip(lbl, _parse_svg(inline), arch, eq_mode, errs)
    tp = dist / "svgs" / "thumbs" / f"{arch}__{eq_mode}.svg"
    if not tp.is_file():
        errs.append(f"Missing thumbnail SVG: {tp.name}")
    else:
        tt = tp.read_text(encoding="utf-8")
        tr = _parse_svg(tt)
        t_ok = (tr.get("data-archetype"), tr.get("data-equipment")) == (arch, eq_mode)
        if not t_ok or 'data-pose-a="' in tt or 'class="js-' in tt:
            errs.append(f"{tp.name}: invalid thumbnail attributes")
    bones, pa, pb = spec["bones"], spec["pose_a"], spec["pose_b"]
    b_mode = str(spec["bar_mode"])
    for swap in (False, True):
        for t in SAMPLE_TS:
            pts = solve_fk(bones, lerp_pose(pa, pb, t), swap_sides=swap)
            lbl = f"{arch}:{eq_mode} t={t}"
            errs.extend(_check_pose_and_props(lbl, bones, pts, eq_mode, b_mode))
            is_rack = eq_mode == "body_only" and arch in RACK_ARCHETYPES and not swap
            far_sh = _dist(pts["hand_f"], pts["shoulder"]) > MAX_RACK_HAND_SHOULDER_DIST
            if is_rack and (pts["hand_f"][1] >= pts["mid_spine"][1] or far_sh):
                errs.append(f"{arch} t={t}: rack hand position invalid")


def _audit_animations_and_safe_grip(
    cfg: AuditConfig,
    exs: list[CatalogExercise],
    metas: JsonMap,
    dist: Path,
    cat: JsonMap,
) -> AuditSectionResult:
    errors: list[str] = []
    specs = load_animation_registry(cfg.animations_path)[2]
    all_combos = [(a, e) for a in sorted(specs) for e in CANONICAL_EQUIPMENT_MODES]
    svgs = cat.get("svgs", {})
    for combo in all_combos:
        _check_combo_svg_and_thumb(combo, specs[combo[0]], svgs, dist, errors)
    for ex in exs:
        arch = str((metas.get(ex.id) or {}).get("archetype") or ex.archetype)
        if (arch, normalize_equipment(ex.equipment, arch)) not in all_combos:
            errors.append(f"{ex.id}: unexpected combo")
    errors.extend(verify_motion_js_safe_grip(cfg.motion_js_path, all_combos))
    return AuditSectionResult("animations_and_safe_grip", len(exs), tuple(errors))


def _audit_programs_config(
    cfg: AuditConfig, by_id: dict[str, CatalogExercise], specs: dict[str, Any]
) -> list[str]:
    if not cfg.programs_path.is_file():
        return [f"Missing programs.json: {cfg.programs_path}"]
    prog_cfg = load_programs_config(cfg.programs_path)
    props = prog_cfg.get("setup_equipment_props", {})
    modes = CANONICAL_EQUIPMENT_MODES
    errors = [f"bad prop {t}={m}" for t, m in props.items() if m not in modes]
    covered: set[str] = set()
    for tier, prog in prog_cfg["equipment_programs"].items():
        allowed_eq = TIER_ALLOWED_EQUIPMENT.get(tier)
        for _rname, slot_specs in prog["routines"]:
            for ex_id, reps, weight in slot_specs:
                ex = by_id.get(str(ex_id))
                if ex is None:
                    errors.append(f"programs.json[{tier}]: missing exercise '{ex_id}'")
                    continue
                covered.add(ex.archetype)
                hold = ex.is_hold
                eq_ok = allowed_eq is None or ex.equipment in allowed_eq
                rep_ok = not hold or int(reps) >= MIN_HOLD_REPS
                w_in = weight is None or MIN_WEIGHT_KG <= float(weight) <= MAX_WEIGHT_KG
                w_ok = (tier != "body_only" or weight is None) and w_in
                need_w = tier != "body_only" and ex.equipment in WEIGHTED_EQUIPMENT
                w_req_ok = not (need_w and not hold) or weight is not None
                if not (eq_ok and rep_ok and w_ok and w_req_ok):
                    errors.append(f"programs.json[{tier}][{ex.id}]: slot invariant")
    if missing := sorted(set(specs.keys()) - covered):
        errors.append(f"programs.json missing archetypes: {missing}")
    return errors


def verify_pwa_bundle_with_node(dist_dir: Path) -> list[str]:
    """Run standalone Node.js test suites against a compiled static PWA directory."""
    if (node_bin := find_node_binary()) is None:
        return ["Node.js binary not found for static PWA E2E suite"]
    t_dir, env = REPO_ROOT / "tests", {**os.environ, "TA_DIST_DIR": str(dist_dir)}
    s1, s2 = str(t_dir / "pwa_store_qr.test.cjs"), str(t_dir / "pwa_ui_audio.test.cjs")
    proc = _run_cmd([node_bin, "--test", s1, s2], env)
    if proc.returncode != 0:
        return [f"Node PWA E2E failed:\n{(proc.stderr or proc.stdout).strip()}"]
    return []


def run_catalog_audit(
    config: AuditConfig | None = None, dist_dir: Path | None = None
) -> AuditReport:
    """Run exhaustive end-to-end checks across all 876 exercises and the static PWA."""
    cfg = config or AuditConfig()
    specs = load_animation_registry(cfg.animations_path)[2]
    env_dist = os.environ.get("TA_DIST_DIR") if config is None else None
    res = dist_dir or (Path(env_dist) if env_dist else None)
    with tempfile.TemporaryDirectory(prefix="training_aid_audit_") as tmp_str:
        reuse = res is not None and (res / "data" / "catalog.json").is_file()
        target = res if (reuse and res is not None) else Path(tmp_str) / "dist"
        sec_b, exs, _r_ids, cat = _audit_catalog_and_pwa_bundle(
            cfg, target, reuse=reuse
        )
        sec_c, metas = _audit_coaching_integration(cfg, exs, cat, specs)
        sec_r = _audit_animations_and_safe_grip(cfg, exs, metas, target, cat)
        pwa_errs = _audit_programs_config(cfg, {ex.id: ex for ex in exs}, specs)
        pwa_errs.extend(verify_pwa_bundle_with_node(target))
        sec_p = AuditSectionResult(
            "pwa_programs_and_node_e2e", len(exs), tuple(pwa_errs)
        )
        return AuditReport(len(exs), len(specs), (sec_b, sec_c, sec_r, sec_p))


def main() -> None:
    """Execute `run_catalog_audit()` as a CLI check and exit non-zero on any failure."""
    r = run_catalog_audit()
    msg = f"Training Aid Audit — {r.exercise_count} ex, {r.archetype_count} arch\n"
    sys.stdout.write(msg)
    for sec in r.sections:
        status = "PASS" if sec.passed else f"FAIL ({len(sec.errors)} errors)"
        sys.stdout.write(f"  [{status}] {sec.name} (checked={sec.checked})\n")
    if not r.passed:
        for err in r.errors:
            sys.stderr.write(f"  - {err}\n")
        raise SystemExit(1)
    sys.stdout.write("All E2E catalog, coaching, rig, and static PWA checks PASSED.\n")
    raise SystemExit(0)


if __name__ == "__main__":
    main()
