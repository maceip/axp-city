/**
 * Parser thresholds that are not part of the rules files.
 *
 * Building star bands and catalog ID ranges live in ONE place: `DEFAULT_RULES`
 * in `src/rules/cityFiles.ts`, mirrored by the deployment defaults in
 * `.city/*.json` (a unit test keeps the two identical). Do not add band
 * constants here.
 *
 * Recent activity: `pushed_at` within RECENT_ACTIVITY_DAYS OR any default-branch
 * commit counted inside that same window. Commit authors are only considered
 * inside that same window.
 *
 * Drones: open PRs ≥ HIGH_PR_COUNT, or a bot/agent login was observed among
 * in-window commit authors or open-PR authors. Bot detection is a heuristic on
 * account type and login; it is not proof that code was machine-written.
 */

export const RECENT_ACTIVITY_DAYS = 14;

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
