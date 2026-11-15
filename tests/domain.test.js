import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activitiesByDay,
  adultsOnly,
  attendance,
  defaultAttendees,
  deletePerson,
  enforceAdultOnly,
  finishedToday,
  fmtDateRange,
  fmtDateTime,
  fmtDay,
  fmtTime,
  isValidStore,
  liveStatus,
  localDate,
  localTime,
  randomId,
  removePersonFromTrip,
  sharedView,
  TOKEN_RE,
} from "../site/domain.js";

const people = [
  { id: "dad", name: "Dad", adult: true },
  { id: "mom", name: "Mom", adult: true },
  { id: "kid", name: "Kid", adult: false },
  { id: "other", name: "Not on trip", adult: true },
];
const TOKEN = "abcdefghijklmnopqrstuv";
const trip = {
  id: "t1",
  name: "Vegas",
  destination: "Las Vegas",
  startDate: "2027-06-12",
  endDate: "2027-06-18",
  peopleIds: ["dad", "mom", "kid"],
  lodging: [{ id: "l1", name: "Airbnb", address: "1 Main St" }],
  activities: [
    { id: "a2", title: "Piano bar", date: "2027-06-13", time: "21:00", adultOnly: true, attendeeIds: ["dad", "mom"] },
    { id: "a1", title: "Cirque", date: "2027-06-13", time: "19:00", attendeeIds: ["dad", "mom", "kid"] },
    { id: "a0", title: "Omega Mart", date: "2027-06-12", time: "", attendeeIds: ["kid"] },
  ],
  shareToken: TOKEN,
};
const store = { rev: 3, people, trips: [trip, { ...trip, id: "t2", name: "Secret", shareToken: null }] };

test("a new activity defaults to everyone on the trip", () => {
  assert.deepEqual(defaultAttendees(trip, people), ["dad", "mom", "kid"]);
});

test("adult-only drops the under-21 people", () => {
  assert.deepEqual(defaultAttendees(trip, people, true), ["dad", "mom"]);
  assert.deepEqual(adultsOnly(["kid", "mom"], people), ["mom"]);
});

test("removing a person from a trip removes them from its activities", () => {
  const next = removePersonFromTrip(trip, "kid");
  assert.deepEqual(next.peopleIds, ["dad", "mom"]);
  assert.ok(next.activities.every((a) => !a.attendeeIds.includes("kid")));
  assert.deepEqual(trip.peopleIds, ["dad", "mom", "kid"], "original is untouched");
});

test("deleting a saved person removes them everywhere", () => {
  const next = deletePerson(store, "mom");
  assert.ok(!next.people.some((p) => p.id === "mom"));
  assert.ok(next.trips.every((t) => !t.peopleIds.includes("mom")));
  assert.ok(next.trips.every((t) => t.activities.every((a) => !a.attendeeIds.includes("mom"))));
});

test("someone changed to under 21 leaves adult-only activities only", () => {
  const changed = { ...store, people: people.map((p) => (p.id === "mom" ? { ...p, adult: false } : p)) };
  const [next] = enforceAdultOnly(changed).trips;
  assert.deepEqual(next.activities.find((a) => a.id === "a2").attendeeIds, ["dad"]);
  assert.deepEqual(next.activities.find((a) => a.id === "a1").attendeeIds, ["dad", "mom", "kid"]);
});

test("activities group by day in time order, untimed first", () => {
  const days = activitiesByDay(trip.activities);
  assert.deepEqual(days.map((d) => d.date), ["2027-06-12", "2027-06-13"]);
  assert.deepEqual(days[1].items.map((a) => a.title), ["Cirque", "Piano bar"]);
});

test("attendance reports who is and is not going", () => {
  const members = people.slice(0, 3);
  assert.equal(attendance(trip.activities[1], members).everyone, true);
  const bar = attendance(trip.activities[0], members);
  assert.equal(bar.everyone, false);
  assert.deepEqual(bar.notGoing.map((p) => p.name), ["Kid"]);
});

test("a share link exposes one trip and only the names of people on it", () => {
  const view = sharedView(store, TOKEN);
  assert.equal(view.trip.name, "Vegas");
  assert.deepEqual(view.people, [
    { id: "dad", name: "Dad" },
    { id: "mom", name: "Mom" },
    { id: "kid", name: "Kid" },
  ]);
  const text = JSON.stringify(view);
  for (const hidden of ["Secret", "Not on trip", TOKEN, '"adult"', '"rev"']) {
    assert.ok(!text.includes(hidden), `leaks ${hidden}`);
  }
});

test("unknown, revoked or malformed tokens share nothing", () => {
  assert.equal(sharedView(store, "zzzzzzzzzzzzzzzzzzzzzz"), null);
  assert.equal(sharedView(store, "short"), null);
  assert.equal(sharedView(store, null), null);
  assert.equal(sharedView(store, undefined), null);
});

