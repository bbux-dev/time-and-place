import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidStore } from './validation.js';
import { parseImport } from './domain.js';

const store = () => ({ rev: 0, people: [{ id: 'p', name: 'Person', adult: true }], trips: [{ id: 't', name: 'Trip', startDate: '2027-06-12', endDate: '2027-06-18', peopleIds: ['p'], lodging: [{ id: 'l', name: 'Hotel' }], activities: [{ id: 'a', title: 'Activity', date: '', attendeeIds: ['p'] }], shareToken: null }] });

test('invalid imported values that previously crashed formatting are rejected', () => {
  for (const [field, bad] of [['time', 42], ['endTime', {}], ['date', '2027-02-30'], ['time', '25:00'], ['location', []], ['adultOnly', 'yes']]) {
    const data = store(); data.trips[0].activities[0][field] = bad;
    assert.equal(isValidStore(data), false, field);
    assert.throws(() => parseImport(JSON.stringify(data)), /damaged/, field);
  }
  for (const checkIn of [42, {}, '2027-02-30', '2027-06-12T25:00']) {
    const data = store(); data.trips[0].lodging[0].checkIn = checkIn;
    assert.equal(isValidStore(data), false);
  }
});

test('valid older records, unscheduled activities and calendar timestamps remain importable', () => {
  const data = store(); data.trips[0].lodging[0].checkIn = '2027-06-12T16:00';
  assert.equal(isValidStore(data), true);
  assert.equal(parseImport(JSON.stringify(data)).trips[0].activities[0].date, '');
});

test('duplicate ids and dangling references are rejected before saving', () => {
  const duplicate = store(); duplicate.people.push({ ...duplicate.people[0] });
  assert.equal(isValidStore(duplicate), false);
  const dangling = store(); dangling.trips[0].activities[0].attendeeIds = ['unknown'];
  assert.equal(isValidStore(dangling), false);
});
