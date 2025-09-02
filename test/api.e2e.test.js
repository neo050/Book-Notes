import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
process.env.NODE_ENV = 'test';

// Prepare env for app import
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';

// In-memory Firestore + FieldValue
// Use the app's memory Firestore instance
const { firestore } = await import('../db/firestore.js');

// Import the app after mocks
const { app } = await import('../index.js');

function agent() {
  return supertest.agent(app);
}

async function getCsrf(t) {
  const res = await t.get('/api/csrf-token');
  assert.equal(res.status, 200);
  return res.body.csrfToken;
}

test('unauthorized API is 401', async () => {
  const t = agent();
  const res = await t.get('/api/books');
  assert.equal(res.status, 401);
});

test('local auth + CRUD flow with CSRF', async () => {
  const t = agent();
  // Seed a user
  const email = 'user@test.com';
  const hash = await bcrypt.hash('Password1', 10);
  await firestore.collection('users').doc(email).set({ email, password: hash });

  // login
  const csrf1 = await getCsrf(t);
  const loginRes = await t
    .post('/login')
    .set('Accept', 'application/json')
    .type('form')
    .send({ _csrf: csrf1, username: email, password: 'Password1' });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.ok, true);

  // Initially empty list
  const list0 = await t.get('/api/books');
  assert.equal(list0.status, 200);
  assert.deepEqual(list0.body, []);

  // Create book
  const csrf2 = await getCsrf(t);
  const createRes = await t
    .post('/api/books')
    .set('Accept', 'application/json')
    .send({
      author_name: 'Author',
      title: 'My Book',
      rating: 8,
      introduction: 'Intro',
      notes: 'Notes',
      end_date: '2025-01-01',
      _csrf: csrf2,
    });
  assert.equal(createRes.status, 201);
  const id = createRes.body.id;
  assert.ok(id);

  // Get book
  const getRes = await t.get(`/api/books/${id}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.title, 'My Book');
  assert.equal(getRes.body.author_name, 'Author');
  assert.equal(getRes.body.end_date, '2025-01-01');
  assert.ok(typeof getRes.body.cover_i !== 'undefined');

  // Update partial fields, ensure others remain
  const csrf3 = await getCsrf(t);
  const upd = await t
    .put(`/api/books/${id}`)
    .set('Accept', 'application/json')
    .send({ rating: 9, _csrf: csrf3 });
  assert.equal(upd.status, 200);
  const after = await t.get(`/api/books/${id}`);
  assert.equal(after.body.rating, 9);
  assert.equal(after.body.title, 'My Book'); // unchanged

  // Delete requires CSRF
  const csrf4 = await getCsrf(t);
  const del = await t
    .delete(`/api/books/${id}`)
    .set('Accept', 'application/json')
    .send({ _csrf: csrf4 });
  assert.equal(del.status, 200);
  const list1 = await t.get('/api/books');
  assert.equal(list1.body.length, 0);
});

test('CSRF protection blocks state-changing requests without token', async () => {
  const t = agent();
  // login quick
  const email = 'user2@test.com';
  const hash = await bcrypt.hash('Password1', 10);
  await firestore.collection('users').doc(email).set({ email, password: hash });
  const csrf = await getCsrf(t);
  await t.post('/login').set('Accept', 'application/json').type('form').send({ _csrf: csrf, username: email, password: 'Password1' });

  // Missing CSRF on POST should be 403
  const badCreate = await t.post('/api/books').set('Accept', 'application/json').send({ author_name: 'A', title: 'T' });
  assert.equal(badCreate.status, 403);
});
