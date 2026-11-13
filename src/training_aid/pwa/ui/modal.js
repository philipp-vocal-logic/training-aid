/* Modal overlay controller managing #modal-root with Escape key teardown */
import { el } from "./dom.js";
import { createViewScope } from "./scope.js";

let modalScope = null;

export function closeModal() {
  if (modalScope) {
    modalScope.dispose();
    modalScope = null;
  }
  const modalRoot = typeof document !== "undefined" && document.getElementById("modal-root");
  if (modalRoot) {
    modalRoot.replaceChildren();
    modalRoot.hidden = true;
  }
}

export function openModal(buildFn, onEscape) {
  closeModal();
  const modalRoot = typeof document !== "undefined" && document.getElementById("modal-root");
  if (!modalRoot) return;
  modalScope = createViewScope();
  modalRoot.replaceChildren(el("div", { className: "modal-backdrop" }, [buildFn(modalScope)]));
  modalRoot.hidden = false;
  if (typeof window !== "undefined") {
    modalScope.on(window, "keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (typeof onEscape === "function") onEscape();
        else closeModal();
      }
    });
  }
}
