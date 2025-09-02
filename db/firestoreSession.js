import session from 'express-session';
import { firestore } from './firestore.js';

const COLL = firestore.collection('sessions');

function toPlain(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getExpiry(sess) {
  // express-session provides either cookie.expires (Date | string) or cookie.maxAge (ms)
  const c = sess?.cookie || {};
  if (c.expires) return new Date(c.expires);
  const ms = typeof c.maxAge === 'number' ? c.maxAge : 864e5; // default 1 day
  return new Date(Date.now() + ms);
}

export default class FirestoreSessionStore extends session.Store {
  constructor() {
    super();
  }

  async get(sid, cb = () => {}) {
    try {
      const snap = await COLL.doc(sid).get();
      if (!snap.exists) return cb(null, null);
      const data = snap.data();
      const raw = data?.expires;
      const expires = raw?.toDate ? raw.toDate() : (raw ? new Date(raw) : null);
      if (expires && expires <= new Date()) {
        await COLL.doc(sid).delete().catch(() => {});
        return cb(null, null);
      }
      return cb(null, data?.data || null);
    } catch (e) {
      cb(e);
    }
  }

  async set(sid, sess, cb = () => {}) {
    try {
      const expires = getExpiry(sess);
      await COLL.doc(sid).set({
        data: toPlain(sess),
        expires, // store as Date; Firestore will coerce
        updatedAt: new Date(),
      }, { merge: true });
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  async destroy(sid, cb = () => {}) {
    try {
      await COLL.doc(sid).delete();
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  async touch(sid, sess, cb = () => {}) {
    try {
      const expires = getExpiry(sess);
      await COLL.doc(sid).set({
        expires,
        updatedAt: new Date(),
      }, { merge: true });
      cb(null);
    } catch (e) {
      cb(e);
    }
  }
}

export const storeInstance = new FirestoreSessionStore();
