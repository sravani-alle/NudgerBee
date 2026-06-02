-- Nudger Bee schema. Idempotent: every CREATE uses IF NOT EXISTS so this file
-- runs unchanged on every startup via db/migrate.js.

-- One row per Slack user who has ever interacted with the bee.
CREATE TABLE IF NOT EXISTS hivemates (
  slack_user_id        TEXT PRIMARY KEY,
  slack_team_id        TEXT NOT NULL,
  language             TEXT NOT NULL DEFAULT 'eng',         -- ISO 639-3 from franc-min
  timezone             TEXT,
  onboarding_state     TEXT NOT NULL DEFAULT 'new',         -- 'new' | 'in_progress' | 'complete'
  cohort_key           TEXT,                                -- slug::slug, set on Phase C
  profile_json         TEXT NOT NULL DEFAULT '{}',          -- consolidated profile after complete_onboarding
  last_active_at       INTEGER,                             -- unix seconds; updated by activity provider
  dormant_since        INTEGER,
  dormancy_notified_at INTEGER,
  honey_streak         INTEGER NOT NULL DEFAULT 0,          -- consecutive check-in days
  last_checkin_at      INTEGER,
  joined_at            INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- Per-field accumulation during conversational onboarding.
-- JS owns the slot list; the LLM saves one field at a time via save_hivemate_profile_slot.
CREATE TABLE IF NOT EXISTS hivemate_profile_slots (
  slack_user_id TEXT NOT NULL,
  slot_name     TEXT NOT NULL,                             -- 'language' | 'condition' | 'role' | 'goals' | 'consent'
  value         TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (slack_user_id, slot_name),
  FOREIGN KEY (slack_user_id) REFERENCES hivemates(slack_user_id) ON DELETE CASCADE
);

-- Cohort -> Slack channel mapping (one private channel per cohort_key).
CREATE TABLE IF NOT EXISTS channels (
  cohort_key       TEXT PRIMARY KEY,
  slack_channel_id TEXT NOT NULL UNIQUE,
  slack_team_id    TEXT NOT NULL,
  display_name     TEXT,
  created_at       INTEGER NOT NULL
);

-- Hivemate membership in cohort channels.
CREATE TABLE IF NOT EXISTS memberships (
  slack_user_id    TEXT NOT NULL,
  slack_channel_id TEXT NOT NULL,
  joined_at        INTEGER NOT NULL,
  PRIMARY KEY (slack_user_id, slack_channel_id)
);

-- Hivemate check-ins (meds, food, mood, free text).
CREATE TABLE IF NOT EXISTS checkins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_user_id TEXT NOT NULL,
  kind          TEXT NOT NULL,                              -- 'meds' | 'food' | 'mood' | 'text' | 'photo'
  content       TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkins_user_time ON checkins(slack_user_id, created_at);

-- Every outbound nudge the bee sends. Powers anti-repetition (template_id round-robin)
-- and the demo's "escalation visible" story (kind='escalation').
CREATE TABLE IF NOT EXISTS nudge_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_user_id    TEXT NOT NULL,
  slack_channel_id TEXT,
  kind             TEXT NOT NULL,                          -- 'reminder' | 'streak' | 'escalation' | 'welcome' | 'silence_keeper'
  template_id      INTEGER,
  message          TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nudge_log_user_time ON nudge_log(slack_user_id, created_at);

-- Scheduled reminders per Hivemate. node-cron picks these up on startup.
CREATE TABLE IF NOT EXISTS reminders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_user_id   TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  timezone        TEXT,
  kind            TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,              -- boolean
  created_at      INTEGER NOT NULL
);

-- Generic key/value: bot_user_id, landing_channel, keeper:{cohort_key}, channel_cursor:{channel_id}, etc.
CREATE TABLE IF NOT EXISTS app_kv (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
