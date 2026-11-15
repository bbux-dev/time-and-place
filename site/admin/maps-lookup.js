import { webLink } from "../domain.js";
import { ACTIVITY_TYPES } from "../activity-types.js";
import { element, input, errorMessage } from "../dom.js";

/** @param {HTMLFormElement} form @param {{overlay: HTMLDialogElement, fromMaps: boolean, showFormError: (form: HTMLFormElement, message: string) => void}} options */
export function wireMapsLookup(form, { overlay, fromMaps, showFormError }) {
  const lookupButton = form.querySelector("button[data-lookup-map]");
  if (!(lookupButton instanceof HTMLButtonElement)) return;
  lookupButton.addEventListener("click", async () => {
    const status = element(form, "[data-lookup-status]", HTMLElement);
    const linkInput = input(form, "mapsLookup");
    const submitted = linkInput.value.trim();
    const url = webLink(submitted);
    element(form, ".error", HTMLElement).hidden = true;
    if (!url) {
      status.textContent = "";
      showFormError(form, "Paste a Google Maps place link first.");
      linkInput.focus();
      return;
    }
    lookupButton.disabled = true;
    status.textContent = "Looking up place…";
    try {
      const res = await fetch("/api/maps-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "trip-planner" },
        body: JSON.stringify({ url }),
      });
      if (res.status === 401) throw new Error("Your admin login expired. Reload the page and sign in again.");
      /** @type {Partial<import("../models.js").MapsPlace> & {error?: string}} */
      let place;
      try { place = await res.json(); }
      catch { throw new Error("The Maps lookup didn't return details. Try again or fill in the activity manually."); }
      if (!res.ok) throw new Error(place.error || "Couldn't load that place. You can enter the details manually.");
      if (typeof place.title !== "string" || typeof place.location !== "string" || typeof place.mapUrl !== "string") throw new Error("The Maps lookup returned incomplete details.");
      if (!overlay.open || overlay.firstElementChild !== form) return;
      if (linkInput.value.trim() !== submitted) {
        status.textContent = "The link changed. Press Fill details to look up the new place.";
        return;
      }
      input(form, "title").value = place.title;
      input(form, "location").value = place.location;
      input(form, "mapUrl").value = place.mapUrl;
      for (const { id } of ACTIVITY_TYPES) {
        if (typeof place[id] === "boolean") input(form, id).checked = place[id];
      }
      status.textContent = place.category
        ? `Found ${place.category}. Review the details and activity type, then save.`
        : "Place name filled from Maps.";
    } catch (error) {
      status.textContent = "";
      if (overlay.open && overlay.firstElementChild === form) {
        showFormError(form, error instanceof TypeError
          ? "Couldn't reach the Maps lookup. Check your connection and try again."
          : errorMessage(error, "Couldn't reach Google Maps. Enter the activity details manually."));
      }
    } finally {
      lookupButton.disabled = false;
    }
  });
  if (fromMaps) input(form, "mapsLookup").focus();
}
