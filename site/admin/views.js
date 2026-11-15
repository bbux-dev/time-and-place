import { activitiesByDay, attendance, esc, filterActivities, finishedToday, fmtDateRange, fmtDateTime, fmtDay, fmtTime, localDate, localTime, mapsUrl, tripPeople } from "../domain.js";
import { ACTIVITY_FILTERS, ACTIVITY_TYPES, activityTypeIcons } from "../activity-types.js";

/** @param {import("../models.js").Store} store */
export function homeView(store) {
  const cards = store.trips
    .map((t) => {
      const count = tripPeople(t, store.people).length;
      return `<a class="card trip-link" href="#/trip/${esc(t.id)}">
        <h2>${esc(t.name)}</h2>
        <div class="muted">${esc([t.destination, fmtDateRange(t.startDate, t.endDate), `${count} ${count === 1 ? "person" : "people"}`].filter(Boolean).join(" · "))}</div>
      </a>`;
    })
    .join("");
  return `<div class="top"><div class="logo">Time and Place</div></div>
    ${cards || `<p class="empty">No trips yet. Create one to start adding people, lodging and activities.</p>`}
    <button class="btn primary block" data-action="new-trip">New trip</button>
    <div class="card" style="margin-top:22px">
      <div class="head"><span class="label">Your data</span></div>
      <p class="muted" style="margin:0 0 10px">Export saves every trip, person and share link to a file. Import replaces everything here with a file you exported.</p>
      <div class="row">
        <button class="btn small" data-action="export-data">Export</button>
        <button class="btn small" data-action="import-data">Import</button>
      </div>
      <input type="file" accept="application/json,.json" hidden data-import-file />
    </div>`;
}

/** @param {import("../models.js").Trip} trip @param {string} origin */
function shareCard(trip, origin) {
  if (!trip.shareToken) {
    return `<div class="card">
      <div class="head"><span class="label">Share</span></div>
      <p class="muted" style="margin:0 0 10px">Not shared. A share link lets anyone who has it view this itinerary, without logging in.</p>
      <button class="btn primary block" data-action="create-share">Create share link</button>
    </div>`;
  }
  const url = `${origin}/s/${trip.shareToken}`;
  return `<div class="card">
    <div class="head"><span class="label">Share</span><span class="tag">Link is live</span></div>
    <input class="share-url" readonly value="${esc(url)}" aria-label="Share link" data-share-url />
    <div class="row">
      <button class="btn primary small" data-action="copy-share">Copy link</button>
      <a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">Preview</a>
      <button class="btn small" data-action="new-share">New link</button>
      <button class="btn small danger" data-action="stop-share">Stop sharing</button>
    </div>
  </div>`;
}

/** @param {import("../models.js").Trip} trip @param {import("../models.js").Person[]} people */
function peopleCard(trip, people) {
  const pills = people
    .map(
      (p) => `<button class="pill" data-action="toggle-person" data-id="${esc(p.id)}"
        aria-pressed="${trip.peopleIds.includes(p.id)}">${esc(p.name)}</button>`,
    )
    .join("");
  return `<div class="card">
    <div class="head">
      <span class="label">People · ${tripPeople(trip, people).length} going</span>
      <span class="row">
        ${people.length ? `<button class="btn small" data-action="edit-people">Edit</button>` : ""}
        <button class="btn small" data-action="add-person">+ Person</button>
      </span>
    </div>
    ${
      pills
        ? `<div class="pills">${pills}</div><p class="hint">Tap a name to add or remove them from this trip. People are saved for future trips.</p>`
        : `<p class="muted" style="margin:0">Add the people coming on this trip. They are saved for future trips.</p>`
    }
  </div>`;
}

