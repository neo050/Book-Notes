/* services/books.js ------------------------------------------------ */
import { firestore } from '../db/firestore.js';
import { logger } from '../utils/logger.js';

const userDoc   = uid => firestore.collection('users').doc(uid);
const booksColl = uid => userDoc(uid).collection('books');

export const listBooks = async uid => {
  const t0 = Date.now();
  const snap = await booksColl(uid).orderBy('created', 'desc').get();
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  logger.info('books.list', { fn: 'listBooks', uid, count: data.length, ms: Date.now() - t0 });
  return data;
};

export const getBook = async (uid, id) => {
  const t0 = Date.now();
  const doc = await booksColl(uid).doc(id).get();
  const out = doc.exists ? { id: doc.id, ...doc.data() } : null;
  logger.info('books.get', { fn: 'getBook', uid, id, found: !!out, ms: Date.now() - t0 });
  return out;
};

export const addBook = (uid, book) =>
  booksColl(uid).add({ ...book, created: new Date() }).then(ref => { logger.info('books.add', { fn: 'addBook', uid, id: ref.id, title: book?.title }); return ref; });

export const updateBook = (uid, id, patch) => {
  if (!patch || !Object.keys(patch).length) {
    throw new Error('Empty update payload');
  }
  return booksColl(uid).doc(id).update(patch).then(() =>
    logger.info('books.update', { fn: 'updateBook', uid, id, fields: Object.keys(patch || {}) })
  );
};

export const deleteBook = (uid, id) =>
  booksColl(uid).doc(id).delete().then(() => logger.info('books.delete', { fn: 'deleteBook', uid, id }));
