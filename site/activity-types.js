// Labels and icons shared by the editor, itinerary, and public sample.
/** @type {{id: import("./models.js").ActivityType, label: string, path: string}[]} */
export const ACTIVITY_TYPES = [
  { id: "dining", label: "Dining", path: "M4 3v5a3 3 0 0 0 6 0V3M7 3v19M20 22V3c-4 0-6 5-6 9h6" },
  { id: "museum", label: "Museum", path: "m3 9 9-6 9 6H3ZM4 21h16M6 12v6m4-6v6m4-6v6m4-6v6" },
];

/** @type {[import("./models.js").ActivityFilter, string][]} */
export const ACTIVITY_FILTERS = [["all", "All"], ["activities", "Activities"], ...ACTIVITY_TYPES.map(({ id, label }) => /** @type {[import("./models.js").ActivityFilter, string]} */ ([id, label]))];

/** @param {import("./models.js").ActivityType} id @param {boolean} [decorative] */
export function activityTypeIcon(id, decorative = false) {
  const type = ACTIVITY_TYPES.find((type) => type.id === id);
  if (!type) return "";
  return `<svg class="activity-type-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${decorative ? 'aria-hidden="true"' : `role="img" aria-label="${type.label}"`}>
    ${decorative ? "" : `<title>${type.label}</title>`}<path d="${type.path}" /></svg>`;
}

/** @param {import("./models.js").Activity} activity */
export function activityTypeIcons(activity) {
  return ACTIVITY_TYPES.filter(({ id }) => activity[id] === true).map(({ id }) => activityTypeIcon(id)).join(" ");
}
