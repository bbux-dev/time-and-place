# Changelog

## v1.0 — 2026-11-15

First release of **Time and Place**, a group trip activity coordinator.

### Added

- Trips with dates, destinations, saved people, lodging, and activity attendance.
- Lodging check-in and check-out times, addresses, confirmation details, and notes.
- Dated activities with optional start and end times, locations, map links, and notes.
- Unscheduled activities with **Date TBD**, a separate board section, and a **Schedule** action;
  dated activities can also move back to Unscheduled.
- Independent **Dining** and **Museum** pills, matching activity icons, and **All / Activities /
  Dining / Museum** filters on admin and shared itineraries.
- **From Maps** quick-add: suggest the place name, address, and activity types from a Google Maps
  link, then review and save. Lookups do not save activities automatically.
- Default attendance for everyone on a trip, individual attendee selection, and a **21+** option
  that excludes under-21 people.
- Read-only share links that can be replaced or revoked, plus name selection to highlight each
  person's activities.
- Today, Now, and Up next indicators, with completed activities and past days fading back.
- Installable admin and shared views, offline access to previously loaded shared itineraries,
  and layouts for phones with light and dark themes.
- JSON export and import for all trips, people, and share links.
- A public fictional sample itinerary: the Simpsons visit Middle-earth, including dining,
  museum visits, and unscheduled adventures, separate from real trip data.
- Local Node hosting and Cloudflare Worker hosting with a private R2 store, daily backup copies,
  and revision checks to prevent stale saves from overwriting newer changes.

### Changed

- Renamed the app from **Trip Planner** to **Time and Place**, including page titles,
  installation metadata, login prompts, export filenames, and documentation.
- Made linked activity locations clickable on the shared itinerary, using the map URL itself
  when no location name is available.

### Fixed

- Google automated-traffic and consent redirects no longer discard an available place name.
  When detailed metadata is blocked, use the resolved place name and clearly identify the
  details that need manual review; do not follow or bypass challenge pages.
- Maps lookup and form errors now appear in a visible banner at the top of the activity editor.
- Failed saves now show a persistent admin banner with **Retry save**; successful retries clear
  the banner, and save errors no longer prevent later save attempts.
- Admin loading errors and conflicting saves now have persistent, dismissible error messages.
