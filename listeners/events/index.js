import { appMentionCallback } from './app_mention.js';
import { memberJoinedCallback } from './member_joined.js';
import { messageImCallback } from './message_im.js';

/**
 * @param {import("@slack/bolt").App} app
 */
export const register = (app) => {
  app.event('app_mention', appMentionCallback);
  app.event('member_joined_channel', memberJoinedCallback);
  app.event('message', messageImCallback);
};
