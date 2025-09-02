import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';

test('books service CRUD with ordering', async () => {
  const booksSvc = await import('../services/books.js');
  const { listBooks, getBook, addBook, updateBook, deleteBook } = booksSvc;

  const uid = 'user@example.com';

  // Initially empty
  assert.deepEqual(await listBooks(uid), []);

  // Add two books
  const ref1 = await addBook(uid, { title: 'Alpha', author_name: 'A', rating: 7 });
  assert.ok(ref1 && ref1.id);
  const ref2 = await addBook(uid, { title: 'Beta', author_name: 'B', rating: 8 });
  assert.ok(ref2 && ref2.id);

  // listBooks ordered by created desc (ref2 first)
  const list1 = await listBooks(uid);
  assert.equal(list1.length, 2);
  assert.equal(list1[0].title, 'Beta');
  assert.equal(list1[1].title, 'Alpha');

  // getBook
  const b1 = await getBook(uid, ref1.id);
  assert.equal(b1.title, 'Alpha');
  assert.equal(b1.rating, 7);

  // updateBook
  await updateBook(uid, ref1.id, { rating: 9, introduction: 'Nice' });
  const b1u = await getBook(uid, ref1.id);
  assert.equal(b1u.rating, 9);
  assert.equal(b1u.introduction, 'Nice');

  // deleteBook
  await deleteBook(uid, ref2.id);
  const list2 = await listBooks(uid);
  assert.equal(list2.length, 1);
  assert.equal(list2[0].id, ref1.id);
});
