import 'dotenv/config';
import { App, LogLevel } from '@slack/bolt';
import { migrate } from './db/migrate.js';
import { kvSet } from './db/repos/kv.js';
import { registerListeners } from './listeners/index.js';

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
    migrate();
    await app.start();
    try {
      const auth = await app.client.auth.test();
      if (auth.user_id && typeof auth.user_id === 'string') {
        kvSet('bot_user_id', auth.user_id);
      }
      app.logger.info(`⚡️ Bolt app is running as ${auth.user} (${auth.user_id})!`);
    } catch (e) {
      app.logger.warn(`Could not cache bot_user_id: ${e}`);
      app.logger.info('⚡️ Bolt app is running!');
    }
  } catch (error) {
    app.logger.error('Failed to start the app', error);
  }
})();
