/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value @returns {value is string[]} */
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
/** @param {unknown} value */
const text = (value) => typeof value === 'string' && value.trim().length > 0;
/** @param {Record<string, unknown>} value @param {string[]} fields */
const optionalText = (value, fields) => fields.every((key) => value[key] === undefined || typeof value[key] === 'string');
/** @param {Record<string, unknown>} value @param {string[]} fields */
const optionalFlags = (value, fields) => fields.every((key) => value[key] === undefined || typeof value[key] === 'boolean');
/** @param {unknown} value @returns {value is string} */
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
/** @param {unknown} value */
const time = (value) => value === undefined || value === '' || (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
/** @param {unknown} value */
function timestamp(value) {
  if (value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;
  const parts = value.split('T');
  return date(parts[0]) && (parts.length === 1 || (parts.length === 2 && parts[1] !== '' && time(parts[1])));
}
/** @param {unknown[]} items */
function uniqueIds(items) {
  const ids = items.map((item) => record(item) ? item.id : undefined);
  return ids.every(text) && new Set(ids).size === ids.length;
}

/**
 * Validate untrusted API/import data, including every field consumed by formatters.
 * @param {unknown} value
 * @returns {value is import('./models.js').Store}
 */
export function isValidStore(value) {
  if (!record(value) || !Number.isInteger(value.rev) || Number(value.rev) < 0
    || !Array.isArray(value.people) || !Array.isArray(value.trips)) return false;
  if (!uniqueIds(value.people) || !uniqueIds(value.trips)) return false;
  if (!value.people.every((p) => record(p) && text(p.name) && typeof p.adult === 'boolean')) return false;
  const people = new Set(value.people.map((p) => p.id));
  const tokens = new Set();
  return value.trips.every((trip) => {
    if (!record(trip) || !text(trip.name) || !date(trip.startDate) || !date(trip.endDate)
      || trip.endDate < trip.startDate || !optionalText(trip, ['destination'])
      || !strings(trip.peopleIds) || new Set(trip.peopleIds).size !== trip.peopleIds.length
      || !trip.peopleIds.every((id) => people.has(id))
      || !Array.isArray(trip.lodging) || !Array.isArray(trip.activities)
      || !uniqueIds(trip.lodging) || !uniqueIds(trip.activities)) return false;
    const attendees = new Set(trip.peopleIds);
    if (!trip.lodging.every((l) => record(l) && text(l.name)
      && optionalText(l, ['address', 'confirmation', 'notes']) && timestamp(l.checkIn) && timestamp(l.checkOut))) return false;
    if (!trip.activities.every((a) => record(a) && text(a.title) && (a.date === '' || date(a.date))
      && time(a.time) && time(a.endTime) && optionalText(a, ['location', 'mapUrl', 'notes'])
      && optionalFlags(a, ['dining', 'museum', 'adultOnly']) && strings(a.attendeeIds)
      && new Set(a.attendeeIds).size === a.attendeeIds.length && a.attendeeIds.every((id) => attendees.has(id)))) return false;
    if (trip.shareToken === null) return true;
    if (typeof trip.shareToken !== 'string' || !/^[A-Za-z0-9_-]{22,64}$/.test(trip.shareToken) || tokens.has(trip.shareToken)) return false;
    tokens.add(trip.shareToken);
    return true;
  });
}
