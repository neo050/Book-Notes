/* db/firestore.js -------------------------------------------------- */
import { initializeApp, cert }    from 'firebase-admin/app';
import { getFirestore }           from 'firebase-admin/firestore';
import { readFileSync }           from 'node:fs';
import { dirname, join }          from 'node:path';
import { fileURLToPath }          from 'node:url';
import 'dotenv/config';           


const __dirname = dirname(fileURLToPath(import.meta.url));

const serviceAccount = process.env.FIREBASE_SA_JSON
  ? JSON.parse(Buffer.from(process.env.FIREBASE_SA_JSON, 'base64').toString('utf8'))
  : JSON.parse(
      readFileSync(
        process.env.GOOGLE_APPLICATION_CREDENTIALS              
          ?? join(__dirname, '../project-id-firebase-adminsdk.json'),         
        'utf8',
      ),
    );


initializeApp({ credential: cert(serviceAccount) });

if (process.env.FIRESTORE_EMULATOR_HOST) {
  firestore.settings({  ssl: false });
}


export const firestore = getFirestore();
