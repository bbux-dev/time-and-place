// The Cloudflare Worker entry, run here against stand-ins for its R2 bucket and asset binding.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import worker from "./worker.js";

const TOKEN = "abcdefghijklmnopqrstuv";
const ORIGIN = "https://trips.bxtn.dev";
const AUTH = { Authorization: `Basic ${btoa("boss:s3cret")}` };
const WRITE = { ...AUTH, "Content-Type": "application/json", "X-Requested-With": "trip-planner" };

/** Behaves like an R2 bucket for the calls the app makes, including conditional writes. */
function fakeBucket() {
  const objects = new Map();
  let counter = 0;
  return {
    objects,
    async get(key) {
      const object = objects.get(key);
      return object ? { etag: object.etag, json: async () => JSON.parse(object.body) } : null;
    },
    async put(key, body, options = {}) {
      const wanted = options.onlyIf?.etagMatches;
      if (wanted && objects.get(key)?.etag !== wanted) return null;
      const object = { body, etag: `etag-${(counter += 1)}`, contentType: options.httpMetadata?.contentType };
      objects.set(key, object);
      return object;
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    Data: fakeBucket(),
    ASSETS: {
      async fetch(url) {
        try {
          assert.equal(typeof url, "string");
          return new Response(await readFile(new URL(`../site${new URL(url).pathname}`, import.meta.url)));
        } catch {
          return new Response("Not found", { status: 404 });
        }
      },
    },
    SST_RESOURCE_AdminPassword: JSON.stringify({ value: "s3cret" }),
    ADMIN_USER: "boss",
    ...overrides,
  };
}

const call = (env, path, init) => worker.fetch(new Request(ORIGIN + path, init), env);
const store = (rev, shareToken = TOKEN) => ({
  rev,
  people: [{ id: "p1", name: "Dad", adult: true }],
  trips: [
    {
      id: "t1",
      name: "Vegas",
      startDate: "2027-06-12",
      endDate: "2027-06-18",
      peopleIds: ["p1"],
      lodging: [],
      activities: [],
      shareToken,
    },
  ],
});
const put = (env, body) => call(env, "/api/store", { method: "PUT", headers: WRITE, body: JSON.stringify(body) });

test("plain HTTP is redirected to HTTPS before any login prompt", async () => {
  const res = await worker.fetch(new Request("http://trips.bxtn.dev/?a=1"), makeEnv());
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://trips.bxtn.dev/?a=1");
});

test("without a configured password nothing is served", async () => {
  for (const secret of [undefined, "", "not json", JSON.stringify({ value: "" })]) {
    const res = await call(makeEnv({ SST_RESOURCE_AdminPassword: secret }), "/", { headers: AUTH });
    assert.equal(res.status, 500);
  }
});

test("the public sample works without accessing the real R2 database", async () => {
  const env = makeEnv({
    Data: {
      get() { assert.fail("sample routes must not read R2"); },
      put() { assert.fail("sample routes must not write R2"); },
    },
  });
  for (const path of ["/sample", "/sample/", "/sample.json"]) {
    const response = await call(env, path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("www-authenticate"), null);
    if (path.endsWith(".json")) {
      assert.equal((await response.json()).trip.name, "The Simpsons in Middle-earth");
    } else {
      assert.match(await response.text(), /Time and Place/);
    }
  }
  assert.equal((await call(env, "/api/store")).status, 401);
});

test("the admin page and data need the login; pages come from the asset binding", async () => {
  const env = makeEnv();
  for (const path of ["/", "/app.js", "/index.html", "/api/store"]) {
    assert.equal((await call(env, path)).status, 401, path);
  }
  const page = await call(env, "/", { headers: AUTH });
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(page.headers.get("strict-transport-security"), /max-age/);
  assert.match(await page.text(), /Time and Place/);
  assert.equal((await call(env, "/nope.js", { headers: AUTH })).status, 404);
});

test("a new bucket starts empty, and saving writes store.json plus a daily backup", async () => {
  const env = makeEnv();
  assert.deepEqual(await (await call(env, "/api/store", { headers: AUTH })).json(), {
    rev: 0,
    people: [],
    trips: [],
  });
  const res = await put(env, store(0));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { rev: 1 });
  const saved = env.Data.objects.get("store.json");
  assert.equal(JSON.parse(saved.body).rev, 1);
  assert.equal(saved.contentType, "application/json");
  const backups = [...env.Data.objects.keys()].filter((key) => key.startsWith("backups/"));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^backups\/\d{4}-\d{2}-\d{2}\.json$/);
});

test("a stale save is refused", async () => {
  const env = makeEnv();
  await put(env, store(0));
  const res = await put(env, store(0));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).store.rev, 1);
});

test("a save loses cleanly if the object changes between read and write", async () => {
  const env = makeEnv();
  await put(env, store(0));
  const realGet = env.Data.get.bind(env.Data);
  let raced = false;
  env.Data.get = async (key) => {
    const object = await realGet(key);
    if (!raced) {
      raced = true; // another Worker instance saves right after our read
      await env.Data.put(key, JSON.stringify({ ...store(1), rev: 2 }));
    }
    return object;
  };
  const res = await put(env, store(1));
  assert.equal(res.status, 409);
  assert.equal(JSON.parse(env.Data.objects.get("store.json").body).rev, 2, "the other save survives");
});

test("share links work without a login and stop when sharing stops", async () => {
  const env = makeEnv();
  await put(env, store(0));
  assert.equal((await call(env, `/s/${TOKEN}`)).status, 200);
  const view = await (await call(env, `/api/shared/${TOKEN}`)).json();
  assert.equal(view.trip.name, "Vegas");
  const manifest = await (await call(env, `/s/${TOKEN}/manifest.webmanifest`)).json();
  assert.equal(manifest.start_url, `/s/${TOKEN}`);
  for (const path of ["/styles.css", "/share.js", "/icon-192.png", "/share-sw.js"]) {
    assert.equal((await call(env, path)).status, 200, path);
  }
  await put(env, store(1, null));
  assert.equal((await call(env, `/api/shared/${TOKEN}`)).status, 404);
});
