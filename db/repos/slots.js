import { db } from '../index.js';

const upsertStmt = db.prepare(
  `INSERT INTO hivemate_profile_slots (slack_user_id, slot_name, value, updated_at)
   VALUES (?, ?, ?, strftime('%s','now'))
   ON CONFLICT(slack_user_id, slot_name) DO UPDATE SET
     value = excluded.value,
     updated_at = excluded.updated_at`,
);

const listStmt = db.prepare(
  'SELECT slot_name, value FROM hivemate_profile_slots WHERE slack_user_id = ?',
);

/**
 * Idempotent upsert of a single slot value for a Hivemate.
 * @param {string} userId
 * @param {string} slotName
 * @param {string} value
 */
export function upsertSlot(userId, slotName, value) {
  upsertStmt.run(userId, slotName, value);
}

/**
 * @param {string} userId
 * @returns {Record<string, string>} { slotName: value, ... } for this user
 */
export function listSlots(userId) {
  const rows = /** @type {{slot_name: string, value: string}[]} */ (listStmt.all(userId));
  /** @type {Record<string, string>} */
  const out = {};
  for (const r of rows) out[r.slot_name] = r.value;
  return out;
}

/**
 * @param {string} userId
 * @param {string[]} required - list of required slot names
 * @returns {string[]} slots in `required` that are not yet filled
 */
export function getMissingSlots(userId, required) {
  const filled = listSlots(userId);
  return required.filter((s) => !(s in filled) || filled[s] === '');
}
