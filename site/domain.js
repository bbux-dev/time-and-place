import { isValidStore } from "./validation.js";
export { isValidStore };

// Pure trip rules and formatting, shared by the admin page, the shared page, and the server.

export const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

/** @returns {import("./models.js").Store} */
export function emptyStore() {
  return { rev: 0, people: [], trips: [] };
}

/** URL-safe random string. 16 bytes gives a 22-character share token. */
export function randomId(bytes = 9) {
  const buf = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** @param {unknown} v @returns {v is string} */
const isStr = (v) => typeof v === "string";

/** Everything worth keeping, as a file: people, trips, and their share links. */
/** @param {import("./models.js").Store} store @param {Date} [now] */
export function exportData(store, now = new Date()) {
  return { app: "trip-planner", exportedAt: now.toISOString(), people: store.people, trips: store.trips };
}

/** Reads an export file's text. Returns { people, trips } or throws an Error worth showing. */
/** @param {string} text @returns {import("./models.js").ExportedData} */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Time and Place export (it isn't valid JSON).");
  }
  const candidate = { rev: 0, people: data?.people, trips: data?.trips };
  if (!isValidStore(candidate)) {
    throw new Error("That file isn't a Time and Place export, or it has been damaged. Nothing was changed.");
  }
  return { people: candidate.people, trips: candidate.trips };
}

/** @param {import("./models.js").Trip} trip @param {import("./models.js").Person[]} people */
export function tripPeople(trip, people) {
  return people.filter((p) => trip.peopleIds.includes(p.id));
}

/** Everyone on the trip, or only the 21+ people for an adult-only activity. */
/** @param {import("./models.js").Trip} trip @param {import("./models.js").Person[]} people @param {boolean} [adultOnly] */
export function defaultAttendees(trip, people, adultOnly = false) {
  return tripPeople(trip, people)
    .filter((p) => !adultOnly || p.adult)
    .map((p) => p.id);
}

/** @param {string[]} ids @param {import("./models.js").Person[]} people */
export function adultsOnly(ids, people) {
  const adults = new Set(people.filter((p) => p.adult).map((p) => p.id));
  return ids.filter((id) => adults.has(id));
}

/** @param {import("./models.js").Trip} trip @param {string} personId */
export function removePersonFromTrip(trip, personId) {
  return {
    ...trip,
    peopleIds: trip.peopleIds.filter((id) => id !== personId),
    activities: trip.activities.map((a) => ({
      ...a,
      attendeeIds: a.attendeeIds.filter((id) => id !== personId),
    })),
  };
}

/** @param {import("./models.js").Store} store @param {string} personId */
export function deletePerson(store, personId) {
  return {
    ...store,
    people: store.people.filter((p) => p.id !== personId),
    trips: store.trips.map((t) => removePersonFromTrip(t, personId)),
  };
}

/** Drops under-21 people from adult-only activities (after someone's 21+ flag changes). */
/** @param {import("./models.js").Store} store */
export function enforceAdultOnly(store) {
  return {
    ...store,
    trips: store.trips.map((t) => ({
      ...t,
      activities: t.activities.map((a) =>
        a.adultOnly ? { ...a, attendeeIds: adultsOnly(a.attendeeIds, store.people) } : a,
      ),
    })),
  };
}

/** Dated itinerary only. An empty date means the activity is still unscheduled. */
/** @param {import("./models.js").Activity[]} activities */
export function activitiesByDay(activities) {
  const sorted = activities.filter((a) => a.date).sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time || "").localeCompare(b.time || "") ||
      a.title.localeCompare(b.title),
  );
  /** @type {{date: string, items: import("./models.js").Activity[]}[]} */
  const days = [];
  for (const activity of sorted) {
    const last = days.at(-1);
    if (last && last.date === activity.date) last.items.push(activity);
    else days.push({ date: activity.date, items: [activity] });
  }
  return days;
}

/** Older activities without type flags are ordinary activities. */
/** @param {import("./models.js").Activity[]} activities @param {import("./models.js").ActivityFilter} [filter] */
export function filterActivities(activities, filter = "all") {
  return activities.filter((a) => {
    if (filter === "dining") return a.dining === true;
    if (filter === "museum") return a.museum === true;
    if (filter === "activities") return a.dining !== true && a.museum !== true;
    return true;
  });
}

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, "0");

