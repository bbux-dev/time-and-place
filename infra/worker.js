// Cloudflare Worker entry. Every request comes here first (assets run_worker_first),
// so the admin login guards the admin page as well as the data.
//
// Bindings, created by sst.config.ts:
//   Data                        R2 bucket holding store.json
//   ASSETS                      the site/ directory
//   SST_RESOURCE_AdminPassword  secret, set with `sst secret set AdminPassword`
//   ADMIN_USER                  admin login name

import { createHandler, r2Storage } from "./handler.js";

/** @typedef {{Data: import('./handler.js').Bucket, ASSETS: {fetch: (url: string) => Promise<Response>}, SST_RESOURCE_AdminPassword?: string, ADMIN_USER?: string}} Environment */
/** @param {Environment} env */
function adminPassword(env) {
  try {
    return JSON.parse(env.SST_RESOURCE_AdminPassword || "").value.trim() || null;
  } catch {
    return null;
  }
}

export default {
  /** @param {Request} request @param {Environment} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    // Never ask for the password over plain HTTP.
    if (url.protocol === "http:" && url.hostname !== "localhost") {
      url.protocol = "https:";
      return Response.redirect(url.href, 301);
    }
    const password = adminPassword(env);
    if (!password) return new Response("Admin password is not configured.", { status: 500 });

    const handle = createHandler({
      storage: r2Storage(env.Data),
      assets: {
        async read(name) {
          const found = await env.ASSETS.fetch(new URL(`/${name}`, url).href);
          return found.ok ? found.body : null;
        },
      },
      user: env.ADMIN_USER || "admin",
      password,
    });
    const response = await handle(request);
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
    return response;
  },
};
