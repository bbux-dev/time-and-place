import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandler } from "./handler.js";
import { MapsPreviewError, parseMapsPlace, previewMapsLink } from "./maps.js";

const SHORT = "https://maps.app.goo.gl/oJ3CHSb66Tx4YTf66";
const PAGE = "https://www.google.com/maps/place/Komodo+Las+Vegas/";
const HTML = '<title>Google Maps</title><link href="/maps/preview/place?q=komodo&amp;hl=en" as="fetch" rel="preload">';
function preview(title, address, category) {
  const place = [];
  place[2] = address;
  place[11] = title;
  place[13] = [category];
  const data = [];
  data[6] = place;
  return `)]}'\n${JSON.stringify(data)}`;
}
const DETAILS = preview("Komodo Las Vegas", ["2777 S Las Vegas Blvd", "Las Vegas, NV 89109"], "Restaurant");

test("Maps place previews distinguish the two supplied dining and non-dining examples", () => {
  const dining = parseMapsPlace(HTML, PAGE, DETAILS);
  assert.equal(dining.title, "Komodo Las Vegas");
  assert.equal(dining.location, "2777 S Las Vegas Blvd, Las Vegas, NV 89109");
  assert.equal(dining.category, "Restaurant");
  assert.equal(dining.dining, true);
  assert.equal(dining.museum, false);
  const activity = parseMapsPlace(HTML, PAGE, preview(
    "Hoover Dam Visitor Center & Tours", ["81 Hoover Dam Access Rd", "Boulder City, NV 89005"], "Visitor center",
  ));
  assert.equal(activity.title, "Hoover Dam Visitor Center & Tours");
  assert.equal(activity.location, "81 Hoover Dam Access Rd, Boulder City, NV 89005");
  assert.equal(activity.dining, false);
  assert.equal(activity.museum, false);
});

test("Maps categories identify a museum without marking it as dining", () => {
  const museum = parseMapsPlace(HTML, PAGE, preview("The Mob Museum", ["300 Stewart Ave", "Las Vegas, NV 89101"], "History museum"));
  assert.equal(museum.title, "The Mob Museum");
  assert.equal(museum.museum, true);
  assert.equal(museum.dining, false);
});

test("ordinary metadata handles attribute order and HTML entities", () => {
  const place = parseMapsPlace(`<meta content='Bread &amp; Butter &#x26; Tea' property='og:title'>
    <meta property="og:description" content="★★★★★ · Cafe">
    <meta itemprop="streetAddress" content="1 Main St">`, PAGE);
  assert.equal(place.title, "Bread & Butter & Tea");
  assert.equal(place.location, "1 Main St");
  assert.equal(place.dining, true);
});

test("missing or changed preview data falls back to the place path without guessing Dining", () => {
  const place = parseMapsPlace("<title> Google Maps </title>", PAGE, "not JSON");
  assert.equal(place.title, "Komodo Las Vegas");
  assert.equal(place.dining, null);
  assert.equal(place.category, "");
  assert.throws(() => parseMapsPlace("<title>Google Maps</title>", "https://www.google.com/maps/"), MapsPreviewError);
});

test("lookup follows Maps redirects, reads the same-origin place preview and preserves the shared URL", async () => {
  const calls = [];
  const result = await previewMapsLink(SHORT, async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, undefined);
    if (url === SHORT) return new Response(null, { status: 302, headers: { Location: PAGE } });
    if (url === PAGE) return new Response(HTML);
    assert.equal(url, "https://www.google.com/maps/preview/place?q=komodo&hl=en");
    return new Response(DETAILS);
  });
  assert.equal(calls.length, 3);
  assert.equal(result.title, "Komodo Las Vegas");
  assert.equal(result.dining, true);
  assert.equal(result.mapUrl, SHORT);
});

test("unsupported URLs are rejected before any network request", async () => {
  for (const url of [
    "https://example.com/place", "http://maps.app.goo.gl/test", "https://127.0.0.1/maps/",
    "https://www.google.com.evil.test/maps/", "https://www.google.com/search?q=x",
    "https://user:password@www.google.com/maps/", "https://www.google.com:444/maps/",
    "https://goo.gl/not-maps", "file:///etc/passwd", "not a URL", null,
  ]) {
    await assert.rejects(previewMapsLink(url, () => assert.fail("must not fetch")), MapsPreviewError);
  }
});

