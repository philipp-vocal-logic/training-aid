from html import escape
import json
from pathlib import Path
from typing import Any

SVGS_DIR = Path(__file__).resolve().parent / "static" / "svgs"

Point = tuple[float, float]


def _pose(
    *,
    head: Point,
    shoulder: Point,
    hip: Point,
    elbow_f: Point,
    hand_f: Point,
    knee_f: Point,
    foot_f: Point,
    elbow_b: Point | None = None,
    hand_b: Point | None = None,
    knee_b: Point | None = None,
    foot_b: Point | None = None,
) -> dict[str, list[float]]:
    eb = elbow_b or (elbow_f[0] - 5, elbow_f[1] - 2)
    hb = hand_b or (hand_f[0] - 5, hand_f[1] - 2)
    kb = knee_b or (knee_f[0] - 6, knee_f[1])
    fb = foot_b or (foot_f[0] - 6, foot_f[1])
    return {
        "head": [head[0], head[1]],
        "shoulder": [shoulder[0], shoulder[1]],
        "hip": [hip[0], hip[1]],
        "elbow_f": [elbow_f[0], elbow_f[1]],
        "hand_f": [hand_f[0], hand_f[1]],
        "elbow_b": [eb[0], eb[1]],
        "hand_b": [hb[0], hb[1]],
        "knee_f": [knee_f[0], knee_f[1]],
        "foot_f": [foot_f[0], foot_f[1]],
        "knee_b": [kb[0], kb[1]],
        "foot_b": [fb[0], fb[1]],
    }


