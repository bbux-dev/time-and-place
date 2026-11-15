# Trip Planner

Plan a group trip: who is coming, where you are staying, and who is going to which activity.
One admin edits behind a login; everyone else gets a read-only share link.

Local prototype. Plain HTML, CSS and JavaScript with no build step and no dependencies.

## Run

```sh
pnpm dev        # or: node server.mjs
```

Open <http://127.0.0.1:4181> and log in with `admin` / `changeme`.
Copy `.env.example` to `.env` to set your own login, or to set `HOST=0.0.0.0` so phones on the same Wi-Fi can open a share link.

```sh
pnpm test       # rules, share-link privacy, login and save behavior
pnpm check      # syntax
```

## How it works

- **Admin** (`/`): HTTP basic auth. Create a trip, tap saved people onto it, add lodging and activities.
  A new activity starts with everyone on the trip; "Adults only (21+)" takes the under-21 people off.
- **Share link** (`/s/<token>`): no login. Shows one trip and the first names on it. The token is random,
  made when you press **Create share link**; **New link** or **Stop sharing** kills the old one.
- **PWA**: both pages can be added to a phone's home screen. A shared itinerary installs as its own app and,
  once it has loaded, still opens without signal (showing the last copy). The admin page is never cached.
  Offline support needs HTTPS or `localhost`, so it starts working for phones once the site is hosted.
- **Data**: one JSON file, `data/store.json` (git-ignored), read and written whole. Each save carries a revision
  number, so a stale tab cannot overwrite newer changes.

## Structure

- `server.mjs`: static files, login, share links, and `fileStorage` (the piece to swap for an R2/S3 object).
- `site/domain.js`: trip rules and formatting, shared by both pages and the server.
- `site/app.js` + `index.html`: the admin page.
- `site/share.js` + `share.html`: the shared itinerary.
- `site/share-sw.js`: offline copy of shared itineraries (network first).
- `site/styles.css`: phone-sized layout, light and dark.
