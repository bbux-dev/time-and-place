/**
 * Find a required element and fail at the boundary with a useful message.
 * @template {Element} T
 * @param {ParentNode} root
 * @param {string} selector
 * @param {{new(...args: never[]): T}} kind
 * @returns {T}
 */
export function element(root, selector, kind) {
  const found = root.querySelector(selector);
  if (!(found instanceof kind)) throw new Error(`Missing required element: ${selector}`);
  return found;
}

/** @param {HTMLFormElement} form @param {string} name */
export function input(form, name) {
  return element(form, `[name="${CSS.escape(name)}"]`, HTMLInputElement);
}

/** @param {Event} event @param {string} selector @returns {HTMLElement|null} */
export function closest(event, selector) {
  const found = event.target instanceof Element ? event.target.closest(selector) : null;
  return found instanceof HTMLElement ? found : null;
}

/** @param {unknown} error @param {string} fallback */
export function errorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}
