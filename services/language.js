import { francAll } from 'franc-min';
import { getHivemate, setLanguage } from '../db/repos/hivemates.js';

/**
 * Deterministic, pre-LLM language handling.
 *
 * Language should be sticky and observable in the DB so every downstream
 * feature (nudges, keeper digests) speaks the right language without re-asking
 * the model. There are two signals, in priority order:
 *
 *   1. The Hivemate's STATED preference — the `language` onboarding slot
 *      ("English", "Español", …). This is authoritative: they told us. Map it
 *      to an ISO code with `languageNameToCode`.
 *   2. franc-min over their recent turns, as a fallback before a preference is
 *      stated. franc is unreliable on short text — it will read "I prefer
 *      English please" as Spanish — so we (a) constrain it to the supported
 *      languages, (b) require a decent amount of text, and (c) bail when the
 *      runner-up is too close. When unsure we leave the stored value alone,
 *      which keeps the default (English) and prevents one noisy message from
 *      flipping an established language.
 */

// franc on short text is a coin flip (deceptive trigrams). Below this many
// characters we don't trust it at all and fall back to the stored language /
// the stated slot. Short answers like "English please" stay on the default
// until the `language` slot is saved, which is the reliable signal anyway.
const MIN_CHARS = 24;

/**
 * Stated language preferences → ISO 639-3, matched by keyword so the LLM's
 * paraphrase ("English", "habla español", "Português") still resolves. Only
 * the demo languages are mapped richly; extend as the Hive grows.
 * @type {Array<[string, string[]]>}
 */
const LANGUAGE_KEYWORDS = [
  ['eng', ['english', 'inglés', 'ingles']],
  ['spa', ['spanish', 'español', 'espanol', 'castellano']],
  ['por', ['portuguese', 'português', 'portugues']],
  ['fra', ['french', 'français', 'francais']],
  ['deu', ['german', 'deutsch', 'alemán', 'aleman']],
];

/**
 * ISO 639-3 → human name, for prompting the model which language to write in.
 * @type {Record<string, string>}
 */
const CODE_TO_NAME = {
  eng: 'English',
  spa: 'Spanish',
  por: 'Portuguese',
  fra: 'French',
  deu: 'German',
};

/**
 * Human-readable language name for a stored code. Falls back to English so a
 * missing/unknown code never leaves the model without an instruction.
 *
 * @param {string | null | undefined} code
 * @returns {string}
 */
export function languageName(code) {
  return CODE_TO_NAME[(code ?? '').toLowerCase()] ?? 'English';
}

/**
 * Map a stated language preference to an ISO 639-3 code. Returns null if the
 * value doesn't clearly name a language we recognize.
 *
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function languageNameToCode(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.toLowerCase();
  for (const [code, keywords] of LANGUAGE_KEYWORDS) {
    if (keywords.some((k) => v.includes(k))) return code;
  }
  return null;
}

/**
 * The languages the Hive supports, as ISO 639-3 codes. franc is constrained to
 * this set, which is the single most important accuracy lever: unconstrained,
 * franc-min happily misreads a short English sentence as Uzbek. The sprint demo
 * is English + Spanish; override with HIVE_LANGUAGES (comma-separated 639-3
 * codes, e.g. "eng,spa,por") to widen the set — but every added language is a
 * fresh chance for a near-neighbor misdetection on short text, so keep it tight.
 */
export const SUPPORTED_LANGUAGES = (process.env.HIVE_LANGUAGES || 'eng,spa')
  .split(',')
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

// If the runner-up scores nearly as high as the winner, the text is too
// ambiguous to commit to. Scores are normalized so the winner is always 1.
const MAX_RUNNERUP = 0.95;

/**
 * Detect the language of some text(s).
 *
 * @param {string | string[]} texts - one string or several user turns
 * @param {{ minChars?: number, only?: string[] }} [opts]
 * @returns {string | null} ISO 639-3 code (e.g. 'eng', 'spa'), or null if not confident
 */
export function detectLanguage(texts, { minChars = MIN_CHARS, only = SUPPORTED_LANGUAGES } = {}) {
  const combined = (Array.isArray(texts) ? texts : [texts])
    .filter((t) => typeof t === 'string')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (combined.length < minChars) return null;

  const ranked = francAll(combined, { only });
  const [top, runnerUp] = ranked;
  if (!top || top[0] === 'und') return null;
  if (runnerUp && runnerUp[0] !== 'und' && runnerUp[1] >= MAX_RUNNERUP) return null;
  return top[0];
}

/**
 * Detect the language of a Hivemate's recent turns and persist it if it has
 * confidently changed. Returns the language now in effect for the Hivemate
 * (the freshly-detected one, or the existing stored value if no new signal).
 *
 * Combining several recent user turns (rather than only the latest message)
 * is intentional: it keeps the read stable across a short reply that follows
 * a longer one in the same language.
 *
 * @param {string} userId
 * @param {string | string[]} recentUserTexts
 * @returns {string | null} the language code in effect, or null if unknown
 */
export function maybeUpdateLanguage(userId, recentUserTexts) {
  const detected = detectLanguage(recentUserTexts);
  const current = getHivemate(userId)?.language ?? null;

  if (detected && detected !== current) {
    setLanguage(userId, detected);
    return detected;
  }
  return current;
}
