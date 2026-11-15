import { adultsOnly, defaultAttendees, esc, randomId, tripPeople } from "../domain.js";
import { ACTIVITY_TYPES, activityTypeIcon } from "../activity-types.js";

import { field, timeField, showFormError } from "./forms.js";
import { buildActivity } from "./activity.js";
import { wireMapsLookup } from "./maps-lookup.js";
import { element, input, closest, errorMessage } from "../dom.js";

/** @param {Pick<import("./editors.js").EditorContext, "getStore"|"updateTrip"|"openSheet"> & {overlay: HTMLDialogElement, getFilter: () => import("../models.js").ActivityFilter}} context */
export function createActivityEditors({ getStore, updateTrip, openSheet, overlay, getFilter }) {
  /** @param {import("../models.js").Trip} trip @param {import("../models.js").Activity} [activity] @param {boolean} [unscheduled] @param {boolean} [fromMaps] */
  function activitySheet(trip, activity, unscheduled = false, fromMaps = false) {
    const members = tripPeople(trip, getStore().people);
    const minors = new Set(members.filter((p) => !p.adult).map((p) => p.id));
    const selected = new Set(activity ? activity.attendeeIds : defaultAttendees(trip, getStore().people));
  /** @type {string[]} */
    let setAside = []; // under-21 picks to restore if "adults only" is switched back off

    openSheet({
      title: activity ? "Edit activity" : "Add activity",
      body: `
        ${!activity ? `<details class="map-import" ${fromMaps ? "open" : ""}>
          <summary>Fill from Google Maps</summary>
          ${field("Google Maps place link", `<input name="mapsLookup" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="2048" placeholder="https://maps.app.goo.gl/…" />`)}
          <button type="button" class="btn small" data-lookup-map>Fill details</button>
          <p class="hint" role="status" data-lookup-status>Paste a place link to fill the name, address, and activity type.</p>
        </details>` : ""}
        ${field("Activity", `<input name="title" required maxlength="100" value="${esc(activity?.title)}" placeholder="Michael Jackson ONE – Cirque du Soleil" />`)}
        <fieldset class="activity-types">
          <legend class="legend">Activity type</legend>
          <div class="pills">${ACTIVITY_TYPES.map(({ id, label }) => `<label class="pill activity-type-pill">
            <input type="checkbox" name="${id}" ${activity?.[id] === true || (!activity && getFilter() === id) ? "checked" : ""} />
            ${activityTypeIcon(id, true)}<span>${label}</span>
          </label>`).join("")}</div>
        </fieldset>
        <label class="check"><input type="checkbox" name="dateTbd" ${unscheduled || (activity && !activity.date) ? "checked" : ""} /><span>Date TBD<small>Keep this in Unscheduled until you choose a day.</small></span></label>
        <fieldset class="schedule-fields" data-schedule aria-label="Schedule">
          ${field("Date", `<input name="date" type="date" required min="${esc(trip.startDate)}" max="${esc(trip.endDate)}" value="${esc(activity?.date || trip.startDate)}" />`)}
          <div class="two">
            ${timeField("time", "Starts", activity?.time)}
            ${timeField("endTime", "Ends", activity?.endTime)}
          </div>
        </fieldset>
        ${field("Where", `<input name="location" maxlength="120" value="${esc(activity?.location)}" placeholder="Mandalay Bay" />`)}
        ${field("Map link (optional)", `<input name="mapUrl" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="500" value="${esc(activity?.mapUrl)}" placeholder="Paste a Google or Apple Maps link" />`)}
        <label class="check"><input type="checkbox" name="adultOnly" ${activity?.adultOnly ? "checked" : ""} /><span>Adults only (21+)<small>Takes everyone under 21 off this activity.</small></span></label>
        <div class="head" style="margin-bottom:6px">
          <span class="legend" style="margin:0" data-count></span>
          <span class="row"><button type="button" class="btn small" data-pick="all">All</button><button type="button" class="btn small" data-pick="none">None</button></span>
        </div>
        ${
          members.length
            ? `<div class="pills" data-attendees>${members
                .map(
                  (p) =>
                    `<button type="button" class="pill" data-pid="${esc(p.id)}">${esc(p.name)}</button>`,
                )
                .join("")}</div>`
            : `<p class="muted" style="margin:0">Nobody is on this trip yet. Add people first, then choose who is going.</p>`
        }
        <div style="height:12px"></div>
        ${field("Notes", `<textarea name="notes" rows="3" placeholder="Weather dependent, prefer morning, tickets, where to meet…">${esc(activity?.notes)}</textarea>`)}`,
      remove: activity && {
        label: "Delete",
        confirm: `Delete "${activity.title}"?`,
        run: () =>
          updateTrip(trip.id, (t) => ({ ...t, activities: t.activities.filter((a) => a.id !== activity.id) })),
      },
      onReady(form) {
        wireMapsLookup(form, { overlay, fromMaps, showFormError });
        const dateTbd = input(form, "dateTbd");
        const schedule = element(form, "[data-schedule]", HTMLFieldSetElement);
        const syncSchedule = () => {
          schedule.hidden = dateTbd.checked;
          schedule.disabled = dateTbd.checked;
        };
        dateTbd.addEventListener("change", syncSchedule);
        syncSchedule();
        const adultBox = input(form, "adultOnly");
  /** @param {string} id */
        const allowed = (id) => !adultBox.checked || !minors.has(id);
        const sync = () => {
          for (const pill of /** @type {NodeListOf<HTMLButtonElement>} */ (form.querySelectorAll("[data-pid]"))) {
            const id = pill.dataset.pid;
            if (!id) continue;
            pill.setAttribute("aria-pressed", String(selected.has(id)));
            pill.disabled = !allowed(id);
          }
          element(form, "[data-count]", HTMLElement).textContent = `Who's going · ${selected.size} of ${members.length}`;
        };
        form.addEventListener("click", (event) => {
          const pill = closest(event, "button[data-pid]");
          const pick = closest(event, "[data-pick]")?.dataset.pick;
          if (pill instanceof HTMLButtonElement && pill.dataset.pid && !pill.disabled) {
            const id = pill.dataset.pid;
            selected.has(id) ? selected.delete(id) : selected.add(id);
          } else if (pick) {
            selected.clear();
            if (pick === "all") members.filter((p) => allowed(p.id)).forEach((p) => selected.add(p.id));
            setAside = [];
          } else return;
          sync();
        });
        adultBox.addEventListener("change", () => {
          if (adultBox.checked) {
            setAside = [...selected].filter((id) => minors.has(id));
            const kept = adultsOnly([...selected], getStore().people);
            selected.clear();
            kept.forEach((id) => selected.add(id));
          } else {
            setAside.forEach((id) => selected.add(id));
            setAside = [];
          }
          sync();
        });
        sync();
      },
      onSubmit(values) {
        let saved;
        try {
          saved = buildActivity(values, {
            id: activity?.id ?? randomId(),
            attendeeIds: members.map((p) => p.id).filter((id) => selected.has(id)),
            people: getStore().people,
          });
        } catch (error) {
          return errorMessage(error, "Couldn't save the activity.");
        }
        updateTrip(trip.id, (t) => ({
          ...t,
          activities: activity
            ? t.activities.map((a) => (a.id === activity.id ? saved : a))
            : [...t.activities, saved],
        }));
      },
    });
  }

  /** @param {import("../models.js").Trip} trip @param {import("../models.js").Activity} activity */
  function scheduleActivitySheet(trip, activity) {
    openSheet({
      title: "Schedule activity",
      submit: "Schedule",
      body: `
        <p class="schedule-title pre">${esc(activity.title)}</p>
        ${field("Date", `<input name="date" type="date" required min="${esc(trip.startDate)}" max="${esc(trip.endDate)}" value="${esc(trip.startDate)}" />`)}
        <div class="two">
          ${timeField("time", "Starts")}
          ${timeField("endTime", "Ends")}
        </div>
        <p class="hint">Leave times blank for any time that day. You can move it back to Unscheduled by editing it and choosing Date TBD.</p>`,
      onSubmit(values) {
        updateTrip(trip.id, (t) => ({
          ...t,
          activities: t.activities.map((a) => a.id === activity.id
            ? { ...a, date: values.date, time: values.time, endTime: values.endTime }
            : a),
        }));
      },
    });
  }

  return { activitySheet, scheduleActivitySheet };
}