ARCHETYPE_SPECS: dict[str, dict[str, Any]] = {
    "squat": {
        "prop": None,
        "pose_a": _pose(
            head=(122, 39),
            shoulder=(120, 58),
            hip=(118, 100),
            knee_f=(126, 136),
            foot_f=(125, 172),
            elbow_f=(115, 80),
            hand_f=(136, 74),
        ),
        "pose_b": _pose(
            head=(124, 78),
            shoulder=(120, 97),
            hip=(104, 136),
            knee_f=(142, 137),
            foot_f=(125, 172),
            elbow_f=(140, 100),
            hand_f=(164, 94),
        ),
    },
    "lunge": {
        "prop": None,
        "pose_a": _pose(
            head=(118, 41),
            shoulder=(118, 60),
            hip=(118, 102),
            knee_f=(140, 136),
            foot_f=(154, 172),
            knee_b=(98, 138),
            foot_b=(84, 172),
            elbow_f=(114, 84),
            hand_f=(124, 98),
        ),
        "pose_b": _pose(
            head=(118, 73),
            shoulder=(118, 92),
            hip=(118, 134),
            knee_f=(154, 136),
            foot_f=(154, 172),
            knee_b=(114, 164),
            foot_b=(84, 172),
            elbow_f=(128, 112),
            hand_f=(148, 106),
        ),
    },
    "pushup": {
        "prop": None,
        "pose_a": _pose(
            head=(179, 102),
            shoulder=(160, 112),
            hip=(120, 132),
            knee_f=(88, 152),
            foot_f=(55, 172),
            elbow_f=(161, 142),
            hand_f=(162, 172),
        ),
        "pose_b": _pose(
            head=(184, 142),
            shoulder=(164, 148),
            hip=(122, 154),
            knee_f=(88, 163),
            foot_f=(55, 172),
            elbow_f=(143, 137),
            hand_f=(162, 172),
        ),
    },
    "plank": {
        "prop": "pulse",
        "pose_a": _pose(
            head=(185, 134),
            shoulder=(166, 138),
            hip=(124, 146),
            knee_f=(90, 159),
            foot_f=(55, 172),
            elbow_f=(164, 172),
            hand_f=(188, 172),
        ),
        "pose_b": _pose(
            head=(185, 131),
            shoulder=(166, 135),
            hip=(124, 141),
            knee_f=(90, 157),
            foot_f=(55, 172),
            elbow_f=(164, 172),
            hand_f=(188, 172),
        ),
    },
    "hinge": {
        "prop": "weight",
        "pose_a": _pose(
            head=(120, 39),
            shoulder=(118, 58),
            hip=(116, 100),
            knee_f=(122, 136),
            foot_f=(120, 172),
            elbow_f=(120, 82),
            hand_f=(124, 106),
        ),
        "pose_b": _pose(
            head=(150, 71),
            shoulder=(133, 82),
            hip=(94, 106),
            knee_f=(118, 138),
            foot_f=(120, 172),
            elbow_f=(130, 112),
            hand_f=(130, 142),
        ),
    },
    "glute_bridge": {
        "prop": None,
        "pose_a": _pose(
            head=(56, 160),
            shoulder=(76, 164),
            hip=(118, 166),
            knee_f=(148, 134),
            foot_f=(168, 172),
            elbow_f=(96, 168),
            hand_f=(122, 170),
        ),
        "pose_b": _pose(
            head=(56, 160),
            shoulder=(76, 164),
            hip=(114, 146),
            knee_f=(148, 134),
            foot_f=(168, 172),
            elbow_f=(96, 168),
            hand_f=(122, 170),
        ),
    },
    "crunch_core": {
        "prop": None,
        "pose_a": _pose(
            head=(58, 154),
            shoulder=(76, 162),
            hip=(118, 166),
            knee_f=(146, 134),
            foot_f=(168, 172),
            elbow_f=(74, 142),
            hand_f=(62, 148),
        ),
        "pose_b": _pose(
            head=(88, 118),
            shoulder=(97, 136),
            hip=(118, 166),
            knee_f=(142, 130),
            foot_f=(168, 172),
            elbow_f=(114, 122),
            hand_f=(92, 118),
        ),
    },
    "mountain_climber": {
        "prop": None,
        "pose_a": _pose(
            head=(179, 102),
            shoulder=(160, 112),
            hip=(118, 132),
            knee_f=(144, 140),
            foot_f=(118, 158),
            knee_b=(88, 152),
            foot_b=(56, 172),
            elbow_f=(161, 142),
            hand_f=(162, 172),
        ),
        "pose_b": _pose(
            head=(179, 102),
            shoulder=(160, 112),
            hip=(118, 132),
            knee_f=(88, 152),
            foot_f=(56, 172),
            knee_b=(144, 140),
            foot_b=(118, 158),
            elbow_f=(161, 142),
            hand_f=(162, 172),
        ),
    },
    "dip": {
        "prop": "dip_box",
        "pose_a": _pose(
            head=(98, 69),
            shoulder=(96, 88),
            hip=(104, 128),
            knee_f=(136, 148),
            foot_f=(166, 172),
            elbow_f=(86, 112),
            hand_f=(88, 138),
        ),
        "pose_b": _pose(
            head=(100, 96),
            shoulder=(98, 115),
            hip=(106, 155),
            knee_f=(138, 158),
            foot_f=(166, 172),
            elbow_f=(72, 118),
            hand_f=(88, 138),
        ),
    },
    "overhead_press": {
        "prop": "weight",
        "pose_a": _pose(
            head=(120, 44),
            shoulder=(120, 64),
            hip=(120, 104),
            knee_f=(130, 138),
            foot_f=(132, 172),
            knee_b=(110, 138),
            foot_b=(108, 172),
            elbow_f=(144, 80),
            hand_f=(140, 54),
            elbow_b=(96, 80),
            hand_b=(100, 54),
        ),
        "pose_b": _pose(
            head=(120, 44),
            shoulder=(120, 64),
            hip=(120, 104),
            knee_f=(130, 138),
            foot_f=(132, 172),
            knee_b=(110, 138),
            foot_b=(108, 172),
            elbow_f=(135, 40),
            hand_f=(132, 16),
            elbow_b=(105, 40),
            hand_b=(108, 16),
        ),
    },
    "bench_press": {
        "prop": "bench",
        "pose_a": _pose(
            head=(66, 124),
            shoulder=(88, 128),
            hip=(130, 130),
            knee_f=(162, 134),
            foot_f=(168, 172),
            elbow_f=(92, 146),
            hand_f=(94, 114),
            elbow_b=(88, 144),
            hand_b=(90, 114),
        ),
        "pose_b": _pose(
            head=(66, 124),
            shoulder=(88, 128),
            hip=(130, 130),
            knee_f=(162, 134),
            foot_f=(168, 172),
            elbow_f=(92, 102),
            hand_f=(94, 72),
            elbow_b=(88, 102),
            hand_b=(90, 72),
        ),
    },
    "row_pull": {
        "prop": "weight",
        "pose_a": _pose(
            head=(151, 69),
            shoulder=(134, 80),
            hip=(96, 106),
            knee_f=(124, 138),
            foot_f=(120, 172),
            elbow_f=(134, 110),
            hand_f=(136, 138),
        ),
        "pose_b": _pose(
            head=(151, 69),
            shoulder=(134, 80),
            hip=(96, 106),
            knee_f=(124, 138),
            foot_f=(120, 172),
            elbow_f=(110, 68),
            hand_f=(122, 96),
        ),
    },
    "curl": {
        "prop": "weight",
        "pose_a": _pose(
            head=(122, 39),
            shoulder=(120, 58),
            hip=(118, 100),
            knee_f=(122, 136),
            foot_f=(122, 172),
            elbow_f=(120, 84),
            hand_f=(126, 108),
        ),
        "pose_b": _pose(
            head=(122, 39),
            shoulder=(120, 58),
            hip=(118, 100),
            knee_f=(122, 136),
            foot_f=(122, 172),
            elbow_f=(120, 84),
            hand_f=(138, 62),
        ),
    },
}


