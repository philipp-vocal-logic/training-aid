/* Pure DOM & SVG node builders, trusted SVG mounting, icons, and date-time formatting */
export const SVG_NS = "http://www.w3.org/2000/svg";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BOOL_PROPS = new Set(["checked", "disabled", "hidden", "required", "readOnly", "selected"]);

function appendChildren(parent, children) {
  if (children === undefined || children === null) return;
  if (Array.isArray(children)) {
    for (const child of children) appendChildren(parent, child);
  } else if (typeof children === "string" || typeof children === "number") {
    parent.appendChild(document.createTextNode(String(children)));
  } else {
    parent.appendChild(children);
  }
}

export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      if (k === "className") node.className = v;
      else if (k === "textContent") node.textContent = String(v);
      else if (k === "dataset" && typeof v === "object") {
        for (const [dk, dv] of Object.entries(v)) {
          if (dv !== undefined && dv !== null) node.dataset[dk] = String(dv);
        }
      } else if (k === "style" && typeof v === "object") {
        for (const [sk, sv] of Object.entries(v)) node.style[sk] = sv;
      } else if (BOOL_PROPS.has(k)) node[k] = Boolean(v);
      else if (k === "value") node.value = String(v);
      else node.setAttribute(k, String(v));
    }
  }
  appendChildren(node, children);
  return node;
}

export function svgNode(tag, attrs, children) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      if (k === "textContent") node.textContent = String(v);
      else node.setAttribute(k, String(v));
    }
  }
  appendChildren(node, children);
  return node;
}

export function setTrustedSvg(container, svgMarkup) {
  if (!container) return;
  const trimmed = typeof svgMarkup === "string" ? svgMarkup.trim() : "";
  if (trimmed.startsWith("<svg")) container.innerHTML = trimmed;
  else container.replaceChildren();
}

export function resolveSvgMarkup(catalog, arch, eqMode) {
  const svgs = catalog && (catalog.svgs || catalog);
  if (!svgs || typeof svgs !== "object") return "";
  const rawArch = String(arch || "squat");
  if (rawArch.includes(":") && !eqMode && svgs[rawArch]) return svgs[rawArch];
  const baseArch = rawArch.includes(":") ? rawArch.split(":")[0] : rawArch;
  const rawEq = eqMode || (rawArch.includes(":") ? rawArch.split(":")[1] : "body_only");
  const mode = String(rawEq || "body_only").trim().replace(/\s+/g, "_") || "body_only";
  return svgs[`${baseArch}:${mode}`] || svgs[`${baseArch}:body_only`] || svgs["squat:body_only"] || "";
}

const ICON_BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2.2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
};

export const makeVolumeOnIcon = () =>
  svgNode("svg", { ...ICON_BASE, id: "icon-vol-on", width: "18", height: "18" }, [
    svgNode("polygon", { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" }),
    svgNode("path", { d: "M15.54 8.46a5 5 0 0 1 0 7.07" }),
    svgNode("path", { d: "M19.07 4.93a10 10 0 0 1 0 14.14" }),
  ]);

export const makeVolumeOffIcon = () =>
  svgNode("svg", { ...ICON_BASE, id: "icon-vol-off", width: "18", height: "18", style: "display: none;" }, [
    svgNode("polygon", { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" }),
    svgNode("line", { x1: "23", y1: "9", x2: "17", y2: "15" }),
    svgNode("line", { x1: "17", y1: "9", x2: "23", y2: "15" }),
  ]);

export const makeFullscreenIcon = () =>
  svgNode("svg", { ...ICON_BASE, width: "17", height: "17" }, [
    svgNode("path", {
      d: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3",
    }),
  ]);

export function formatLogDateTime(rawIso) {
  if (!rawIso) return "";
  const dt = rawIso instanceof Date ? rawIso : new Date(rawIso);
  if (Number.isNaN(dt.getTime())) return "";
  const mon = SHORT_MONTHS[dt.getMonth()] || "";
  const day = String(dt.getDate()).padStart(2, "0");
  const yr = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${mon} ${day}, ${yr} \u00b7 ${hh}:${mm}`;
}
