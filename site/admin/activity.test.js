import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildActivity } from './activity.js';

test('unscheduling clears previous times while preserving type, location and permitted attendees', () => {
  const activity = buildActivity({ title: 'Museum supper', dateTbd: 'on', date: '2027-06-12', time: '19:00', endTime: '21:00', dining: 'on', museum: 'on', adultOnly: 'on', location: 'Museum cafe', mapUrl: 'maps.google.com/?q=museum', notes: 'Meet outside' }, {
    id: 'a', attendeeIds: ['adult', 'child'], people: [{ id: 'adult', name: 'Adult', adult: true }, { id: 'child', name: 'Child', adult: false }],
  });
  assert.equal(activity.date, ''); assert.equal(activity.time, ''); assert.equal(activity.endTime, '');
  assert.equal(activity.dining, true); assert.equal(activity.museum, true);
  assert.equal(activity.location, 'Museum cafe');
  assert.deepEqual(activity.attendeeIds, ['adult']);
  assert.equal(activity.mapUrl, 'https://maps.google.com/?q=museum');
});

test('invalid map links cannot be saved through the extracted activity builder', () => {
  assert.throws(() => buildActivity({ title: 'Test', mapUrl: 'javascript:alert(1)' }, { id: 'a', attendeeIds: [], people: [] }), /isn't a web address/);
});