def render_archetype_svg(archetype: str) -> str:
    spec = ARCHETYPE_SPECS.get(archetype, ARCHETYPE_SPECS["squat"])
    pa = spec["pose_a"]
    pb = spec["pose_b"]
    prop = spec["prop"]

    pose_a_attr = escape(json.dumps(pa, separators=(",", ":")), quote=True)
    pose_b_attr = escape(json.dumps(pb, separators=(",", ":")), quote=True)
    grad_id = f"glow-{archetype}"

    prop_markup = ""
    if prop == "bench":
        prop_markup = (
            '<rect x="50" y="136" width="96" height="8" rx="4" fill="#334155" stroke="#475569" stroke-width="1.2" />'
            '<line x1="66" y1="144" x2="66" y2="174" stroke="#334155" stroke-width="5" stroke-linecap="round" />'
            '<line x1="130" y1="144" x2="130" y2="174" stroke="#334155" stroke-width="5" stroke-linecap="round" />'
        )
    elif prop == "dip_box":
        prop_markup = (
            '<rect x="42" y="138" width="54" height="36" rx="6" fill="#1e293b" stroke="#475569" stroke-width="1.8" />'
        )
    elif prop == "pulse":
        prop_markup = (
            '<circle class="js-pulse" cx="135" cy="142" r="24" fill="none" '
            'stroke="#34d399" stroke-width="2.5" stroke-opacity="0.45" />'
        )

    weight_b_markup = ""
    weight_f_markup = ""
    if prop in {"weight", "bench"}:
        weight_b_markup = (
            f'<circle class="js-weight-b" cx="{pa["hand_b"][0]}" cy="{pa["hand_b"][1]}" '
            f'r="7.5" fill="#059669" fill-opacity="0.65" />'
        )
        weight_f_markup = (
            f'<circle class="js-weight" cx="{pa["hand_f"][0]}" cy="{pa["hand_f"][1]}" '
            f'r="8.5" fill="#10b981" stroke="#d1fae5" stroke-width="1.8" />'
        )

    shadow_x = round((pa["shoulder"][0] + pa["hip"][0] + pa["foot_f"][0]) / 3.0, 1)

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" preserveAspectRatio="xMidYMid meet" class="exercise-svg" role="img" aria-label="{archetype}" data-archetype="{archetype}" data-pose-a="{pose_a_attr}" data-pose-b="{pose_b_attr}">
  <defs>
    <radialGradient id="{grad_id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.18" />
      <stop offset="65%" stop-color="#10b981" stop-opacity="0.04" />
      <stop offset="100%" stop-color="#10b981" stop-opacity="0" />
    </radialGradient>
  </defs>
  <circle class="js-aura" cx="120" cy="102" r="82" fill="url(#{grad_id})" />
  <circle class="js-ring" cx="120" cy="102" r="64" fill="none" stroke="#34d399" stroke-opacity="0.14" stroke-width="1.2" stroke-dasharray="3 6" />
  <line x1="16" y1="175" x2="224" y2="175" stroke="#334155" stroke-width="3" stroke-linecap="round" />
  <ellipse class="js-shadow" cx="{shadow_x}" cy="176" rx="28" ry="3.5" fill="#10b981" fill-opacity="0.22" />
  {prop_markup}
  <g stroke="#64748b" stroke-width="8" stroke-linecap="round">
    <line class="js-thigh-b" x1="{pa['hip'][0]}" y1="{pa['hip'][1]}" x2="{pa['knee_b'][0]}" y2="{pa['knee_b'][1]}" />
    <line class="js-shin-b" x1="{pa['knee_b'][0]}" y1="{pa['knee_b'][1]}" x2="{pa['foot_b'][0]}" y2="{pa['foot_b'][1]}" />
    <line class="js-uarm-b" x1="{pa['shoulder'][0]}" y1="{pa['shoulder'][1]}" x2="{pa['elbow_b'][0]}" y2="{pa['elbow_b'][1]}" />
    <line class="js-farm-b" x1="{pa['elbow_b'][0]}" y1="{pa['elbow_b'][1]}" x2="{pa['hand_b'][0]}" y2="{pa['hand_b'][1]}" />
  </g>
  {weight_b_markup}
  <g stroke="#e2e8f0" stroke-width="9.5" stroke-linecap="round">
    <line class="js-thigh-f" x1="{pa['hip'][0]}" y1="{pa['hip'][1]}" x2="{pa['knee_f'][0]}" y2="{pa['knee_f'][1]}" />
    <line class="js-shin-f" x1="{pa['knee_f'][0]}" y1="{pa['knee_f'][1]}" x2="{pa['foot_f'][0]}" y2="{pa['foot_f'][1]}" />
  </g>
  <line class="js-torso" x1="{pa['shoulder'][0]}" y1="{pa['shoulder'][1]}" x2="{pa['hip'][0]}" y2="{pa['hip'][1]}" stroke="#f8fafc" stroke-width="11" stroke-linecap="round" />
  <g stroke="#34d399" stroke-width="8.8" stroke-linecap="round">
    <line class="js-uarm-f" x1="{pa['shoulder'][0]}" y1="{pa['shoulder'][1]}" x2="{pa['elbow_f'][0]}" y2="{pa['elbow_f'][1]}" />
    <line class="js-farm-f" x1="{pa['elbow_f'][0]}" y1="{pa['elbow_f'][1]}" x2="{pa['hand_f'][0]}" y2="{pa['hand_f'][1]}" />
  </g>
  <g fill="#0f172a" stroke="#34d399" stroke-width="1.6">
    <circle class="js-j-shoulder" cx="{pa['shoulder'][0]}" cy="{pa['shoulder'][1]}" r="3" />
    <circle class="js-j-hip" cx="{pa['hip'][0]}" cy="{pa['hip'][1]}" r="3" />
    <circle class="js-j-knee" cx="{pa['knee_f'][0]}" cy="{pa['knee_f'][1]}" r="2.8" />
    <circle class="js-j-elbow" cx="{pa['elbow_f'][0]}" cy="{pa['elbow_f'][1]}" r="2.8" />
  </g>
  <circle class="js-head" cx="{pa['head'][0]}" cy="{pa['head'][1]}" r="12" fill="#34d399" stroke="#ecfdf5" stroke-width="1.6" />
  {weight_f_markup}
</svg>
"""


def pregenerate_all_svgs(output_dir: Path = SVGS_DIR) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for archetype in ARCHETYPE_SPECS:
        target = output_dir / f"{archetype}.svg"
        target.write_text(render_archetype_svg(archetype), encoding="utf-8")
        written.append(target)
    return written


def load_svg_markup(archetype: str, svg_dir: Path = SVGS_DIR) -> str:
    target = svg_dir / f"{archetype}.svg"
    if not target.exists():
        pregenerate_all_svgs(svg_dir)
    if target.exists():
        return target.read_text(encoding="utf-8")
    return render_archetype_svg("squat")


if __name__ == "__main__":
    files = pregenerate_all_svgs()
    print(f"Pregenerated {len(files)} SVG files in {SVGS_DIR}")