test("generated share tokens are valid and unique", () => {
  const a = randomId(16);
  assert.match(a, TOKEN_RE);
  assert.notEqual(a, randomId(16));
});

test("store validation", () => {
  assert.equal(isValidStore(store), true);
  assert.equal(isValidStore({ rev: 0, people: [], trips: [] }), true);
  assert.equal(isValidStore({ people: [], trips: [] }), false);
  assert.equal(isValidStore({ ...store, trips: [{ ...trip, shareToken: "guessable" }] }), false);
  assert.equal(isValidStore({ ...store, trips: [trip, { ...trip, id: "t3" }] }), false, "duplicate token");
  assert.equal(isValidStore({ ...store, people: [{ id: "x", name: " ", adult: true }] }), false);
});

test("formatting", () => {
  assert.equal(fmtDay("2027-06-12"), "Sat, Jun 12");
  assert.equal(fmtTime("19:30"), "7:30 PM");
  assert.equal(fmtTime("00:05"), "12:05 AM");
  assert.equal(fmtTime("12:00"), "12:00 PM");
  assert.equal(fmtTime(""), "");
  assert.equal(fmtDateRange("2027-06-12", "2027-06-18"), "Sat, Jun 12 – Fri, Jun 18");
  assert.equal(fmtDateRange("2027-06-12", "2027-06-12"), "Sat, Jun 12");
  assert.equal(fmtDateTime("2027-06-12T16:00"), "Sat, Jun 12 · 4:00 PM");
});

test("today's date and time come from the device clock", () => {
  const now = new Date(2027, 5, 3, 9, 5);
  assert.equal(localDate(now), "2027-06-03");
  assert.equal(localTime(now), "09:05");
});

test("today's activities are labelled now and up next", () => {
  const day = "2027-06-13";
  const acts = [
    { id: "pool", title: "Pool", date: day, time: "", attendeeIds: ["kid"] },
    { id: "brunch", title: "Brunch", date: day, time: "10:00", endTime: "11:00", attendeeIds: ["dad", "kid"] },
    { id: "show", title: "Show", date: day, time: "19:00", endTime: "20:30", attendeeIds: ["dad", "kid"] },
    { id: "bar", title: "Bar", date: day, time: "21:30", endTime: "00:30", attendeeIds: ["dad"] },
    { id: "later", title: "Tomorrow", date: "2027-06-14", time: "09:00", attendeeIds: ["dad"] },
  ];
  const at = (time, me) => Object.fromEntries(liveStatus(acts, day, time, me));
  assert.deepEqual(at("08:00"), { brunch: "next" });
  assert.deepEqual(at("10:30"), { brunch: "now", show: "next" });
  assert.deepEqual(at("12:00"), { show: "next" }, "finished activities lose their label");
  assert.deepEqual(at("19:15"), { show: "now", bar: "next" });
  assert.deepEqual(at("23:00"), { bar: "now" }, "running past midnight still counts as now");
  assert.deepEqual(at("19:15", "kid"), { show: "now" }, "only the chosen person's activities count");
  assert.deepEqual(at("12:00", "kid"), { show: "next" });
  assert.deepEqual(Object.fromEntries(liveStatus(acts, "2027-06-20", "12:00")), {}, "nothing outside today");
});

test("today's finished activities are identified", () => {
  const day = "2027-06-13";
  const acts = [
    { id: "pool", title: "Pool", date: day, time: "", attendeeIds: [] },
    { id: "brunch", title: "Brunch", date: day, time: "10:00", endTime: "11:00", attendeeIds: [] },
    { id: "walk", title: "Walk", date: day, time: "13:00", endTime: "", attendeeIds: [] },
    { id: "show", title: "Show", date: day, time: "19:00", endTime: "20:30", attendeeIds: [] },
    { id: "bar", title: "Bar", date: day, time: "21:30", endTime: "00:30", attendeeIds: [] },
    { id: "old", title: "Yesterday", date: "2027-06-12", time: "09:00", endTime: "10:00", attendeeIds: [] },
  ];
  const at = (time) => [...finishedToday(acts, day, time)].sort();
  assert.deepEqual(at("10:30"), [], "in progress is not finished");
  assert.deepEqual(at("11:00"), [], "not finished at the exact end time");
  assert.deepEqual(at("11:01"), ["brunch"]);
  assert.deepEqual(at("15:00"), ["brunch"], "no end time: not finished until something later starts");
  assert.deepEqual(at("19:00"), ["brunch", "walk"]);
  assert.deepEqual(at("23:59"), ["brunch", "show", "walk"], "past-midnight and untimed ones never finish today");
});
