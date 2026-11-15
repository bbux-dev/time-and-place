import { adultsOnly, webLink } from '../domain.js';

/**
 * Build the saved record independently of the editor DOM.
 * @param {Record<string, string>} values
 * @param {{id: string, attendeeIds: string[], people: import('../models.js').Person[]}} options
 * @returns {import('../models.js').Activity}
 */
export function buildActivity(values, { id, attendeeIds, people }) {
  const mapUrl = webLink(values.mapUrl);
  if (values.mapUrl && !mapUrl) throw new Error("That map link isn't a web address. Paste the link from your maps app's Share button.");
  const adultOnly = values.adultOnly === 'on';
  const unscheduled = values.dateTbd === 'on';
  return {
    id, title: values.title, date: unscheduled ? '' : values.date,
    time: unscheduled ? '' : values.time, endTime: unscheduled ? '' : values.endTime,
    location: values.location, mapUrl, notes: values.notes,
    dining: values.dining === 'on', museum: values.museum === 'on', adultOnly,
    attendeeIds: adultOnly ? adultsOnly(attendeeIds, people) : attendeeIds,
  };
}
