// Pure trip rules and formatting, shared by the admin page, the shared page, and the server.

export const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

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

const isStr = (v) => typeof v === "string";

export function isValidStore(store) {
  if (!store || !Number.isInteger(store.rev)) return false;
  if (!Array.isArray(store.people) || !Array.isArray(store.trips)) return false;
  const peopleOk = store.people.every(
    (p) => p && isStr(p.id) && isStr(p.name) && p.name.trim() && typeof p.adult === "boolean",
  );
  const tripsOk = store.trips.every(
    (t) =>
      t &&
      isStr(t.id) &&
      isStr(t.name) &&
      isStr(t.startDate) &&
      isStr(t.endDate) &&
      Array.isArray(t.peopleIds) &&
      t.peopleIds.every(isStr) &&
      Array.isArray(t.lodging) &&
      t.lodging.every((l) => l && isStr(l.id) && isStr(l.name)) &&
      Array.isArray(t.activities) &&
      t.activities.every(
        (a) =>
          a &&
          isStr(a.id) &&
          isStr(a.title) &&
          isStr(a.date) &&
          Array.isArray(a.attendeeIds) &&
          a.attendeeIds.every(isStr),
      ) &&
      (t.shareToken === null || (isStr(t.shareToken) && TOKEN_RE.test(t.shareToken))),
  );
  if (!peopleOk || !tripsOk) return false;
  const tokens = store.trips.map((t) => t.shareToken).filter(Boolean);
  return new Set(tokens).size === tokens.length;
}

export function tripPeople(trip, people) {
  return people.filter((p) => trip.peopleIds.includes(p.id));
}

/** Everyone on the trip, or only the 21+ people for an adult-only activity. */
export function defaultAttendees(trip, people, adultOnly = false) {
  return tripPeople(trip, people)
    .filter((p) => !adultOnly || p.adult)
    .map((p) => p.id);
}

export function adultsOnly(ids, people) {
  const adults = new Set(people.filter((p) => p.adult).map((p) => p.id));
  return ids.filter((id) => adults.has(id));
}

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

export function deletePerson(store, personId) {
  return {
    ...store,
    people: store.people.filter((p) => p.id !== personId),
    trips: store.trips.map((t) => removePersonFromTrip(t, personId)),
  };
}

/** Drops under-21 people from adult-only activities (after someone's 21+ flag changes). */
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

export function activitiesByDay(activities) {
  const sorted = [...activities].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time || "").localeCompare(b.time || "") ||
      a.title.localeCompare(b.title),
  );
  const days = [];
  for (const activity of sorted) {
    const last = days.at(-1);
    if (last && last.date === activity.date) last.items.push(activity);
    else days.push({ date: activity.date, items: [activity] });
  }
  return days;
}

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

/** Who is and is not going, in trip order. */
export function attendance(activity, members) {
  const going = members.filter((p) => activity.attendeeIds.includes(p.id));
  const notGoing = members.filter((p) => !activity.attendeeIds.includes(p.id));
  return { going, notGoing, everyone: members.length > 0 && notGoing.length === 0 };
}

/** What a share link exposes: one trip and the names of the people on it. Nothing else. */
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
export function fmtDay(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : dayFormat.format(parsed);
}

/** "19:30" -> "7:30 PM" */
export function fmtTime(time) {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtDateRange(start, end) {
  if (!start) return "";
  return !end || end === start ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`;
}

/** "2027-06-12T16:00" -> "Sat, Jun 12 · 4:00 PM" */
export function fmtDateTime(value) {
  if (!value) return "";
  const [date, time] = value.split("T");
  return time ? `${fmtDay(date)} · ${fmtTime(time.slice(0, 5))}` : fmtDay(date);
}

export function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
