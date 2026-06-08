import cron from 'node-cron';
import { kvGet } from '../db/repos/kv.js';
import { runForAll } from './reminders.js';

/**
 * Register all cron jobs. Called once at startup from app.js, after the DB is
 * migrated and the Bolt app has started (so `client` is live).
 *
 * Schedule + timezone are read from app_kv so they can be tuned without a code
 * change: `reminder_cron` (default daily 9am) and `default_timezone`. The
 * timezone default avoids DMing people at 3am when no zone is configured.
 *
 * @param {{ client: import('@slack/web-api').WebClient, logger?: any }} args
 * @returns {() => void} a stop function that cancels the scheduled jobs
 */
export function startSchedulers({ client, logger = console }) {
  const timezone = kvGet('default_timezone') || process.env.TZ || 'America/New_York';
  const expr = kvGet('reminder_cron') || '0 9 * * *';

  if (!cron.validate(expr)) {
    logger.error?.(`[scheduler] invalid reminder_cron '${expr}'; reminders NOT scheduled`);
    return () => {};
  }

  const reminderJob = cron.schedule(
    expr,
    async () => {
      try {
        logger.info?.('[scheduler] firing daily reminders');
        const results = await runForAll({ client });
        const ok = results.filter((r) => r.ok).length;
        logger.info?.(`[scheduler] reminders sent: ${ok}/${results.length}`);
      } catch (e) {
        logger.error?.(`[scheduler] reminder run failed: ${e instanceof Error ? e.message : e}`);
      }
    },
    { timezone },
  );

  logger.info?.(`[scheduler] daily reminders scheduled '${expr}' (${timezone})`);

  return () => {
    reminderJob.stop();
  };
}
