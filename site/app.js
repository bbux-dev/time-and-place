// Admin entry point: compose state, views, and editors, then dispatch user actions.
import { emptyStore, exportData, localDate, parseImport, randomId, removePersonFromTrip } from "./domain.js";
import { createStoreClient } from "./admin/store.js";
import { homeView, tripView } from "./admin/views.js";
import { createSheets } from "./admin/forms.js";
import { createEditors } from "./admin/editors.js";
import { createActivityEditors } from "./admin/activity-editor.js";
import { element, closest, errorMessage } from "./dom.js";

const screen = element(document, "#screen", HTMLElement);
const overlay = element(document, "#overlay", HTMLDialogElement);
const toastEl = element(document, "#toast", HTMLElement);
const adminError = element(document, "#admin-error", HTMLElement);
let store = emptyStore();
/** @type {ReturnType<typeof setTimeout>|undefined} */
let toastTimer;
/** @type {import("./models.js").ActivityFilter} */
let activityFilter = "all";

/** @param {string} message */
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

/** @param {string} message @param {boolean} [retry] */
function showAdminError(message, retry = false) {
  element(adminError, "[data-error-message]", HTMLElement).textContent = message;
  element(adminError, "[data-retry-save]", HTMLButtonElement).hidden = !retry;
  adminError.hidden = false;
}
const client = createStoreClient({
  onChange(next) { store = next; render(); },
  onError: showAdminError,
  onSaved() { store = client.getState(); adminError.hidden = true; },
});
const commit = client.commit;
const { openSheet } = createSheets(overlay);
const { tripSheet, personSheet, peopleSheet, lodgingSheet } = createEditors({ getStore: () => store, commit, updateTrip, toast, openSheet });
const { activitySheet, scheduleActivitySheet } = createActivityEditors({ getStore: () => store, updateTrip, openSheet, overlay, getFilter: () => activityFilter });

element(adminError, "[data-dismiss-error]", HTMLButtonElement).addEventListener("click", () => { adminError.hidden = true; });
const retryButton = element(adminError, "[data-retry-save]", HTMLButtonElement);
retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  try { await client.retry(); } finally { retryButton.disabled = false; }
});

function currentTrip() {
  const match = location.hash.match(/^#\/trip\/([\w-]+)$/);
  return match ? (store.trips.find((t) => t.id === match[1]) ?? null) : null;
}
/** @param {string} tripId @param {(trip: import("./models.js").Trip) => import("./models.js").Trip} change */
function updateTrip(tripId, change) {
  return commit({ ...store, trips: store.trips.map((t) => t.id === tripId ? change(t) : t) });
}
function render() {
  const trip = currentTrip();
  screen.innerHTML = trip ? tripView(trip, store, activityFilter, new Date(), location.origin) : homeView(store);
  document.title = trip ? `${trip.name} · Time and Place` : "Time and Place";
}

/** @param {import("./models.js").Trip} trip @param {string|null} shareToken */
const setShare = (trip, shareToken) => updateTrip(trip.id, (t) => ({ ...t, shareToken }));

/** @type {Record<string, (trip: import("./models.js").Trip, data: DOMStringMap) => unknown>} */
const actions = {
  "filter-activities": (_trip, { filter }) => {
    if (filter === "all" || filter === "activities" || filter === "dining" || filter === "museum") activityFilter = filter;
    render();
  },
  "edit-trip": (trip) => tripSheet(trip),
  "add-person": (trip) => personSheet(trip),
  "toggle-person"(trip, { id }) {
    if (!id) return;
    const person = store.people.find((p) => p.id === id);
    if (!person) return;
    if (!trip.peopleIds.includes(id)) {
      updateTrip(trip.id, (t) => ({ ...t, peopleIds: [...t.peopleIds, id] }));
      if (trip.activities.length) toast(`${person.name} added. Open an activity to include them.`);
      return;
    }
    const booked = trip.activities.filter((a) => a.attendeeIds.includes(id)).length;
    if (booked && !confirm(`Take ${person.name} off this trip and ${booked} ${booked === 1 ? "activity" : "activities"}?`)) return;
    updateTrip(trip.id, (t) => removePersonFromTrip(t, id));
  },
  "add-lodging": (trip) => lodgingSheet(trip),
  "edit-lodging": (trip, { id }) => lodgingSheet(trip, trip.lodging.find((l) => l.id === id)),
  "add-activity": (trip) => activitySheet(trip),
  "add-from-maps": (trip) => activitySheet(trip, undefined, true, true),
  "add-unscheduled": (trip) => activitySheet(trip, undefined, true),
  "schedule-activity": (trip, { id }) => { const activity = trip.activities.find((a) => a.id === id); if (activity) scheduleActivitySheet(trip, activity); },
  "edit-activity": (trip, { id }) => activitySheet(trip, trip.activities.find((a) => a.id === id)),
  "create-share": (trip) => setShare(trip, randomId(16)),
  "new-share"(trip) {
    if (confirm("Make a new link? The current link will stop working for everyone who has it.")) {
      setShare(trip, randomId(16));
    }
  },
  "stop-share"(trip) {
    if (confirm("Stop sharing? The current link will stop working.")) setShare(trip, null);
  },
};
/** @type {Record<string, () => unknown>} */
const globalActions = {
  "new-trip": () => tripSheet(),
  "edit-people": () => peopleSheet(),
  "export-data"() {
    const blob = new Blob([JSON.stringify(exportData(store), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `time-and-place-${localDate()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast("Exported");
  },
  "import-data": () => element(screen, "[data-import-file]", HTMLInputElement).click(),
  async "copy-share"() {
    const input = element(screen, "[data-share-url]", HTMLInputElement);
    try {
      await navigator.clipboard.writeText(input.value);
      toast("Link copied");
    } catch {
      input.select();
      toast("Press Ctrl+C to copy");
    }
  },
};

screen.addEventListener("click", (event) => {
  const el = closest(event, "[data-action]");
  if (!el?.dataset.action) return;
  const action = el.dataset.action;
  if (globalActions[action]) globalActions[action]();
  else { const trip = currentTrip(); if (trip) actions[action]?.(trip, el.dataset); }
});
screen.addEventListener("change", async (event) => {
  const input = closest(event, "[data-import-file]");
  const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
  if (!(input instanceof HTMLInputElement) || !file) return;
  input.value = ""; // so picking the same file again still fires
  let incoming;
  try {
    incoming = parseImport(await file.text());
  } catch (err) {
    return toast(errorMessage(err, "Could not import this file."));
  }
  /** @param {number} n @param {string} word */
  const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  /** @param {import("./models.js").ExportedData} d */
  const summary = (d) => `${count(d.trips.length, "trip")} and ${count(d.people.length, "person").replace("persons", "people")}`;
  const ok = confirm(
    `Replace everything here (${summary(store)}) with the file's ${summary(incoming)}?\n\nThis cannot be undone. Export first if you want a copy of what is here now.`,
  );
  if (!ok) return;
  commit({ ...store, ...incoming });
  toast("Imported");
});
window.addEventListener("hashchange", () => {
  activityFilter = "all";
  render();
  screen.scrollTop = 0;
});

try {
  await client.load();
} catch {
  showAdminError("Couldn't load your trips. Check your connection and reload the page.");
  screen.innerHTML = "";
}
