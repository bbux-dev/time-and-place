// Local server: runs the shared handler (infra/handler.js) on Node, with the site/ folder
// for pages and one JSON file as the database. Production runs the same handler in a
// Cloudflare Worker with an R2 object instead (infra/worker.js).

import http from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHandler } from "./infra/handler.js";
import { emptyStore } from "./site/domain.js";

const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");

function fileStorage(file) {
  return {
    async get() {
      try {
        return { store: JSON.parse(await readFile(file, "utf8")), version: null };
      } catch (err) {
        if (err.code === "ENOENT") return { store: emptyStore(), version: null };
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

const siteAssets = {
  async read(name) {
    try {
      return await readFile(path.join(SITE_DIR, name));
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "EISDIR") return null;
      throw err;
    }
  },
};

export function createApp({ dataFile, user, password }) {
  const handle = createHandler({ storage: fileStorage(dataFile), assets: siteAssets, user, password });
  return http.createServer(async (req, res) => {
    try {
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(`http://${req.headers.host || "localhost"}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: "half",
      });
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
