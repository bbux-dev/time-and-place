// Local server: runs the shared handler (infra/handler.js) on Node, with the site/ folder
// for pages and one JSON file as the database. Production runs the same handler in a
// Cloudflare Worker with an R2 object instead (infra/worker.js).

import http from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHandler } from "./infra/handler.js";
import { emptyStore, isValidStore } from "./site/domain.js";

const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");

/** @param {string} file @returns {import('./infra/handler.js').Storage} */
function fileStorage(file) {
  return {
    async get() {
      try {
        const store = JSON.parse(await readFile(file, "utf8"));
        if (!isValidStore(store)) throw new Error("Invalid stored trip data");
        return { store, version: null };
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return { store: emptyStore(), version: null };
        throw err;
      }
    },
    async put(store) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(store, null, 2));
      await rename(`${file}.tmp`, file);
      return true;
    },
  };
}

/** @type {import('./infra/handler.js').Assets} */
const siteAssets = {
  async read(name) {
    try {
      return new Uint8Array(await readFile(path.join(SITE_DIR, name)));
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && (err.code === "ENOENT" || err.code === "EISDIR")) return null;
      throw err;
    }
  },
};

/** @param {{dataFile: string, user: string, password: string}} options */
export function createApp({ dataFile, user, password }) {
  const handle = createHandler({ storage: fileStorage(dataFile), assets: siteAssets, user, password });
  return http.createServer(async (req, res) => {
    try {
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const headers = new Headers();
      for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
      /** @type {RequestInit & {duplex: 'half'}} */
      const init = {
        method: req.method,
        headers,
        // Node and DOM declare the same web stream API with different generic details.
        body: hasBody ? /** @type {ReadableStream<Uint8Array>} */ (/** @type {unknown} */ (Readable.toWeb(req))) : undefined,
        duplex: "half",
      };
      const request = new Request(`http://${req.headers.host || "localhost"}${req.url}`, init);
      const response = await handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad request");
    }
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
    console.log(`Time and Place: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
    console.log(`Login: ${user} / ${process.env.ADMIN_PASSWORD ? "(from ADMIN_PASSWORD)" : "changeme"}`);
    console.log(`Data:  ${dataFile}`);
  });
}
