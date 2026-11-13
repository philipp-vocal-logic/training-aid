/* Modal overlay controller managing #modal-root with native <dialog>, focus management, and Escape teardown */
import { el } from "./dom.js";
import { createViewScope } from "./scope.js";

let modalScope = null;
let activeDialog = null;
let priorFocus = null;

function disposeModalOnly() {
  if (modalScope) {
    modalScope.dispose();
    modalScope = null;
  }
  if (activeDialog) {
    try {
      if (activeDialog.open !== false && typeof activeDialog.close === "function") {
        activeDialog.close();
      }
    } catch {
      /* ignore if already closed */
    }
    activeDialog = null;
  }
}

export function closeModal() {
  disposeModalOnly();
  const modalRoot = typeof document !== "undefined" && document.getElementById("modal-root");
  if (modalRoot) {
    modalRoot.replaceChildren();
    modalRoot.hidden = true;
  }
  if (priorFocus) {
    const target = priorFocus;
    priorFocus = null;
    if (typeof target.focus === "function") {
      try {
        target.focus();
      } catch {
        /* ignore detached node */
      }
    }
  }
}

export function openModal(buildFn, onEscape) {
  const currentActive = typeof document !== "undefined" ? document.activeElement || null : null;
  if (!modalScope) {
    priorFocus = currentActive;
  }
  disposeModalOnly();
  const modalRoot = typeof document !== "undefined" && document.getElementById("modal-root");
  if (!modalRoot) return;
  modalScope = createViewScope();
  const dialog = el("dialog", { className: "modal-dialog" }, [buildFn(modalScope)]);
  activeDialog = dialog;
  modalRoot.replaceChildren(el("div", { className: "modal-backdrop" }, [dialog]));
  modalRoot.hidden = false;

  if (typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute("open", "");
    }
  } else {
    dialog.setAttribute("open", "");
  }

  const firstControl =
    typeof dialog.querySelector === "function"
      ? dialog.querySelector("button, a, input, select")
      : null;
  if (firstControl && typeof firstControl.focus === "function") {
    firstControl.focus();
  }

  let escapeHandled = false;
  const handleEscape = (e) => {
    if (escapeHandled) return;
    escapeHandled = true;
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (typeof onEscape === "function") onEscape();
    else closeModal();
  };

  modalScope.on(dialog, "cancel", handleEscape);
  if (typeof window !== "undefined") {
    modalScope.on(window, "keydown", (e) => {
      if (e.key === "Escape") handleEscape(e);
    });
  }
}
