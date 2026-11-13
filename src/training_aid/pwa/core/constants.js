export const EQUIPMENT_OPTIONS = Object.freeze([
  Object.freeze({ id: "dumbbell", label: "Dumbbells", arch: "curl", prop: "dumbbell" }),
  Object.freeze({ id: "kettlebells", label: "Kettlebells", arch: "hinge", prop: "kettlebells" }),
  Object.freeze({ id: "bands", label: "Bands", arch: "row_pull", prop: "bands" }),
  Object.freeze({ id: "barbell", label: "Barbell", arch: "bench_press", prop: "barbell" }),
  Object.freeze({ id: "pull_up_bar", label: "Pull-Up Bar", arch: "vertical_pull", prop: "body_only" }),
  Object.freeze({ id: "bench", label: "Bench", arch: "dip", prop: "body_only" }),
  Object.freeze({ id: "machine", label: "Machines", arch: "leg_extension_curl", prop: "machine" }),
]);

export const VALID_EQUIPMENT_IDS = Object.freeze(EQUIPMENT_OPTIONS.map((opt) => opt.id));
const VALID_EQUIP_SET = new Set(VALID_EQUIPMENT_IDS);
export const EQUIP_LABEL_MAP = new Map(EQUIPMENT_OPTIONS.map((opt) => [opt.id, opt.label]));

export const VALID_INTENSITY = Object.freeze(["light", "moderate", "intense"]);
export const DEFAULT_INTENSITY_LABELS = Object.freeze({
  light: "Easy Start",
  moderate: "Moderate",
  intense: "Intense",
});

export const SOUND_THEMES = Object.freeze([
  Object.freeze({ id: "off", label: "Off" }),
  Object.freeze({ id: "minimal", label: "Minimal Cues" }),
  Object.freeze({ id: "techno", label: "Techno Pulse" }),
  Object.freeze({ id: "trance", label: "Trance Arp" }),
  Object.freeze({ id: "studio", label: "Studio Kit" }),
]);
export const VALID_SOUND_THEMES = Object.freeze(SOUND_THEMES.map((t) => t.id));

export const VALID_SPEED_MODES = Object.freeze(["slow", "normal", "fast"]);
export const SPEED_MULTIPLIERS = Object.freeze({ slow: 0.75, normal: 1.0, fast: 1.25 });
export const SPEED_LABELS = Object.freeze({
  slow: "Slow (0.75\u00d7)",
  normal: "Normal (1\u00d7)",
  fast: "Fast (1.25\u00d7)",
});
export const REST_PRESETS = Object.freeze([15, 30, 45, 60, 90]);
export const DEFAULT_REST_SECONDS = 30;

export const WEIGHTED_EQUIPMENT = new Set([
  "barbell",
  "dumbbell",
  "kettlebells",
  "cable",
  "machine",
  "e-z curl bar",
]);
export const DAY_MS = 86400000;

export function sanitizeString(val, maxLen, fallback = "") {
  if (typeof val !== "string") return fallback;
  const cleaned = val
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim()
    .slice(0, maxLen);
  return cleaned || fallback;
}

export function clampInt(val, minVal, maxVal, fallback) {
  const num = Number(val);
  return Number.isFinite(num)
    ? Math.max(minVal, Math.min(maxVal, Math.round(num)))
    : fallback;
}

const EQUIPMENT_ALIASES = Object.freeze({
  cable: "machine",
  cables: "machine",
  machines: "machine",
});

export function normalizeEquipmentList(input) {
  if (!Array.isArray(input)) return [];
  const picked = new Set();
  for (const raw of input) {
    const rawKey = String(raw || "").trim().toLowerCase();
    const key = EQUIPMENT_ALIASES[rawKey] || rawKey;
    if (VALID_EQUIP_SET.has(key)) picked.add(key);
  }
  return VALID_EQUIPMENT_IDS.filter((id) => picked.has(id));
}

export function normalizeSpeedMode(val, fallback = "normal") {
  const norm = String(val || "").trim().toLowerCase();
  if (VALID_SPEED_MODES.includes(norm)) return norm;
  return VALID_SPEED_MODES.includes(fallback) ? fallback : "normal";
}

export function clampRestSeconds(val, fallback = DEFAULT_REST_SECONDS) {
  return clampInt(val, 5, 300, fallback);
}

export function isWeightedCatalogEquipment(rawEquip) {
  return WEIGHTED_EQUIPMENT.has(String(rawEquip || "").trim().toLowerCase());
}

export function formatEquipmentSummary(eqList) {
  if (!Array.isArray(eqList) || eqList.length === 0) return "Bodyweight";
  if (eqList.length === EQUIPMENT_OPTIONS.length) return "Full Gym";
  const names = eqList.slice(0, 2).map((id) => EQUIP_LABEL_MAP.get(id) || id);
  return eqList.length > 2 ? `${names.join(", ")} +${eqList.length - 2}` : names.join(" & ");
}
