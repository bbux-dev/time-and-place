// The whole backend, written against web-standard Request/Response so the same code runs
// in the local Node server (server.mjs) and in the Cloudflare Worker (infra/worker.js).
//
//   storage: { get(): {store, version}, put(store, version): boolean }  - false means "changed underneath you"
//   assets:  { read(name): body | null }                                - a file from site/

import { emptyStore, isValidStore, sharedView } from "../site/domain.js";
import { MapsPreviewError, previewMapsLink } from "./maps.js";
import { PUBLIC_ASSETS, SITE_ASSETS } from "./assets.js";

/** @type {Record<string, string>} */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
// Files the shared page needs. Everything else requires the admin login.
const PUBLIC_FILES = new Set(PUBLIC_ASSETS.map((name) => `/${name}`));
const ALLOWED_FILES = new Set(SITE_ASSETS);
const ICONS = [
  { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];
const MAX_BODY = 1_000_000;
// no-transform stops Cloudflare injecting analytics or detection scripts into the pages.
const BASE = { "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff" };
const SHARED = { "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };

/** @param {number} status @param {string} body @param {Record<string,string>} [headers] */
const text = (status, body, headers = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...BASE, ...headers } });
/** @param {number} status @param {unknown} body @param {Record<string,string>} [headers] */
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...BASE, ...headers },
  });

