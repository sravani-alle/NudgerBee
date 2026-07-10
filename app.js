import 'dotenv/config';
import { App, LogLevel } from '@slack/bolt';
import { connectMcp, disconnectMcp } from './agent/mcp-client.js';
import { migrate } from './db/migrate.js';
import { kvSet } from './db/repos/kv.js';
import { registerListeners } from './listeners/index.js';
import { startSchedulers } from './scheduler/index.js';

// Initialize the Bolt app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.DEBUG,
  clientOptions: {
    slackApiUrl: process.env.SLACK_API_URL || 'https://slack.com/api',
  },
});

// Register the action and event listeners
registerListeners(app);

// Start the Bolt app
(async () => {
  try {
    // Build marker — bump when verifying a code change is actually live.
    // Look for this line in the run logs after restarting; if it's missing/older,
    // the process did not reload the latest code.
    console.log('🐝 Nudger Bee build: keeper-stats=plaintext-names-v3');
    migrate();
    await app.start();
    try {
      const auth = await app.client.auth.test();
      if (auth.user_id && typeof auth.user_id === 'string') {
        kvSet('bot_user_id', auth.user_id);
      }
      if (auth.team_id && typeof auth.team_id === 'string') {
        kvSet('team_id', auth.team_id);
      }
      app.logger.info(`⚡️ Bolt app is running as ${auth.user} (${auth.user_id})!`);
    } catch (e) {
      app.logger.warn(`Could not cache bot_user_id: ${e}`);
      app.logger.info('⚡️ Bolt app is running!');
    }

    // Register cron jobs (daily reminders, etc.) now that the client is live.
    startSchedulers({ client: app.client, logger: app.logger });

    // Connect the MCP program server (best-effort; the bee runs without it if
    // the server can't start). Its tools become available to onboarded DMs.
    await connectMcp({ logger: app.logger });
  } catch (error) {
    app.logger.error('Failed to start the app', error);
  }
})();

// Tear down the MCP child process on shutdown.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    await disconnectMcp();
    process.exit(0);
  });
}
