/**
 * @typedef {{title: string, body: string, submit?: string, onSubmit: (values: Record<string,string>, form: HTMLFormElement) => string|void, onReady?: (form: HTMLFormElement) => void, remove?: {label: string, confirm: string, run: () => unknown}}} SheetOptions
 * @typedef {(options: SheetOptions) => void} OpenSheet
 */
import { esc } from "../domain.js";
import { element, closest } from "../dom.js";

/** @param {string} label @param {string} control */
export const field = (label, control) => `<label class="field"><span>${label}</span>${control}</label>`;
/** @param {HTMLFormElement} form @returns {Record<string, string>} */
export const formValues = (form) =>
  Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()]));

// Time picker: two native dropdowns, hour ("7 PM") and minute in quarter hours, starting at :00.
// Phones show their own large list for these. The hidden input holds "HH:MM" or "".
/** @param {string} name @param {string} label @param {string} [value] */
export function timeField(name, label, value = "") {
  const [hour = "", minute = "00"] = value ? value.split(":") : [];
  /** @param {number} n */
  const pad = (n) => String(n).padStart(2, "0");
  /** @param {string} v @param {string} text @param {string} current */
  const option = (v, text, current) => `<option value="${v}"${v === current ? " selected" : ""}>${text}</option>`;
  const hours = Array.from({ length: 24 }, (_, h) => option(pad(h), `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`, hour));
  // Quarter hours, plus the saved minute if it is an odd one, so editing never changes it silently.
  const minutes = [...new Set(["00", "15", "30", "45", minute])].sort().map((m) => option(m, `:${m}`, minute));
  return `<div class="field" data-time>
    <span>${esc(label)}</span>
    <input type="hidden" name="${name}" value="${esc(value)}" />
    <div class="time-row">
      <select data-time-h aria-label="${esc(label)}, hour">${option("", "–", hour)}${hours.join("")}</select>
      <select data-time-m aria-label="${esc(label)}, minute">${minutes.join("")}</select>
    </div>
  </div>`;
}

/** @param {HTMLFormElement} form */
function wireTimePickers(form) {
  form.addEventListener("change", (event) => {
    const root = closest(event, "[data-time]");
    if (!root) return;
    const hour = element(root, "[data-time-h]", HTMLSelectElement).value;
    element(root, "input", HTMLInputElement).value = hour ? `${hour}:${element(root, "[data-time-m]", HTMLSelectElement).value}` : "";
  });
}

/** @param {HTMLFormElement} form @param {string} message */
export function showFormError(form, message) {
  const error = element(form, ".error", HTMLElement);
  error.textContent = message;
  error.hidden = false;
  error.scrollIntoView({ block: "nearest" });
}

/** @param {HTMLDialogElement} overlay */
export function createSheets(overlay) {
  /** @param {SheetOptions} options */
  function openSheet({ title, body, submit = "Save", onSubmit, onReady, remove }) {
    overlay.innerHTML = `<form class="sheet">
      <div class="sheet-head"><h2 id="sheetTitle">${esc(title)}</h2><button type="button" class="x" data-close aria-label="Close">✕</button></div>
      <p class="error error-banner" role="alert" hidden></p>
      ${body}
      <div class="actions">
        ${remove ? `<button type="button" class="btn danger" data-remove>${esc(remove.label)}</button>` : ""}
        <button class="btn primary grow">${esc(submit)}</button>
      </div>
    </form>`;
    const form = element(overlay, "form", HTMLFormElement);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const problem = onSubmit(formValues(form), form);
      if (problem) {
        showFormError(form, problem);
      } else overlay.close();
    });
    element(form, "[data-close]", HTMLButtonElement).addEventListener("click", () => overlay.close());
    form.querySelector("[data-remove]")?.addEventListener("click", () => {
      if (remove && confirm(remove.confirm)) {
        remove.run();
        overlay.close();
      }
    });
    wireTimePickers(form);
    onReady?.(form);
    overlay.showModal();
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.close();
  });

  return { openSheet };
}
