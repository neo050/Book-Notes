import session              from 'express-session';
import ConnectFirestore     from 'connect-session-firestore';
import { firestore }        from '../db/firestore.js';

const RawStore = ConnectFirestore(session);

export default class SafeFirestoreStore extends RawStore {
  set(sid, sess, cb = () => {}) {
    const plain = JSON.parse(JSON.stringify(sess));
    super.set(sid, plain, errOrRes => {
      if (errOrRes instanceof Error) return cb(errOrRes);
      cb(null);
    });
  }
}

export const storeInstance = new SafeFirestoreStore({ database: firestore });