class HttpError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** @param {Request} request @returns {Promise<unknown>} */
async function readJson(request) {
  const chunks = [];
  let size = 0;
  if (request.body) {
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > MAX_BODY) throw new HttpError(413, "Too large");
      chunks.push(chunk);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

/** @param {string} value */
const digest = async (value) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

/** Compares hashes byte by byte without stopping early, so timing says nothing about the password. */
/** @param {string} a @param {string} b */
async function same(a, b) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * @typedef {{get: () => Promise<{store: import('../site/models.js').Store, version: string|null}>, put: (store: import('../site/models.js').Store, version: string|null) => Promise<boolean>}} Storage
 * @typedef {{read: (name: string) => Promise<BodyInit|null>}} Assets
 * @typedef {{get: (key: string) => Promise<{etag: string, json: () => Promise<unknown>}|null>, put: (key: string, body: string, options: {httpMetadata: {contentType: string}, onlyIf?: {etagMatches: string}}) => Promise<unknown|null>}} Bucket
 * @param {{storage: Storage, assets: Assets, user: string, password: string, mapsFetch?: typeof fetch}} options
 */
export function createHandler({ storage, assets, user, password, mapsFetch = fetch }) {
  /** @type {Promise<unknown>} */
  let chain = Promise.resolve();
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const exclusive = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  /** @param {Request} request */
  async function isAdmin(request) {
    const [scheme, encoded] = (request.headers.get("authorization") || "").split(" ");
    if (scheme !== "Basic" || !encoded) return false;
    let decoded;
    try {
      decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
    } catch {
      return false;
    }
    const split = decoded.indexOf(":");
    if (split < 0) return false;
    const [okUser, okPass] = await Promise.all([
      same(decoded.slice(0, split), user),
      same(decoded.slice(split + 1), password),
    ]);
    return okUser && okPass;
  }

  /** @param {string} name @param {Record<string,string>} [headers] */
  async function file(name, headers = {}) {
    const type = TYPES[name.slice(name.lastIndexOf("."))];
    if (!type || !ALLOWED_FILES.has(name)) return text(404, "Not found");
    const body = await assets.read(name);
    if (body === null) return text(404, "Not found");
    return new Response(body, { status: 200, headers: { "Content-Type": type, ...BASE, ...headers } });
  }

  /** @param {Request} request */
  async function route(request) {
    const { pathname } = new URL(request.url);
    const isRead = request.method === "GET" || request.method === "HEAD";

    // Fictional showcase data comes only from static assets, never the trip database.
    if (isRead && (pathname === "/sample" || pathname === "/sample/")) return file("share.html", SHARED);
    if (isRead && pathname === "/sample.json") return file("sample.json", SHARED);

    // Public: the shared itinerary. Anyone with the link can read that one trip.
    if (isRead && /^\/s\/[\w-]+$/.test(pathname)) return file("share.html", SHARED);
    // Each shared trip installs as its own home-screen app that opens straight to the itinerary.
    const install = isRead && pathname.match(/^\/s\/([\w-]+)\/manifest\.webmanifest$/);
    if (install) {
      const view = sharedView((await storage.get()).store, install[1]);
      if (!view) return json(404, { error: "Link not active" });
      return json(
        200,
        {
          name: view.trip.name,
          short_name: view.trip.name.slice(0, 12),
          start_url: `/s/${install[1]}`,
          scope: `/s/${install[1]}`,
          display: "standalone",
          background_color: "#f1f3f4",
          theme_color: "#0f766e",
          icons: ICONS,
        },
        { ...SHARED, "Content-Type": TYPES[".webmanifest"] },
      );
    }
    if (isRead && pathname.startsWith("/api/shared/")) {
      const view = sharedView((await storage.get()).store, pathname.slice("/api/shared/".length));
      return view ? json(200, view, SHARED) : json(404, { error: "Link not active" });
    }
    if (isRead && PUBLIC_FILES.has(pathname)) return file(pathname.slice(1));

    // Everything below is the admin's.
    if (!(await isAdmin(request))) {
      return text(401, "Login required", {
        "WWW-Authenticate": 'Basic realm="Time and Place", charset="UTF-8"',
      });
    }

    if (pathname === "/api/maps-preview") {
      if (request.method !== "POST") return json(405, { error: "Method not allowed" });
      if (request.headers.get("x-requested-with") !== "trip-planner") return json(403, { error: "Forbidden" });
      const body = await readJson(request);
      const url = body && typeof body === "object" && "url" in body ? body.url : undefined;
      return json(200, await previewMapsLink(url, mapsFetch));
    }
    if (pathname === "/api/store") {
      if (isRead) return json(200, (await storage.get()).store);
      if (request.method !== "PUT") return json(405, { error: "Method not allowed" });
      // A custom header forces a CORS preflight, so other sites cannot ride the saved login.
      if (request.headers.get("x-requested-with") !== "trip-planner") {
        return json(403, { error: "Forbidden" });
      }
      const next = await readJson(request);
      if (!isValidStore(next)) return json(400, { error: "Invalid data" });
      return exclusive(async () => {
        const { store: current, version } = await storage.get();
        if (next.rev !== current.rev) return json(409, { error: "Stale", store: current });
        const saved = { ...next, rev: current.rev + 1 };
        if (await storage.put(saved, version)) return json(200, { rev: saved.rev });
        return json(409, { error: "Stale", store: (await storage.get()).store });
      });
    }
    if (pathname.startsWith("/api/")) return json(404, { error: "Not found" });
    if (!isRead) return text(405, "Method not allowed");
    return file(pathname === "/" ? "index.html" : pathname.slice(1));
  }

  return async function handle(/** @type {Request} */ request) {
    try {
      return await route(request);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      if (err instanceof MapsPreviewError) return json(err.status, { error: err.message });
      console.error(err);
      return json(500, { error: "Server error" });
    }
  };
}

/** One JSON object in an R2 bucket is the whole database. */
/** @param {Bucket} bucket @param {string} [key] @returns {Storage} */
export function r2Storage(bucket, key = "store.json") {
  return {
    async get() {
      const object = await bucket.get(key);
      if (!object) return { store: emptyStore(), version: null };
      const store = await object.json();
      if (!isValidStore(store)) throw new Error("Invalid stored trip data");
      return { store, version: object.etag };
    },
    async put(store, version) {
      const body = JSON.stringify(store);
      const httpMetadata = { contentType: "application/json" };
      // Only overwrite the exact copy we just read; R2 returns null if it changed in between.
      const guard = version ? { onlyIf: { etagMatches: version } } : {};
      if ((await bucket.put(key, body, { httpMetadata, ...guard })) === null) return false;
      // One snapshot per day (the last save of that day), so a bad edit can be undone by hand.
      await bucket.put(`backups/${new Date().toISOString().slice(0, 10)}.json`, body, { httpMetadata });
      return true;
    },
  };
}
