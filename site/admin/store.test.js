import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStoreClient } from './store.js';

const seed = () => ({ rev: 0, people: [], trips: [] });
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('queued edits survive in-flight successful saves and carry the new revision', async () => {
  const held = deferred();
  const writes = [];
  const client = createStoreClient({ fetcher: async (_url, options) => {
    if (!options) return Response.json(seed());
    writes.push(JSON.parse(options.body));
    return writes.length === 1 ? held.promise : Response.json({ rev: 2 });
  } });
  await client.load();
  const done = client.commit({ ...client.getState(), people: [{ id: 'a', name: 'One', adult: true }] });
  client.commit({ ...client.getState(), people: [...client.getState().people, { id: 'b', name: 'Two', adult: true }] });
  held.resolve(Response.json({ rev: 1 }));
  await done;
  assert.deepEqual(writes.map((write) => [write.rev, write.people.length]), [[0, 1], [1, 2]]);
  assert.equal(client.getState().rev, 2);
});

test('a conflict preserves local edits and stops queued saves and retries', async () => {
  const held = deferred();
  const messages = [];
  let writes = 0;
  let successes = 0;
  const client = createStoreClient({
    fetcher: async (_url, options) => { if (!options) return Response.json(seed()); writes++; return held.promise; },
    onError: (message, retry) => messages.push({ message, retry }), onSaved: () => successes++,
  });
  await client.load();
  const done = client.commit({ ...client.getState(), people: [{ id: 'a', name: 'One', adult: true }] });
  client.commit({ ...client.getState(), people: [...client.getState().people, { id: 'b', name: 'Two', adult: true }] });
  held.resolve(Response.json({ error: 'Stale', store: { ...seed(), rev: 1 } }, { status: 409 }));
  await done;
  await client.retry();
  assert.equal(writes, 1);
  assert.equal(successes, 0);
  assert.equal(client.getState().people.length, 2);
  assert.equal(messages[0].retry, false);
  assert.match(messages[0].message, /saving is paused/);
  await client.commit({ ...client.getState(), people: [...client.getState().people, { id: 'c', name: 'Three', adult: true }] });
  assert.equal(writes, 1);
  assert.equal(client.getState().people.length, 3);
  assert.equal(messages.length, 2, 'further edits must remind the user that saving is paused');
});

test('network or malformed-response failures can be retried with the latest local edits', async () => {
  for (const failure of ['network', 'json', 'server']) {
    let broken = true;
    const messages = [];
    const client = createStoreClient({
      fetcher: async (_url, options) => {
        if (!options) return Response.json(seed());
        if (!broken) return Response.json({ rev: 1 });
        if (failure === 'network') throw new Error('offline');
        return failure === 'json' ? new Response('not json') : new Response('unavailable', { status: 503 });
      }, onError: (message, retry) => messages.push({ message, retry }),
    });
    await client.load();
    await client.commit({ ...client.getState(), people: [{ id: 'a', name: 'One', adult: true }] });
    assert.equal(messages[0].retry, true);
    broken = false;
    await client.retry();
    assert.equal(client.getState().rev, 1);
    assert.equal(client.getState().people.length, 1);
  }
});

test('load rejects invalid server data before it can reach rendering', async () => {
  const client = createStoreClient({ fetcher: async () => Response.json({ rev: 0, people: 'broken', trips: [] }) });
  await assert.rejects(client.load(), /Invalid trip data/);
});
