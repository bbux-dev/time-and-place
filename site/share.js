// Shared, read-only itinerary. Anyone with the link sees this page; no login.

import {
  activitiesByDay,
  attendance,
  esc,
  filterActivities,
  finishedToday,
  fmtDateRange,
  fmtDateTime,
  fmtDay,
  fmtTime,
  liveStatus,
  localDate,
  localTime,
  mapsUrl,
  webLink,
} from "./domain.js";

const screen = document.querySelector("#screen");
const isSample = /^\/sample\/?$/.test(location.pathname);
const token = isSample ? "sample" : location.pathname.split("/").pop();
const ME_KEY = `trip-planner:me:${token}`;

// Installable per trip, and readable without signal once it has loaded.
if (!isSample) {
  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = `/s/${encodeURIComponent(token)}/manifest.webmanifest`;
  document.head.append(manifest);
  navigator.serviceWorker?.register("/share-sw.js", { scope: "/s/" }).catch(() => {});
}

let data = null;
let me = null; // person id, or null for "everyone"
let offline = false;
let activityFilter = "all";

function remember(id) {
  try {
    id ? localStorage.setItem(ME_KEY, id) : localStorage.removeItem(ME_KEY);
  } catch {
    /* private mode: the choice just lasts for this visit */
  }
}

function lodgingCard(lodging) {
  if (!lodging.length) return "";
  const items = lodging
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
        <div class="head"><h3>${esc(l.name)}</h3></div>
        ${l.address ? `<a href="${esc(mapsUrl(l.address))}" target="_blank" rel="noopener" class="pre">${esc(l.address)}</a>` : ""}
        ${facts ? `<dl class="facts">${facts}</dl>` : ""}
        ${l.notes ? `<p class="pre" style="margin:8px 0 0;font-size:14px">${esc(l.notes)}</p>` : ""}
      </div>`;
    })
    .join("");
  return `<div class="card"><div class="head"><span class="label">Where we're staying</span></div>${items}</div>`;
}

const LIVE = { now: "Now", next: "Up next" };

function activityRow(activity, when, live) {
  const { going, notGoing, everyone } = attendance(activity, data.people);
  const mine = !me || activity.attendeeIds.includes(me);
  const names = (list) => esc(list.map((p) => p.name).join(", "));
  let who = `<span class="muted">Nobody yet</span>`;
  if (everyone) who = "Everyone";
  else if (going.length) {
    who =
      going.length <= notGoing.length
        ? names(going)
        : `Everyone <span class="muted">except ${names(notGoing)}</span>`;
  }
  const map = webLink(activity.mapUrl);
  // With a map link, the place name is the link. With no place name, the address itself is shown.
  const place = map
    ? `<a href="${esc(map)}" target="_blank" rel="noopener noreferrer" style="overflow-wrap:anywhere">${esc(activity.location || map.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>`
    : esc(activity.location);
  return `<div class="act${mine ? "" : " dim"}${when}">
    <div class="time">${activity.date ? `${esc(fmtTime(activity.time) || "Any time")}${activity.endTime ? `<small>to ${esc(fmtTime(activity.endTime))}</small>` : ""}` : "Date TBD"}</div>
    <div>
      <div class="name">${esc(activity.title)}
        ${activity.dining === true ? `<svg class="dining-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Dining"><title>Dining</title><path d="M4 3v5a3 3 0 0 0 6 0V3M7 3v19M20 22V3c-4 0-6 5-6 9h6" /></svg>` : ""}
        ${live ? `<span class="tag solid">${LIVE[live]}</span>` : ""}
        ${activity.adultOnly ? `<span class="tag">21+</span>` : ""}
        ${mine ? "" : `<span class="tag off">Not you</span>`}</div>
      ${place ? `<div class="muted">${place}</div>` : ""}
      <div class="who">${who}</div>
      ${activity.notes ? `<div class="pre muted" style="margin-top:4px">${esc(activity.notes)}</div>` : ""}
    </div>
  </div>`;
}

