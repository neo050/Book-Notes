// cron.js – run with `node cron.js &` on Render
import cron from 'node-cron';
import { exec } from 'child_process';

 cron.schedule('0 3 1 * *', () => {
  console.log('⬇️  Monthly OL refresh');
  exec('node etl/download.js && node etl/load.js && node etl/embed.js', err => {
    if (err) console.error('Refresh error', err);
    else     console.log('Refresh complete ✔︎');
  });
});