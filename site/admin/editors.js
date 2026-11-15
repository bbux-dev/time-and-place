/**
 * @typedef {{getStore: () => import('../models.js').Store, commit: (store: import('../models.js').Store) => unknown, updateTrip: (id: string, change: (trip: import('../models.js').Trip) => import('../models.js').Trip) => unknown, toast: (message: string) => void, openSheet: import('./forms.js').OpenSheet}} EditorContext
 */
import { deletePerson, enforceAdultOnly, esc, randomId } from "../domain.js";


import { field, timeField } from "./forms.js";
import { closest } from "../dom.js";

/** @param {EditorContext} context */
export function createEditors({ getStore, commit, updateTrip, toast, openSheet }) {
  /** @param {import("../models.js").Trip} [trip] */
  function tripSheet(trip) {
    openSheet({
      title: trip ? "Edit trip" : "New trip",
      submit: trip ? "Save changes" : "Create trip",
      body: `
        ${field("Trip name", `<input name="name" required maxlength="80" value="${esc(trip?.name)}" placeholder="Vegas family trip" />`)}
        ${field("Destination", `<input name="destination" maxlength="80" value="${esc(trip?.destination)}" placeholder="Las Vegas, NV" />`)}
        <div class="two">
          ${field("First day", `<input name="startDate" type="date" required value="${esc(trip?.startDate)}" />`)}
          ${field("Last day", `<input name="endDate" type="date" required value="${esc(trip?.endDate)}" />`)}
        </div>`,
      remove: trip && {
        label: "Delete trip",
        confirm: `Delete "${trip.name}" with its lodging, activities and share link? This cannot be undone.`,
        run() {
          commit({ ...getStore(), trips: getStore().trips.filter((t) => t.id !== trip.id) });
          location.hash = "#/";
        },
      },
      onSubmit(values) {
        if (values.endDate < values.startDate) return "The last day is before the first day.";
        if (trip) { updateTrip(trip.id, (t) => ({ ...t, ...values })); return; }
        const created = { id: randomId(), name: values.name, destination: values.destination, startDate: values.startDate, endDate: values.endDate, peopleIds: [], lodging: [], activities: [], shareToken: null };
        commit({ ...getStore(), trips: [...getStore().trips, created] });
        location.hash = `#/trip/${created.id}`;
      },
    });
  }

  /** @param {import("../models.js").Trip} trip */
  function personSheet(trip) {
    openSheet({
      title: "Add person",
      submit: "Add to trip",
      body: `
        ${field("Name", `<input name="name" required maxlength="40" autocomplete="off" placeholder="Grandma Jo" />`)}
        <label class="check"><input type="checkbox" name="adult" checked /><span>21 or over<small>Uncheck for anyone who can't go to adult-only events.</small></span></label>`,
      onSubmit(values) {
        if (getStore().people.some((p) => p.name.toLowerCase() === values.name.toLowerCase())) {
          return `${values.name} is already saved. Tap their name to add them to this trip.`;
        }
        const person = { id: randomId(), name: values.name, adult: values.adult === "on" };
        commit({
          ...getStore(),
          people: [...getStore().people, person],
          trips: getStore().trips.map((t) =>
            t.id === trip.id ? { ...t, peopleIds: [...t.peopleIds, person.id] } : t,
          ),
        });
        if (trip.activities.length) toast(`${person.name} added. Open an activity to include them.`);
      },
    });
  }

  function peopleSheet() {
    const gone = new Set();
    openSheet({
      title: "Saved people",
      body: `${getStore().people
        .map(
          (p) => `<div class="person-row" data-row="${esc(p.id)}">
            <input type="text" name="name:${esc(p.id)}" required maxlength="40" value="${esc(p.name)}" aria-label="Name" />
            <label class="check"><input type="checkbox" name="adult:${esc(p.id)}" ${p.adult ? "checked" : ""} />21+</label>
            <button type="button" class="x" data-drop="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">✕</button>
          </div>`,
        )
        .join("")}
        <p class="hint">Removing someone takes them off every trip and activity. Unchecking 21+ takes them off adult-only activities.</p>`,
      onReady(form) {
        form.addEventListener("click", (event) => {
          const id = closest(event, "[data-drop]")?.dataset.drop;
          if (!id) return;
          gone.add(id);
          form.querySelector(`[data-row="${CSS.escape(id)}"]`)?.remove();
        });
      },
      onSubmit(values) {
        let next = getStore();
        for (const id of gone) next = deletePerson(next, id);
        next = {
          ...next,
          people: next.people.map((p) => ({
            ...p,
            name: values[`name:${p.id}`] || p.name,
            adult: values[`adult:${p.id}`] === "on",
          })),
        };
        commit(enforceAdultOnly(next));
      },
    });
  }

  /** @param {import("../models.js").Trip} trip @param {import("../models.js").Lodging} [lodging] */
  function lodgingSheet(trip, lodging) {
    const checkIn = (lodging ? lodging.checkIn || "" : `${trip.startDate}T16:00`).split("T");
    const checkOut = (lodging ? lodging.checkOut || "" : `${trip.endDate}T11:00`).split("T");
  /** @param {string} date @param {string} time */
    const stamp = (date, time) => (date && time ? `${date}T${time}` : date);
    openSheet({
      title: lodging ? "Edit lodging" : "Add lodging",
      body: `
        ${field("Name", `<input name="name" required maxlength="80" value="${esc(lodging?.name)}" placeholder="Airbnb – house near the Strip" />`)}
        ${field("Address", `<textarea name="address" rows="2" placeholder="123 Desert Rose Ln, Las Vegas, NV 89101">${esc(lodging?.address)}</textarea>`)}
        <div class="two">
          ${field("Check-in day", `<input name="checkInDate" type="date" value="${esc(checkIn[0])}" />`)}
          ${timeField("checkInTime", "Check-in time", checkIn[1])}
        </div>
        <div class="two">
          ${field("Check-out day", `<input name="checkOutDate" type="date" value="${esc(checkOut[0])}" />`)}
          ${timeField("checkOutTime", "Check-out time", checkOut[1])}
        </div>
        ${field("Confirmation code", `<input name="confirmation" maxlength="60" value="${esc(lodging?.confirmation)}" />`)}
        ${field("Details", `<textarea name="notes" rows="4" placeholder="Door code, Wi-Fi, parking, host phone…">${esc(lodging?.notes)}</textarea>`)}
        <p class="hint">Anyone with the share link can read these details.</p>`,
      remove: lodging && {
        label: "Delete",
        confirm: `Delete "${lodging.name}"?`,
        run: () => updateTrip(trip.id, (t) => ({ ...t, lodging: t.lodging.filter((l) => l.id !== lodging.id) })),
      },
      onSubmit({ name, address, confirmation, notes, ...when }) {
        const saved = {
          id: lodging?.id ?? randomId(),
          name,
          address,
          checkIn: stamp(when.checkInDate, when.checkInTime),
          checkOut: stamp(when.checkOutDate, when.checkOutTime),
          confirmation,
          notes,
        };
        updateTrip(trip.id, (t) => ({
          ...t,
          lodging: lodging ? t.lodging.map((l) => (l.id === lodging.id ? saved : l)) : [...t.lodging, saved],
        }));
      },
    });
  }

  return { tripSheet, personSheet, peopleSheet, lodgingSheet };
}
