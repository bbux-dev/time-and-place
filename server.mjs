// Local prototype server: static files, HTTP basic auth for the admin, public share links,
// and one JSON file as the whole database (the stand-in for a single R2/S3 object).

import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emptyStore, isValidStore, sharedView } from "./site/domain.js";

const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
// Files the shared page needs. Everything else requires the admin login.
const PUBLIC_FILES = new Set([
  "/styles.css",
  "/share.js",
  "/domain.js",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
  "/share-sw.js",
]);
const MAX_BODY = 1_000_000;
const ICONS = [
  { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

/** Swap this for an R2/S3 get/put of one object when hosting. */
function fileStorage(file) {
  return {
    async get() {
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch (err) {
        if (err.code === "ENOENT") return emptyStore();
        throw err;
      }
    },
    async put(store) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(store, null, 2));
      await rename(`${file}.tmp`, file);
    },
  };
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function sendFile(res, name, headers = {}) {
  const type = TYPES[path.extname(name)];
  if (!type || !/^[\w.-]+$/.test(name)) return send(res, 404, "Not found");
  try {
    send(res, 200, await readFile(path.join(SITE_DIR, name)), { "Content-Type": type, ...headers });
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    send(res, 404, "Not found");
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

const digest = (value) => createHash("sha256").update(value).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));

export function createApp({ dataFile, user, password }) {
  const storage = fileStorage(dataFile);
  let chain = Promise.resolve();
  const exclusive = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  function isAdmin(req) {
    const [scheme, encoded] = (req.headers.authorization || "").split(" ");
    if (scheme !== "Basic" || !encoded) return false;
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const split = decoded.indexOf(":");
    if (split < 0) return false;
    const okUser = same(decoded.slice(0, split), user);
    const okPass = same(decoded.slice(split + 1), password);
    return okUser && okPass;
  }

  async function handle(req, res) {
    const { pathname } = new URL(req.url, "http://localhost");
    const isRead = req.method === "GET" || req.method === "HEAD";

    // Public: the shared itinerary. Anyone with the link can read that one trip.
    const shared = { "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
    if (isRead && /^\/s\/[\w-]+$/.test(pathname)) return sendFile(res, "share.html", shared);
    // Each shared trip installs as its own home-screen app that opens straight to the itinerary.
    const install = isRead && pathname.match(/^\/s\/([\w-]+)\/manifest\.webmanifest$/);
    if (install) {
      const view = sharedView(await storage.get(), install[1]);
      if (!view) return send(res, 404, { error: "Link not active" });
      const manifest = {
        name: view.trip.name,
        short_name: view.trip.name.slice(0, 12),
        start_url: `/s/${install[1]}`,
        scope: `/s/${install[1]}`,
        display: "standalone",
        background_color: "#f1f3f4",
        theme_color: "#0f766e",
        icons: ICONS,
      };
      return send(res, 200, JSON.stringify(manifest), { ...shared, "Content-Type": TYPES[".webmanifest"] });
    }
    if (isRead && pathname.startsWith("/api/shared/")) {
      const view = sharedView(await storage.get(), pathname.slice("/api/shared/".length));
      return view ? send(res, 200, view, shared) : send(res, 404, { error: "Link not active" });
    }
    if (isRead && PUBLIC_FILES.has(pathname)) return sendFile(res, pathname.slice(1));

    // Everything below is the admin's.
    if (!isAdmin(req)) {
      return send(res, 401, "Login required", {
        "WWW-Authenticate": 'Basic realm="Trip Planner", charset="UTF-8"',
      });
    }

    if (pathname === "/api/store") {
      if (isRead) return send(res, 200, await storage.get());
      if (req.method !== "PUT") return send(res, 405, { error: "Method not allowed" });
      // A custom header forces a CORS preflight, so other sites cannot ride the saved login.
      if (req.headers["x-requested-with"] !== "trip-planner") {
        return send(res, 403, { error: "Forbidden" });
      }
      const next = await readJson(req);
      if (!isValidStore(next)) return send(res, 400, { error: "Invalid data" });
      return exclusive(async () => {
        const current = await storage.get();
        if (next.rev !== current.rev) return send(res, 409, { error: "Stale", store: current });
        const saved = { ...next, rev: current.rev + 1 };
        await storage.put(saved);
        send(res, 200, { rev: saved.rev });
      });
    }
    if (pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });
    if (!isRead) return send(res, 405, "Method not allowed");
    return sendFile(res, pathname === "/" ? "index.html" : pathname.slice(1));
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!err.status) console.error(err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : "Server error" });
      else res.end();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 4181);
  const user = process.env.ADMIN_USER || "admin";
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!process.env.ADMIN_PASSWORD && !loopback) {
    console.error("Set ADMIN_PASSWORD (see .env.example) before listening beyond 127.0.0.1.");
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD || "changeme";
  const dataFile = path.resolve(process.env.DATA_FILE || "data/store.json");
  createApp({ dataFile, user, password }).listen(port, host, () => {
    console.log(`Trip planner: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
    console.log(`Login: ${user} / ${process.env.ADMIN_PASSWORD ? "(from ADMIN_PASSWORD)" : "changeme"}`);
    console.log(`Data:  ${dataFile}`);
  });
}
