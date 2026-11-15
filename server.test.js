import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "./server.mjs";

const TOKEN = "abcdefghijklmnopqrstuv";
const AUTH = { Authorization: `Basic ${Buffer.from("boss:s3cret").toString("base64")}` };
const WRITE = { ...AUTH, "Content-Type": "application/json", "X-Requested-With": "trip-planner" };

let dir, server, base, dataFile;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "trip-planner-"));
  dataFile = path.join(dir, "store.json");
  server = createApp({ dataFile, user: "boss", password: "s3cret" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

const store = (rev) => ({
  rev,
  people: [
    { id: "p1", name: "Dad", adult: true },
    { id: "p2", name: "Stranger", adult: true },
  ],
  trips: [
    {
      id: "t1",
      name: "Vegas",
      destination: "Las Vegas",
      startDate: "2027-06-12",
      endDate: "2027-06-18",
      peopleIds: ["p1"],
      lodging: [],
      activities: [],
      shareToken: TOKEN,
    },
  ],
});
const put = (body, headers = WRITE) =>
  fetch(`${base}/api/store`, { method: "PUT", headers, body: JSON.stringify(body) });

test("admin pages and data need the login", async () => {
  for (const url of ["/", "/app.js", "/api/store", "/index.html"]) {
    const res = await fetch(base + url);
    assert.equal(res.status, 401, url);
    assert.match(res.headers.get("www-authenticate"), /^Basic/);
  }
  const wrong = { Authorization: `Basic ${Buffer.from("boss:nope").toString("base64")}` };
  assert.equal((await fetch(`${base}/api/store`, { headers: wrong })).status, 401);
  assert.equal((await put(store(0), { "Content-Type": "application/json" })).status, 401);
});

test("the admin can load the page and an empty store", async () => {
  const page = await fetch(base + "/", { headers: AUTH });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Time and Place/);
  assert.deepEqual(await (await fetch(`${base}/api/store`, { headers: AUTH })).json(), {
    rev: 0,
    people: [],
    trips: [],
  });
});

test("saving writes the JSON file and bumps the revision", async () => {
  const res = await put(store(0));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { rev: 1 });
  const onDisk = JSON.parse(await readFile(dataFile, "utf8"));
  assert.equal(onDisk.rev, 1);
  assert.equal(onDisk.trips[0].name, "Vegas");
});

test("a stale save is refused and returns the latest data", async () => {
  const res = await put(store(0));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).store.rev, 1);
});

test("invalid data and cross-site style writes are refused", async () => {
  assert.equal((await put({ rev: 1, people: "nope", trips: [] })).status, 400);
  assert.equal((await put(store(1), { ...AUTH, "Content-Type": "application/json" })).status, 403);
  const raw = await fetch(`${base}/api/store`, { method: "PUT", headers: WRITE, body: "{oops" });
  assert.equal(raw.status, 400);
});

test("the share link works without a login and shows only that trip", async () => {
  const page = await fetch(`${base}/s/${TOKEN}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
  for (const file of ["/styles.css", "/share.js", "/activity-types.js", "/domain.js", "/share-sw.js", "/manifest.webmanifest"]) {
    assert.equal((await fetch(base + file)).status, 200, file);
  }
  const res = await fetch(`${base}/api/shared/${TOKEN}`);
  assert.equal(res.status, 200);
  const view = await res.json();
  assert.equal(view.trip.name, "Vegas");
  assert.deepEqual(view.people, [{ id: "p1", name: "Dad" }]);
  assert.ok(!JSON.stringify(view).includes("Stranger"));
});

test("a shared trip installs as its own app, opening at the itinerary", async () => {
  const res = await fetch(`${base}/s/${TOKEN}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /manifest\+json/);
  const manifest = await res.json();
  assert.equal(manifest.name, "Vegas");
  assert.equal(manifest.start_url, `/s/${TOKEN}`);
  assert.equal(manifest.display, "standalone");
  const admin = await (await fetch(`${base}/manifest.webmanifest`)).json();
  for (const icon of [...manifest.icons, ...admin.icons, { src: "/apple-touch-icon.png", type: "image/png" }]) {
    const png = await fetch(base + icon.src);
    assert.equal(png.status, 200, icon.src);
    assert.equal(png.headers.get("content-type"), "image/png");
    assert.equal(icon.type, "image/png");
  }
  assert.equal((await fetch(`${base}/s/zzzzzzzzzzzzzzzzzzzzzz/manifest.webmanifest`)).status, 404);
});

test("unknown share tokens and odd paths give nothing away", async () => {
  assert.equal((await fetch(`${base}/api/shared/zzzzzzzzzzzzzzzzzzzzzz`)).status, 404);
  assert.equal((await fetch(`${base}/api/shared/`)).status, 404);
  assert.equal((await fetch(`${base}/..%2Fserver.mjs`, { headers: AUTH })).status, 404);
  assert.equal((await fetch(`${base}/nope.js`, { headers: AUTH })).status, 404);
  for (const file of ["domain.test.js", "app.ui.test.js", "admin/store.test.js", "models.js"]) {
    assert.equal((await fetch(`${base}/${file}`, { headers: AUTH })).status, 404, `${file} is not an application asset`);
  }
});

test("stopping sharing kills the link", async () => {
  const next = store(1);
  next.trips[0].shareToken = null;
  assert.equal((await put(next)).status, 200);
  assert.equal((await fetch(`${base}/api/shared/${TOKEN}`)).status, 404);
});

test("the fictional sample is public and leaves real trips untouched", async () => {
  const before = await (await fetch(`${base}/api/store`, { headers: AUTH })).json();
  for (const url of ["/sample", "/sample/"]) {
    const page = await fetch(base + url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("www-authenticate"), null);
    assert.match(await page.text(), /Time and Place/);
    assert.equal((await fetch(base + url, { method: "HEAD" })).status, 200);
  }
  const response = await fetch(`${base}/sample.json`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const sample = await response.json();
  assert.equal(sample.trip.name, "The Simpsons in Middle-earth");
  assert.deepEqual(sample.people.map((p) => p.name), ["Homer", "Marge", "Bart", "Lisa", "Maggie"]);
  assert.ok(sample.trip.activities.some((a) => !a.date), "the sample shows unscheduled activities");
  const ids = new Set(sample.people.map((p) => p.id));
  for (const activity of sample.trip.activities) {
    assert.ok(activity.attendeeIds.every((id) => ids.has(id)));
    assert.ok(!activity.date || (activity.date >= sample.trip.startDate && activity.date <= sample.trip.endDate));
  }
  for (const url of ["/sample", "/sample.json"]) {
    const write = await fetch(base + url, { method: "PUT", body: "{}" });
    assert.equal(write.status, 401, "anonymous sample visits cannot write");
  }
  assert.deepEqual(await (await fetch(`${base}/api/store`, { headers: AUTH })).json(), before);
  assert.equal((await fetch(`${base}/api/store`)).status, 401);
});
