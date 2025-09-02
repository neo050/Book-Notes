import test from 'node:test';
import assert from 'node:assert/strict';
// No external mocks needed; app's db/firestore.js uses memory in NODE_ENV=test

process.env.NODE_ENV = 'test';
test('FirestoreSessionStore set/get/destroy/touch with expiry', async () => {
  const mod = await import('../db/firestoreSession.js');
  const StoreClass = mod.default;
  const store = new StoreClass();

  const sid = 'SID1';
  const sessionObj = { cookie: { maxAge: 3600_000 }, user: { id: 'u@example.com' } };

  // set
  await new Promise((res, rej) => store.set(sid, sessionObj, err => err ? rej(err) : res()));

  // get
  const got = await new Promise((res, rej) => store.get(sid, (err, s) => err ? rej(err) : res(s)));
  assert.equal(got.user.id, 'u@example.com');

  // touch extends expiry (no error)
  await new Promise((res, rej) => store.touch(sid, sessionObj, err => err ? rej(err) : res()));

  // destroy
  await new Promise((res, rej) => store.destroy(sid, err => err ? rej(err) : res()));
  const after = await new Promise((res, rej) => store.get(sid, (err, s) => err ? rej(err) : res(s)));
  assert.equal(after, null);

  // Expired should return null and delete doc
  const sid2 = 'SID2';
  const expired = { cookie: { expires: new Date(Date.now() - 1000) }, user: { id: 'x' } };
  await new Promise((res, rej) => store.set(sid2, expired, err => err ? rej(err) : res()));
  const got2 = await new Promise((res, rej) => store.get(sid2, (err, s) => err ? rej(err) : res(s)));
  assert.equal(got2, null);
});
