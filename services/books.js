/* services/books.js ------------------------------------------------ */
import { firestore } from '../db/firestore.js';
import { FieldValue } from 'firebase-admin/firestore';

const userDoc   = uid => firestore.collection('users').doc(uid);
const booksColl = uid => userDoc(uid).collection('books');

export const listBooks = async uid => {
  const snap = await booksColl(uid).orderBy('created', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const getBook = async (uid, id) => {
  const doc = await booksColl(uid).doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
};

export const addBook = (uid, book) =>
  booksColl(uid).add({ ...book, created: FieldValue.serverTimestamp() });

export const updateBook = (uid, id, patch) =>
  booksColl(uid).doc(id).update(patch);

export const deleteBook = (uid, id) =>
  booksColl(uid).doc(id).delete();