/** @param {import("../models.js").Trip} trip */
function lodgingCard(trip) {
  const items = trip.lodging
    .map((l) => {
      const facts = [
        ["Check-in", fmtDateTime(l.checkIn)],
        ["Check-out", fmtDateTime(l.checkOut)],
        ["Confirmation", l.confirmation],
      ]
        .filter(([, v]) => v)
        .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`)
        .join("");
      return `<div class="lodge">
        <div class="head"><h3>${esc(l.name)}</h3><button class="btn small" data-action="edit-lodging" data-id="${esc(l.id)}">Edit</button></div>
        ${l.address ? `<a href="${esc(mapsUrl(l.address))}" target="_blank" rel="noopener" class="pre">${esc(l.address)}</a>` : ""}
        ${facts ? `<dl class="facts">${facts}</dl>` : ""}
        ${l.notes ? `<p class="pre muted" style="margin:8px 0 0">${esc(l.notes)}</p>` : ""}
      </div>`;
    })
    .join("");
  return `<div class="card">
    <div class="head"><span class="label">Lodging</span><button class="btn small" data-action="add-lodging">+ Lodging</button></div>
    ${items || `<p class="muted" style="margin:0">Add the Airbnb or hotel: address, check-in and anything people need to get in.</p>`}
  </div>`;
}

/** @param {import("../models.js").Activity} activity @param {import("../models.js").Person[]} members */
function whoLine(activity, members) {
  const { going, notGoing, everyone } = attendance(activity, members);
  if (!going.length) return `<span class="muted">Nobody selected yet</span>`;
  if (everyone) return `Everyone · ${going.length}`;
  /** @param {import("../models.js").SharedPerson[]} list */
  const names = (list) => esc(list.map((p) => p.name).join(", "));
  return going.length <= notGoing.length
    ? `${going.length} of ${members.length} · ${names(going)}`
    : `${going.length} of ${members.length} · <span class="muted">all but ${names(notGoing)}</span>`;
}

/** @param {import("../models.js").Activity} activity @param {import("../models.js").Person[]} members @param {string} [when] */
function activityRow(activity, members, when = "") {
  const details = `
      <div class="name">${esc(activity.title)} ${activityTypeIcons(activity)} ${activity.adultOnly ? `<span class="tag">21+</span>` : ""}</div>
      ${activity.location || activity.mapUrl ? `<div class="muted">${esc(activity.location)}${activity.mapUrl ? ` <span class="tag off">Map link</span>` : ""}</div>` : ""}
      <div class="who">${whoLine(activity, members)}</div>
      ${!activity.date && activity.notes ? `<div class="pre muted activity-notes">${esc(activity.notes)}</div>` : ""}`;
  if (!activity.date) {
    return `<div class="act unscheduled">
      <div class="time">Date TBD<button class="btn small schedule-button" data-action="schedule-activity" data-id="${esc(activity.id)}" aria-label="Schedule ${esc(activity.title)}">Schedule</button></div>
      <button class="activity-details" data-action="edit-activity" data-id="${esc(activity.id)}" aria-label="Edit ${esc(activity.title)}${ACTIVITY_TYPES.filter(({ id }) => activity[id] === true).map(({ label }) => ` (${label})`).join("")}">${details}</button>
    </div>`;
  }
  return `<button class="act${when}" data-action="edit-activity" data-id="${esc(activity.id)}">
    <div class="time">${esc(fmtTime(activity.time) || "Any time")}${activity.endTime ? `<small>to ${esc(fmtTime(activity.endTime))}</small>` : ""}</div>
    <div>${details}</div>
  </button>`;
}

/** @param {import("../models.js").Trip} trip @param {import("../models.js").Store} store @param {import("../models.js").ActivityFilter} activityFilter @param {Date} [now] @param {string} [origin] */
export function tripView(trip, store, activityFilter, now = new Date(), origin = "") {
  const members = tripPeople(trip, store.people);
  const today = localDate(now);
  const done = finishedToday(trip.activities, today, localTime(now));
  const activities = filterActivities(trip.activities, activityFilter);
  const unscheduled = activities.filter((a) => !a.date);
  const category = activityFilter === "dining" ? "dining activities" : activityFilter === "museum" ? "museum visits" : "activities";
  const days = activitiesByDay(activities)
    .map((day) => {
      const when = day.date === today ? " today" : day.date < today ? " past" : "";
      return `<div class="day${when}">${esc(fmtDay(day.date))}${when === " today" ? ` <span class="tag">Today</span>` : ""}</div>${day.items
        .map((a) => activityRow(a, members, when + (done.has(a.id) ? " past" : "")))
        .join("")}`;
    })
    .join("");
  return `<div class="top">
      <a class="back btn" href="#/" aria-label="All trips" style="padding:0;line-height:38px">←</a>
      <div class="title">${esc(trip.name)}</div>
      <button class="btn small" data-action="edit-trip">Edit</button>
    </div>
    <div class="card hero">
      <div class="eyebrow">${esc(trip.destination || "Trip")}</div>
      <h1>${esc(trip.name)}</h1>
      <div class="sub">${esc(fmtDateRange(trip.startDate, trip.endDate))}</div>
    </div>
    ${peopleCard(trip, store.people)}
    ${lodgingCard(trip)}
    <div class="head section-head itinerary-head">
      <span class="label">Itinerary</span>
      <div class="activity-filters" role="group" aria-label="Activity type">
        ${ACTIVITY_FILTERS.map(([value, label]) => `<button class="activity-filter" data-action="filter-activities" data-filter="${value}" aria-pressed="${activityFilter === value}">${label}</button>`).join("")}
      </div>
      <span class="row itinerary-actions"><button class="btn small" data-action="add-from-maps">From Maps</button><button class="btn small primary" data-action="add-activity">+ Activity</button></span>
    </div>
    ${days || `<p class="empty">${activityFilter === "all" ? "No scheduled activities yet. Add an activity or schedule one from below." : `No ${category} scheduled.`}</p>`}
    <section aria-label="Unscheduled activities">
      <div class="head section-head"><span class="label">Unscheduled · ${unscheduled.length}</span><button class="btn small" data-action="add-unscheduled">+ Activity</button></div>
      ${unscheduled.map((a) => activityRow(a, members)).join("") || `<p class="empty">${activityFilter === "all" ? "Have something in mind? Add it here and choose a day later." : `No unscheduled ${category}.`}</p>`}
    </section>
    ${shareCard(trip, origin)}`;
}

