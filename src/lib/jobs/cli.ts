import { getDb, resetDb } from '@/db/client';
import { runDueJobs } from './runner';

/** `npm run jobs:run` - one bounded batch, for local development and ad-hoc ops. */
const db = await getDb();
const summary = await runDueJobs(db, { worker: `cli-${process.pid}` });
console.log(JSON.stringify(summary));
await resetDb();
