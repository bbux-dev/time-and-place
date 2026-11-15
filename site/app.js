// Admin page: build trips, pick who goes to what, and hand out a share link.

import {
  activitiesByDay,
  adultsOnly,
  attendance,
  defaultAttendees,
  deletePerson,
  enforceAdultOnly,
  esc,
  exportData,
  filterActivities,
  finishedToday,
  fmtDateRange,
  fmtDateTime,
  fmtDay,
  fmtTime,
  localDate,
  localTime,
  mapsUrl,
  parseImport,
  randomId,
  removePersonFromTrip,
  tripPeople,
  webLink,
} from "./domain.js";

const screen = document.querySelector("#screen");
const overlay = document.querySelector("#overlay");
const toastEl = document.querySelector("#toast");

let store = null;
let saving = Promise.resolve();
let toastTimer;
let activityFilter = "all";

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

// ---------- data ----------

async function push() {
  let res;
  try {
    res = await fetch("/api/store", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Requested-With": "trip-planner" },
      body: JSON.stringify(store),
    });
  } catch {
    return toast("Not saved — the server is unreachable.");
  }
  if (res.status === 409) {
    store = (await res.json()).store;
    render();
    return toast("Changed elsewhere — reloaded the latest. Redo your last change.");
  }
  if (!res.ok) return toast("Not saved — the server rejected the change.");
  store.rev = (await res.json()).rev;
}

function commit(next) {
  store = { ...next, rev: store.rev };
  render();
  saving = saving.then(push);
}

function currentTrip() {
  const match = location.hash.match(/^#\/trip\/([\w-]+)$/);
  return match ? (store.trips.find((t) => t.id === match[1]) ?? null) : null;
}

function updateTrip(tripId, change) {
  commit({ ...store, trips: store.trips.map((t) => (t.id === tripId ? change(t) : t)) });
}

// ---------- views ----------

function homeView() {
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

function shareCard(trip) {
  if (!trip.shareToken) {
    return `<div class="card">
      <div class="head"><span class="label">Share</span></div>
      <p class="muted" style="margin:0 0 10px">Not shared. A share link lets anyone who has it view this itinerary, without logging in.</p>
      <button class="btn primary block" data-action="create-share">Create share link</button>
    </div>`;
  }
  const url = `${location.origin}/s/${trip.shareToken}`;
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

function peopleCard(trip) {
  const pills = store.people
    .map(
      (p) => `<button class="pill" data-action="toggle-person" data-id="${esc(p.id)}"
        aria-pressed="${trip.peopleIds.includes(p.id)}">${esc(p.name)}</button>`,
    )
    .join("");
  return `<div class="card">
    <div class="head">
      <span class="label">People · ${tripPeople(trip, store.people).length} going</span>
      <span class="row">
        ${store.people.length ? `<button class="btn small" data-action="edit-people">Edit</button>` : ""}
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

function whoLine(activity, members) {
  const { going, notGoing, everyone } = attendance(activity, members);
  if (!going.length) return `<span class="muted">Nobody selected yet</span>`;
  if (everyone) return `Everyone · ${going.length}`;
  const names = (list) => esc(list.map((p) => p.name).join(", "));
  return going.length <= notGoing.length
    ? `${going.length} of ${members.length} · ${names(going)}`
    : `${going.length} of ${members.length} · <span class="muted">all but ${names(notGoing)}</span>`;
}

function activityRow(activity, members, when = "") {
  const details = `
      <div class="name">${esc(activity.title)} ${activity.dining === true ? `<svg class="dining-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Dining"><title>Dining</title><path d="M4 3v5a3 3 0 0 0 6 0V3M7 3v19M20 22V3c-4 0-6 5-6 9h6" /></svg>` : ""} ${activity.adultOnly ? `<span class="tag">21+</span>` : ""}</div>
      ${activity.location || activity.mapUrl ? `<div class="muted">${esc(activity.location)}${activity.mapUrl ? ` <span class="tag off">Map link</span>` : ""}</div>` : ""}
      <div class="who">${whoLine(activity, members)}</div>
      ${!activity.date && activity.notes ? `<div class="pre muted activity-notes">${esc(activity.notes)}</div>` : ""}`;
  if (!activity.date) {
    return `<div class="act unscheduled">
      <div class="time">Date TBD<button class="btn small schedule-button" data-action="schedule-activity" data-id="${esc(activity.id)}" aria-label="Schedule ${esc(activity.title)}">Schedule</button></div>
      <button class="activity-details" data-action="edit-activity" data-id="${esc(activity.id)}" aria-label="Edit ${esc(activity.title)}${activity.dining === true ? " (Dining)" : ""}">${details}</button>
    </div>`;
  }
  return `<button class="act${when}" data-action="edit-activity" data-id="${esc(activity.id)}">
    <div class="time">${esc(fmtTime(activity.time) || "Any time")}${activity.endTime ? `<small>to ${esc(fmtTime(activity.endTime))}</small>` : ""}</div>
    <div>${details}</div>
  </button>`;
}

function tripView(trip) {
  const members = tripPeople(trip, store.people);
  const today = localDate();
  const done = finishedToday(trip.activities, today, localTime());
  const activities = filterActivities(trip.activities, activityFilter);
  const unscheduled = activities.filter((a) => !a.date);
  const category = activityFilter === "dining" ? "dining activities" : "activities";
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
    ${peopleCard(trip)}
    ${lodgingCard(trip)}
    <div class="head section-head itinerary-head">
      <span class="label">Itinerary</span>
      <div class="activity-filters" role="group" aria-label="Activity type">
        ${[["all", "All"], ["activities", "Activities"], ["dining", "Dining"]].map(([value, label]) => `<button class="activity-filter" data-action="filter-activities" data-filter="${value}" aria-pressed="${activityFilter === value}">${label}</button>`).join("")}
      </div>
      <button class="btn small primary" data-action="add-activity">+ Activity</button>
    </div>
    ${days || `<p class="empty">${activityFilter === "all" ? "No scheduled activities yet. Add an activity or schedule one from below." : `No ${category} scheduled.`}</p>`}
    <section aria-label="Unscheduled activities">
      <div class="head section-head"><span class="label">Unscheduled · ${unscheduled.length}</span><button class="btn small" data-action="add-unscheduled">+ Activity</button></div>
      ${unscheduled.map((a) => activityRow(a, members)).join("") || `<p class="empty">${activityFilter === "all" ? "Have something in mind? Add it here and choose a day later." : `No unscheduled ${category}.`}</p>`}
    </section>
    ${shareCard(trip)}`;
}

function render() {
  const trip = currentTrip();
  screen.innerHTML = trip ? tripView(trip) : homeView();
  document.title = trip ? `${trip.name} · Time and Place` : "Time and Place";
}

// ---------- sheets ----------

const field = (label, control) => `<label class="field"><span>${label}</span>${control}</label>`;
const formValues = (form) =>
  Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()]));

