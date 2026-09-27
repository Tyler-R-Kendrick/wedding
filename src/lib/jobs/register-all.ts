import { registerAiPurgeJob } from '@/ai/session';
import { registerMediaJobs } from '@/domain/media/jobs';
import { registerMediaAiJobs } from '@/domain/mediaai/jobs';
import { registerRsvpJobs } from '@/domain/rsvp/email';
import { listJobTypes } from './handlers';
import { registerHousekeeping } from './housekeeping';

/**
 * Every job handler the app defines, registered in one place.
 *
 * Handlers register as a side effect of importing the module that defines them, and a runner can
 * only run the types registered in its own module graph. Each cron route used to import just the
 * modules it cared about, so `rsvp.send_confirmation` and `ai.purge_sessions` were registered by no
 * runner at all: RSVP confirmation emails never went out and AI sessions were never purged. Every
 * runner entry point (the three cron routes and `npm run jobs:run`) imports this module instead.
 *
 * A new `registerJobHandler` call belongs here too; `tests/integration/jobs-register-all.test.ts`
 * fails when a registration in `src/` is not reached from this file.
 *
 * Deliberately not re-exported from `./index`: the domain modules import `@/lib/jobs`, so a barrel
 * re-export would be an import cycle.
 */
export function registerAllJobHandlers(): readonly string[] {
  registerHousekeeping();
  registerAiPurgeJob();
  registerRsvpJobs();
  registerMediaJobs();
  registerMediaAiJobs();
  return listJobTypes();
}

registerAllJobHandlers();
