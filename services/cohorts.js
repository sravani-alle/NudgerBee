/**
 * Cohort derivation. A Hivemate's cohort is the bucket we use to group them
 * with peers in a similar situation. It's a deterministic slug built from
 * `condition` (optional) and `role`.
 *
 * The two slugs are joined with "::" rather than a single hyphen so that
 * hyphenated values don't collide — e.g. condition "type-2" + role "diabetes"
 * vs condition "type" + role "2-diabetes" both contain "type-2-diabetes" but
 * derive distinct keys "type-2::diabetes" and "type::2-diabetes".
 */

/**
 * Normalize a free-text field into a URL/channel-safe slug: lowercase, accents
 * stripped, runs of non-alphanumerics collapsed to a single hyphen, trimmed.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function slugify(value) {
  return (value ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (café → cafe)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Derive a cohort key from a Hivemate's profile slots. `condition` is optional:
 * Hivemates here for general wellness have none, so we bucket them under
 * "general-wellness" and match primarily on their role.
 *
 * @param {{ condition?: string, role?: string }} profile
 * @returns {string} e.g. "type-2-diabetes::single-parent" or "general-wellness::single-parent"
 */
export function derive(profile) {
  const condition = slugify(profile?.condition) || 'general-wellness';
  const role = slugify(profile?.role) || 'general';
  return `${condition}::${role}`;
}