function render() {
  const { trip, people } = data;
  const today = localDate();
  const live = isSample ? new Map() : liveStatus(trip.activities, today, localTime(), me);
  const done = isSample ? new Set() : finishedToday(trip.activities, today, localTime());
  const activities = filterActivities(trip.activities, activityFilter);
  const unscheduled = activities.filter((a) => !a.date);
  const mineCount = me ? activities.filter((a) => a.attendeeIds.includes(me)).length : 0;
  const category = activityFilter === "dining" ? "dining activities" : "activities";
  const days = activitiesByDay(activities)
    .map((day) => {
      // Keep the fictional itinerary readable even after its sample dates have passed.
      const when = isSample ? "" : day.date === today ? " today" : day.date < today ? " past" : "";
      return `<div class="day${when}">${esc(fmtDay(day.date))}${when === " today" ? ` <span class="tag">Today</span>` : ""}</div>${day.items
        .map((a) => activityRow(a, when + (done.has(a.id) ? " past" : ""), live.get(a.id)))
        .join("")}`;
    })
    .join("");
  const pills = people.length
    ? `<div class="card">
        <div class="head"><span class="label">Who are you?</span></div>
        <div class="pills">
          <button class="pill" data-me="" aria-pressed="${!me}">Everyone</button>
          ${people.map((p) => `<button class="pill" data-me="${esc(p.id)}" aria-pressed="${me === p.id}">${esc(p.name)}</button>`).join("")}
        </div>
        <p class="hint">${
          me
            ? `You're in ${mineCount} of ${activities.length} ${activities.length === 1 ? "activity" : "activities"}. The rest are faded.`
            : "Pick your name to highlight what you're going to."
        }</p>
      </div>`
    : "";
  screen.innerHTML = `
    ${isSample ? `<div class="sample-banner"><strong>Time and Place</strong><span>Fictional sample itinerary</span></div>` : ""}
    ${offline ? `<p class="hint" style="margin:0 2px 10px">You're offline. This is the last copy that loaded.</p>` : ""}
    <div class="card hero">
      <div class="eyebrow">${esc(trip.destination || "Trip")}</div>
      <h1>${esc(trip.name)}</h1>
      <div class="sub">${esc(fmtDateRange(trip.startDate, trip.endDate))}${people.length ? ` · ${people.length} going` : ""}</div>
    </div>
    ${lodgingCard(trip.lodging)}
    ${pills}
    <div class="head section-head itinerary-head">
      <span class="label">Itinerary</span>
      <div class="activity-filters" role="group" aria-label="Activity type">
        ${[["all", "All"], ["activities", "Activities"], ["dining", "Dining"]].map(([value, label]) => `<button class="activity-filter" data-activity-filter="${value}" aria-pressed="${activityFilter === value}">${label}</button>`).join("")}
      </div>
    </div>
    ${days || `<p class="empty">${activityFilter === "all" ? "No scheduled activities yet. Check back soon." : `No ${category} scheduled.`}</p>`}
    ${unscheduled.length ? `<section aria-label="Unscheduled activities">
      <div class="head section-head"><span class="label">Unscheduled · ${unscheduled.length}</span></div>
      ${unscheduled.map((a) => activityRow(a, " unscheduled")).join("")}
    </section>` : ""}`;
  document.title = `${trip.name} · Time and Place`;
}

screen.addEventListener("click", (event) => {
  const filter = event.target.closest("[data-activity-filter]");
  if (filter) {
    activityFilter = filter.dataset.activityFilter;
    render();
    return;
  }
  const pill = event.target.closest("[data-me]");
  if (!pill) return;
  me = pill.dataset.me || null;
  remember(me);
  render();
});

try {
  const res = await fetch(isSample ? "/sample.json" : `/api/shared/${encodeURIComponent(token)}`);
  if (res.status === 404) {
    screen.innerHTML = `<p class="empty">This link is no longer active. Ask the trip organizer for a new one.</p>`;
  } else {
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
    offline = !navigator.onLine;
    try {
      const saved = localStorage.getItem(ME_KEY);
      if (data.people.some((p) => p.id === saved)) me = saved;
    } catch {
      /* no saved choice */
    }
    render();
    // Returning visitors land on today. First-time visitors start at the top to pick their name.
    if (me) screen.querySelector(".day.today")?.scrollIntoView({ block: "start" });
    // Keep "Today", "Now" and "Up next" honest while the page stays open.
    setInterval(render, 60_000);
    document.addEventListener("visibilitychange", () => document.hidden || render());
  }
} catch {
  screen.innerHTML = `<p class="empty">Couldn't load the itinerary. Check your connection and reload.</p>`;
}
