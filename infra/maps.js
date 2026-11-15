// Best-effort Google Maps previews. Google can change this undocumented format;
// return editable suggestions and fall back to the place name when details are absent.

export class MapsPreviewError extends Error {
/** @param {string} message @param {number} [status] */
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** @param {string} value */
function mapsUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new MapsPreviewError("Paste a Google Maps place link."); }
  const host = url.hostname;
  const allowed = host === "maps.app.goo.gl"
    || (host === "goo.gl" && url.pathname.startsWith("/maps/"))
    || (["google.com", "www.google.com", "maps.google.com"].includes(host)
      && (/^\/maps(?:\/|$)/.test(url.pathname) || (host === "maps.google.com" && url.pathname === "/")));
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port || !allowed) {
    throw new MapsPreviewError("Paste a Google Maps place link, such as maps.app.goo.gl/…");
  }
  return url;
}

/** @param {string} value */
function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, entity) => {
    if (entity.startsWith("#")) {
      const number = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
    }
    const entities = /** @type {Record<string,string>} */ ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" });
    return entities[entity.toLowerCase()] ?? match;
  });
}

/** @param {string} tag @returns {Record<string,string>} */
function attributes(tag) {
  /** @type {Record<string,string>} */
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

/** @param {string} html @param {string} name */
function meta(html, name) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    if ([attrs.property, attrs.name, attrs.itemprop].includes(name)) return attrs.content?.trim() || "";
  }
  return "";
}

/** @param {string} html @param {URL} pageUrl */
function previewUrl(html, pageUrl) {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    if (attrs.as !== "fetch" || attrs.rel !== "preload" || !attrs.href) continue;
    let url;
    try { url = new URL(attrs.href, pageUrl); } catch { continue; }
    if (url.origin === pageUrl.origin && url.pathname === "/maps/preview/place") return url;
  }
  return null;
}

const FOOD_CATEGORY = /\b(restaurant|cafe|café|coffee shop|tea house|bakery|bistro|diner|pizzeria|steakhouse|bar|pub|brewpub|food court|meal takeaway|meal delivery|ice cream shop|dessert shop)\b/i;

/** @param {string} html @param {string|URL} pageUrl @param {string} [previewText] */
export function parseMapsPlace(html, pageUrl, previewText = "") {
  const url = new URL(pageUrl);
  let title = meta(html, "og:title") || decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  title = title.replace(/\s*[-–|]\s*Google Maps\s*$/i, "").trim();
  if (/^Google Maps$/i.test(title)) title = "";
  if (!title) {
    try { title = decodeURIComponent(url.pathname.match(/\/maps\/place\/([^/]+)/)?.[1]?.replace(/\+/g, " ") || ""); }
    catch { /* an invalid place path is not a place name */ }
  }
  let location = meta(html, "streetAddress");
  const description = meta(html, "og:description");
  let categories = description.includes(" · ")
    ? description.split(" · ").filter((part) => part.length < 80 && !/[\d★☆]/.test(part))
    : [];
  // Only read known fields after checking their types; never execute scripts from Maps.
  try {
    const place = JSON.parse(previewText.replace(/^\)\]\}'\s*/, ""))?.[6];
    if (Array.isArray(place) && typeof place[11] === "string" && place[11].trim()) {
      title = place[11].trim();
      if (Array.isArray(place[2]) && place[2].every((v) => typeof v === "string")) location = place[2].join(", ");
      if (Array.isArray(place[13]) && place[13].every((v) => typeof v === "string")) categories = place[13];
    }
  } catch { /* missing or changed preview data: use ordinary page metadata */ }
  if (!title) throw new MapsPreviewError("Google Maps didn't expose a place name. Try another place link or enter the details manually.", 502);
  return {
    title: title.slice(0, 100),
    location: (location || title).slice(0, 120),
    category: categories.join(", ").slice(0, 160),
    dining: categories.length ? categories.some((category) => FOOD_CATEGORY.test(category)) : null,
    museum: categories.length ? categories.some((category) => /\bmuseum\b/i.test(category)) : null,
  };
}

/** @param {Response} response */
async function readLimited(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) throw new MapsPreviewError("This Maps preview is too large. Enter the activity details manually.", 502);
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
  }
}

/** @param {URL} url @param {typeof fetch} fetcher @param {AbortSignal} signal */
async function fetchMaps(url, fetcher, signal) {
  for (let hop = 0; hop < 6; hop++) {
    url = mapsUrl(url.href);
    const response = await fetcher(url.href, {
      redirect: "manual", signal,
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const target = response.headers.get("location");
      await response.body?.cancel();
      if (!target) break;
      const next = new URL(target, url);
      // Do not follow or attempt to bypass Google's automated-traffic/consent pages.
      // The last Maps URL may still contain a useful place name.
      if (next.protocol === "https:" && !next.username && !next.password && !next.port
        && ((["google.com", "www.google.com"].includes(next.hostname) && /^\/(sorry|consent)(\/|$)/.test(next.pathname))
          || next.hostname === "consent.google.com")) {
        return { url, text: "", blocked: true };
      }
      url = next;
      continue;
    }
    if (response.status === 403 || response.status === 429) {
      await response.body?.cancel();
      return { url, text: "", blocked: true };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new MapsPreviewError("Google Maps couldn't load that place. Try again or enter the details manually.", 502);
    }
    return { url, text: await readLimited(response) };
  }
  throw new MapsPreviewError("That Maps link redirected too many times. Paste the place's full Google Maps link instead.", 502);
}

/** @param {unknown} value @param {typeof fetch} [fetcher] @returns {Promise<import("../site/models.js").MapsPlace>} */
export async function previewMapsLink(value, fetcher = fetch) {
  if (typeof value !== "string" || value.length > 2048) throw new MapsPreviewError("Paste a Google Maps place link.");
  const original = mapsUrl(value.trim());
  const signal = AbortSignal.timeout(12_000);
  try {
    const page = await fetchMaps(original, fetcher, signal);
    let blocked = page.blocked;
    let preview = "";
    const detailsUrl = previewUrl(page.text, page.url);
    if (detailsUrl) {
      try {
        const details = await fetchMaps(detailsUrl, fetcher, signal);
        preview = details.text;
        blocked ||= details.blocked;
      }
      catch { /* place names in page metadata still work if the detail request fails */ }
    }
    let place;
    try { place = parseMapsPlace(page.text, page.url, preview); }
    catch (error) {
      if (blocked) throw new MapsPreviewError("Google Maps blocked the place preview. Open the link in Maps and fill in the activity manually.", 502);
      throw error;
    }
    return {
      ...place,
      mapUrl: original.href,
      ...(blocked ? { warning: "Google Maps blocked the full preview. The place name was filled; check the address and activity type before saving." } : {}),
    };
  } catch (error) {
    if (error instanceof MapsPreviewError) throw error;
    throw new MapsPreviewError("Couldn't reach Google Maps. Try again or enter the activity details manually.", 502);
  }
}
