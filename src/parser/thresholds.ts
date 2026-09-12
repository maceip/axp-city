/**
 * City-lot thresholds. Keep these in sync with README.md and docs/PARSER.md.
 *
 * Building bands are driven by stargazer count (first cut). `sizeKb` is
 * ingested and shown on lots but does not change the band — the 12-repo
 * Android set already spans S / M / L cleanly on stars alone.
 *
 *   S  stars < 5_000          → building IDs 01–17  (sheds, shops, houses)
 *   M  5_000 ≤ stars < 20_000 → building IDs 18–34  (mid-rise campus / civic)
 *   L  stars ≥ 20_000         → building IDs 35–50  (towers / landmarks)
 *
 * Recent activity: `pushed_at` within RECENT_ACTIVITY_DAYS OR any default-branch
 * commit counted inside that same window. N = 14.
 *
 * Precedence: open PRs beat open issues for the yard *kind*. When both are
 * present the yard still gets a small blueprint (combined materials + plan).
 *
 * Drones: open PRs ≥ HIGH_PR_COUNT, or a bot/agent login was observed among
 * recent commit authors or open-PR authors.
 */

export const RECENT_ACTIVITY_DAYS = 14;

export const STAR_BAND_SMALL_MAX = 5_000;
export const STAR_BAND_MEDIUM_MAX = 20_000;

export const BUILDING_ID_SMALL: readonly [number, number] = [1, 17];
export const BUILDING_ID_MEDIUM: readonly [number, number] = [18, 34];
export const BUILDING_ID_LARGE: readonly [number, number] = [35, 50];

/** “High PR pressure” — drones even without a detected bot. */
export const HIGH_PR_COUNT = 15;

export const KNOWN_BOT_LOGINS = [
  "dependabot",
  "dependabot[bot]",
  "renovate",
  "renovate[bot]",
  "github-actions[bot]",
  "hosted-weblate",
  "hosted-weblate[bot]",
  "semantic-release-bot",
  "imgbot",
  "imgbot[bot]",
] as const;