// Time picker: two native dropdowns, hour ("7 PM") and minute in quarter hours, starting at :00.
// Phones show their own large list for these. The hidden input holds "HH:MM" or "".
function timeField(name, label, value = "") {
  const [hour = "", minute = "00"] = value ? value.split(":") : [];
  const pad = (n) => String(n).padStart(2, "0");
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

function wireTimePickers(form) {
  form.addEventListener("change", (event) => {
    const root = event.target.closest("[data-time]");
    if (!root) return;
    const hour = root.querySelector("[data-time-h]").value;
    root.querySelector("input").value = hour ? `${hour}:${root.querySelector("[data-time-m]").value}` : "";
  });
}

function openSheet({ title, body, submit = "Save", onSubmit, onReady, remove }) {
  overlay.innerHTML = `<form class="sheet">
    <div class="sheet-head"><h2 id="sheetTitle">${esc(title)}</h2><button type="button" class="x" data-close aria-label="Close">✕</button></div>
    ${body}
    <p class="error" role="alert" hidden></p>
    <div class="actions">
      ${remove ? `<button type="button" class="btn danger" data-remove>${esc(remove.label)}</button>` : ""}
      <button class="btn primary grow">${esc(submit)}</button>
    </div>
  </form>`;
  const form = overlay.firstElementChild;
  const error = form.querySelector(".error");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const problem = onSubmit(formValues(form), form);
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
    } else overlay.close();
  });
  form.querySelector("[data-close]").addEventListener("click", () => overlay.close());
  form.querySelector("[data-remove]")?.addEventListener("click", () => {
    if (confirm(remove.confirm)) {
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
        commit({ ...store, trips: store.trips.filter((t) => t.id !== trip.id) });
        location.hash = "#/";
      },
    },
    onSubmit(values) {
      if (values.endDate < values.startDate) return "The last day is before the first day.";
      if (trip) return updateTrip(trip.id, (t) => ({ ...t, ...values }));
      const created = { id: randomId(), ...values, peopleIds: [], lodging: [], activities: [], shareToken: null };
      commit({ ...store, trips: [...store.trips, created] });
      location.hash = `#/trip/${created.id}`;
    },
  });
}