/** Today's date on this device, as "YYYY-MM-DD". On the trip, phones are on trip time. */
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** The time on this device, as "HH:MM". */
export function localTime(now = new Date()) {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

/**
 * Which of today's activities are happening "now" or are "next", as a Map of id -> label.
 * With `me` set, only that person's activities count. Untimed activities are never labelled.
 */
/** @param {import("./models.js").Activity[]} activities @param {string} today @param {string} time @param {string|null} [me] @returns {Map<string, "now"|"next">} */
export function liveStatus(activities, today, time, me = null) {
  const status = new Map();
  const mine = activities.filter((a) => a.date === today && (!me || a.attendeeIds.includes(me)));
  let foundNext = false;
  for (const activity of activitiesByDay(mine).flatMap((day) => day.items)) {
    if (!activity.time) continue;
    if (activity.time > time) {
      if (!foundNext) status.set(activity.id, "next");
      foundNext = true;
    } else if (activity.endTime && (activity.endTime >= time || activity.endTime < activity.time)) {
      // Started, and it ends later today or runs past midnight.
      status.set(activity.id, "now");
    }
  }
  return status;
}

/**
 * Ids of today's activities that are over. With an end time: once it has passed (one that
 * runs past midnight is never over today). Without one: once a later activity has started.
 * Untimed activities are never over.
 */
/** @param {import("./models.js").Activity[]} activities @param {string} today @param {string} time */
export function finishedToday(activities, today, time) {
  const timed = activities.filter((a) => a.date === today && a.time);
  const done = new Set();
  for (const activity of timed) {
    const starts = activity.time;
    if (!starts) continue;
    if (starts > time) continue;
    const over = activity.endTime
      ? activity.endTime >= starts && activity.endTime < time
      : timed.some((other) => other.time && other.time > starts && other.time <= time);
    if (over) done.add(activity.id);
  }
  return done;
}

/** Who is and is not going, in trip order. */
/** @param {import("./models.js").Activity} activity @param {import("./models.js").SharedPerson[]} members */
export function attendance(activity, members) {
  const going = members.filter((p) => activity.attendeeIds.includes(p.id));
  const notGoing = members.filter((p) => !activity.attendeeIds.includes(p.id));
  return { going, notGoing, everyone: members.length > 0 && notGoing.length === 0 };
}

/** What a share link exposes: one trip and the names of the people on it. Nothing else. */
/** @param {import("./models.js").Store} store @param {unknown} token @returns {import("./models.js").SharedView|null} */
export function sharedView(store, token) {
  if (!isStr(token) || !TOKEN_RE.test(token)) return null;
  const trip = store.trips.find((t) => t.shareToken === token);
  if (!trip) return null;
  const { name, destination, startDate, endDate, lodging, activities } = trip;
  return {
    trip: { name, destination, startDate, endDate, lodging, activities },
    people: tripPeople(trip, store.people).map(({ id, name }) => ({ id, name })),
  };
}

const dayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "2027-06-12" -> "Sat, Jun 12". Dates are plain calendar days, never shifted by time zone. */
/** @param {string|undefined} date */
export function fmtDay(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : dayFormat.format(parsed);
}

/** "19:30" -> "7:30 PM" */
/** @param {string|undefined} time */
export function fmtTime(time) {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** @param {string} start @param {string} end */
export function fmtDateRange(start, end) {
  if (!start) return "";
  return !end || end === start ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`;
}

/** "2027-06-12T16:00" -> "Sat, Jun 12 · 4:00 PM" */
/** @param {string|undefined} value */
export function fmtDateTime(value) {
  if (!value) return "";
  const [date, time] = value.split("T");
  return time ? `${fmtDay(date)} · ${fmtTime(time.slice(0, 5))}` : fmtDay(date);
}

/** @param {unknown} value */
export function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/**
 * Tidies a pasted link: adds https:// when missing and returns "" unless the result is a
 * plain web address. Used before saving and again before showing, so a link can never run script.
 */
/** @param {unknown} value */
export function webLink(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") ? url.href : "";
  } catch {
    return "";
  }
}

/** @param {string} address */
export function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
