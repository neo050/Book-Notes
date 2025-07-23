import session              from 'express-session';
import ConnectFirestore     from 'connect-session-firestore';
import { firestore }        from './firestore.js';

const RawStore = ConnectFirestore(session);

function swallowWriteResult(cb) {
  return resOrErr => {
    if (resOrErr instanceof Error) return cb(resOrErr); // real error
    cb(null);                                           // success
  };
}

export default class SafeFirestoreStore extends RawStore {
  set(sid, sess, cb = () => {}) {
    const plain = JSON.parse(JSON.stringify(sess));     // strip prototype
    super.set(sid, plain, swallowWriteResult(cb));
  }

  destroy(sid, cb = () => {}) {
    super.destroy(sid, swallowWriteResult(cb));
  }

  touch(sid, sess, cb = () => {}) {
    // not strictly required by express-session, but some libs call it
    super.touch(sid, sess, swallowWriteResult(cb));
  }
}

export const storeInstance = new SafeFirestoreStore({ database: firestore });