function personSheet(trip) {
  openSheet({
    title: "Add person",
    submit: "Add to trip",
    body: `
      ${field("Name", `<input name="name" required maxlength="40" autocomplete="off" placeholder="Grandma Jo" />`)}
      <label class="check"><input type="checkbox" name="adult" checked /><span>21 or over<small>Uncheck for anyone who can't go to adult-only events.</small></span></label>`,
    onSubmit(values) {
      if (store.people.some((p) => p.name.toLowerCase() === values.name.toLowerCase())) {
        return `${values.name} is already saved. Tap their name to add them to this trip.`;
      }
      const person = { id: randomId(), name: values.name, adult: values.adult === "on" };
      commit({
        ...store,
        people: [...store.people, person],
        trips: store.trips.map((t) =>
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
    body: `${store.people
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
        const id = event.target.closest("[data-drop]")?.dataset.drop;
        if (!id) return;
        gone.add(id);
        form.querySelector(`[data-row="${CSS.escape(id)}"]`).remove();
      });
    },
    onSubmit(values) {
      let next = store;
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

function lodgingSheet(trip, lodging) {
  const checkIn = (lodging ? lodging.checkIn || "" : `${trip.startDate}T16:00`).split("T");
  const checkOut = (lodging ? lodging.checkOut || "" : `${trip.endDate}T11:00`).split("T");
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

function activitySheet(trip, activity, unscheduled = false) {
  const members = tripPeople(trip, store.people);
  const minors = new Set(members.filter((p) => !p.adult).map((p) => p.id));
  const selected = new Set(activity ? activity.attendeeIds : defaultAttendees(trip, store.people));
  let setAside = []; // under-21 picks to restore if "adults only" is switched back off

  openSheet({
    title: activity ? "Edit activity" : "Add activity",
    body: `
      ${field("Activity", `<input name="title" required maxlength="100" value="${esc(activity?.title)}" placeholder="Michael Jackson ONE – Cirque du Soleil" />`)}
      <label class="check"><input type="checkbox" name="dining" ${activity?.dining === true || (!activity && activityFilter === "dining") ? "checked" : ""} /><span>Dining</span></label>
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
      const dateTbd = form.elements.dateTbd;
      const schedule = form.querySelector("[data-schedule]");
      const syncSchedule = () => {
        schedule.hidden = dateTbd.checked;
        schedule.disabled = dateTbd.checked;
      };
      dateTbd.addEventListener("change", syncSchedule);
      syncSchedule();
      const adultBox = form.elements.adultOnly;
      const allowed = (id) => !adultBox.checked || !minors.has(id);
      const sync = () => {
        for (const pill of form.querySelectorAll("[data-pid]")) {
          pill.setAttribute("aria-pressed", String(selected.has(pill.dataset.pid)));
          pill.disabled = !allowed(pill.dataset.pid);
        }
        form.querySelector("[data-count]").textContent = `Who's going · ${selected.size} of ${members.length}`;
      };
      form.addEventListener("click", (event) => {
        const pill = event.target.closest("[data-pid]");
        const pick = event.target.closest("[data-pick]")?.dataset.pick;
        if (pill && !pill.disabled) {
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
          const kept = adultsOnly([...selected], store.people);
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
      const mapUrl = webLink(values.mapUrl);
      if (values.mapUrl && !mapUrl) return "That map link isn't a web address. Paste the link from your maps app's Share button.";
      const adultOnly = values.adultOnly === "on";
      const ids = members.map((p) => p.id).filter((id) => selected.has(id));
      const saved = {
        id: activity?.id ?? randomId(),
        title: values.title,
        date: values.dateTbd === "on" ? "" : values.date,
        time: values.dateTbd === "on" ? "" : values.time,
        endTime: values.dateTbd === "on" ? "" : values.endTime,
        location: values.location,
        mapUrl,
        notes: values.notes,
        dining: values.dining === "on",
        adultOnly,
        attendeeIds: adultOnly ? adultsOnly(ids, store.people) : ids,
      };
      updateTrip(trip.id, (t) => ({
        ...t,
        activities: activity
          ? t.activities.map((a) => (a.id === activity.id ? saved : a))
          : [...t.activities, saved],
      }));
    },
  });
}

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

// ---------- actions ----------

const setShare = (trip, shareToken) => updateTrip(trip.id, (t) => ({ ...t, shareToken }));

const actions = {
  "filter-activities": (_trip, { filter }) => {
    activityFilter = filter;
    render();
  },
  "new-trip": () => tripSheet(),
  "edit-trip": (trip) => tripSheet(trip),
  "add-person": (trip) => personSheet(trip),
  "edit-people": () => peopleSheet(),
  "toggle-person"(trip, { id }) {
    const person = store.people.find((p) => p.id === id);
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
  "add-unscheduled": (trip) => activitySheet(trip, undefined, true),
  "schedule-activity": (trip, { id }) => scheduleActivitySheet(trip, trip.activities.find((a) => a.id === id)),
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
  "export-data"() {
    const blob = new Blob([JSON.stringify(exportData(store), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `time-and-place-${localDate()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast("Exported");
  },
  "import-data": () => screen.querySelector("[data-import-file]").click(),
  async "copy-share"() {
    const input = screen.querySelector("[data-share-url]");
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
  const el = event.target.closest("[data-action]");
  if (el) actions[el.dataset.action]?.(currentTrip(), el.dataset);
});
screen.addEventListener("change", async (event) => {
  const input = event.target.closest("[data-import-file]");
  const file = input?.files[0];
  if (!file) return;
  input.value = ""; // so picking the same file again still fires
  let incoming;
  try {
    incoming = parseImport(await file.text());
  } catch (err) {
    return toast(err.message);
  }
  const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
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
  const res = await fetch("/api/store");
  if (!res.ok) throw new Error(res.statusText);
  store = await res.json();
  render();
} catch {
  screen.innerHTML = `<p class="empty">Couldn't load your trips. Check that the server is running, then reload.</p>`;
}
