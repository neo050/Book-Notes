/* db/firestore.js -------------------------------------------------- */
import 'dotenv/config';
const useMemory = process.env.NODE_ENV === 'test' || process.env.USE_MEMORY_FIRESTORE === '1';

let firestore, FieldValue, Timestamp;

if (useMemory) {
  const mem = await import('./memory.js');
  firestore = mem.firestore; FieldValue = mem.FieldValue; Timestamp = mem.Timestamp;
} else {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldValue: FV, Timestamp: TS } = await import('firebase-admin/firestore');
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const serviceAccount = process.env.FIREBASE_SA_JSON
    ? JSON.parse(Buffer.from(process.env.FIREBASE_SA_JSON, 'base64').toString('utf8'))
    : JSON.parse(
        readFileSync(
          process.env.GOOGLE_APPLICATION_CREDENTIALS ?? join(__dirname, '../project-id-firebase-adminsdk.json'),
          'utf8',
        ),
      );
  initializeApp({ credential: cert(serviceAccount) });
  firestore = getFirestore();
  FieldValue = FV; Timestamp = TS;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    firestore.settings({ host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false });
  }
}

export { firestore, FieldValue, Timestamp };