test("redirects cannot send the lookup to non-Maps or private hosts", async () => {
  let calls = 0;
  await assert.rejects(previewMapsLink(SHORT, async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/private" } });
  }), MapsPreviewError);
  assert.equal(calls, 1);
});

test("redirect loops and oversized pages are bounded", async () => {
  let calls = 0;
  await assert.rejects(previewMapsLink(SHORT, async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: SHORT } });
  }), /redirected too many times/);
  assert.equal(calls, 6);
  await assert.rejects(previewMapsLink(SHORT, async () => new Response("x".repeat(1_000_001))), /too large/);
});

test("lookup failures leave a usable manual-entry fallback", async () => {
  await assert.rejects(previewMapsLink(SHORT, async () => { throw new Error("Network failure"); }), /Couldn't reach Google Maps/);
  await assert.rejects(previewMapsLink(SHORT, async () => new Response("", { status: 429 })), /blocked the place preview/);
  const result = await previewMapsLink(PAGE, async (url) => url === PAGE
    ? new Response(HTML) : new Response("unavailable", { status: 503 }));
  assert.equal(result.title, "Komodo Las Vegas");
  assert.equal(result.dining, null);
});

test("Google challenges preserve the resolved place name without following the challenge", async () => {
  const mob = "https://www.google.com/maps/place/The+Mob+Museum/";
  for (const blockedUrl of ["https://www.google.com/sorry/index?continue=maps", "https://consent.google.com/m"]) {
    let calls = 0;
    const result = await previewMapsLink(SHORT, async (url) => {
      calls++;
      if (url === SHORT) return new Response(null, { status: 302, headers: { Location: mob } });
      assert.equal(url, mob, "the challenge page must never be fetched");
      return new Response(null, { status: 302, headers: { Location: blockedUrl } });
    });
    assert.equal(calls, 2);
    assert.equal(result.title, "The Mob Museum");
    assert.equal(result.dining, null, "no category is invented from a blocked preview");
    assert.equal(result.museum, null);
    assert.equal(result.mapUrl, SHORT);
    assert.match(result.warning, /blocked the full preview/);
  }
});

test("403 and 429 responses on a resolved place produce an explicit partial-result warning", async () => {
  for (const status of [403, 429]) {
    const result = await previewMapsLink(PAGE, async () => new Response("blocked", { status }));
    assert.equal(result.title, "Komodo Las Vegas");
    assert.equal(result.dining, null);
    assert.match(result.warning, /check the address and activity type/);
  }
});

test("untrusted preload links are ignored", async () => {
  let calls = 0;
  const result = await previewMapsLink(PAGE, async () => {
    calls++;
    return new Response('<title>Komodo Las Vegas - Google Maps</title><link as="fetch" rel="preload" href="https://evil.test/maps/preview/place">');
  });
  assert.equal(calls, 1);
  assert.equal(result.title, "Komodo Las Vegas");
});

test("the lookup API requires admin authentication and never reads or writes trip data", async () => {
  let calls = 0;
  const handle = createHandler({
    user: "boss", password: "secret",
    storage: { get() { assert.fail("must not read trips"); }, put() { assert.fail("must not save trips"); } },
    assets: { read() { assert.fail("must not read site assets"); } },
    mapsFetch: async (url) => {
      calls++;
      if (url === SHORT) return new Response(null, { status: 302, headers: { Location: PAGE } });
      return new Response(url === PAGE ? HTML : DETAILS);
    },
  });
  const headers = {
    Authorization: `Basic ${btoa("boss:secret")}`,
    "Content-Type": "application/json", "X-Requested-With": "trip-planner",
  };
  const request = (init) => handle(new Request("https://trips.bxtn.dev/api/maps-preview", init));
  const body = JSON.stringify({ url: SHORT });
  assert.equal((await request({ method: "POST", body })).status, 401);
  assert.equal((await request({ method: "POST", body, headers: { Authorization: headers.Authorization } })).status, 403);
  assert.equal((await request({ headers })).status, 405);
  assert.equal(calls, 0);
  assert.equal((await request({ method: "POST", headers, body: "null" })).status, 400);
  const response = await request({ method: "POST", headers, body });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).dining, true);
  assert.match(response.headers.get("cache-control"), /no-store/);
});
