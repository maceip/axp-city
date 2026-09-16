# Parser decision table

`parser/` is the city logic. Ingest never decides a lot’s look. Render never re-derives activity from repo names.

Clock: `now` (default: current time). Window: **N = 14 days**.

Recent activity is true if **either**:

- `pushed_at >= now − 14d`, or
- `recentDefaultCommits > 0` (default-branch commits already counted inside that window)

## Building band (stars)

| Band |            Stars | Catalog IDs | Silhouette family                   |
| ---- | ---------------: | ----------- | ----------------------------------- |
| S    |        `< 5 000` | 01–17       | sheds, shops, houses, small offices |
| M    | `5 000 … 19 999` | 18–34       | mid-rise campus / civic             |
| L    |       `≥ 20 000` | 35–50       | towers and landmarks                |

By default, `buildingId` is the lower catalog ID plus `hash(fullName) % bandSize`. It stays stable when other repositories are added or refreshed; buildings can repeat. A repository can override thresholds, catalog ranges, or a fixed `buildingId` through [its rules](RULES.md).

`sizeKb` and language bytes are stored on the lot for display. They do not change the band. The twelve Android demo repos already spread across S/M/L on stars alone.

## Yard kind

Evaluate in this order. **Open PRs beat open issues** for the kind. When both exist, the yard is still a _combined_ set: PR materials plus a small blueprint.

| #   | Condition                       | Yard            | Pad / building | Receiving yard                               |
| --- | ------------------------------- | --------------- | -------------- | -------------------------------------------- |
| 1   | `openPrs > 0` and recent        | `prs_active`    | live           | materials + movers; drone if high PRs or bot |
| 2   | `openPrs > 0` and not recent    | `prs_quiet`     | quiet          | materials only; empty sidewalk               |
| 3   | `openIssues > 0` and recent     | `issues_active` | live           | drafting table + blueprint + crew            |
| 4   | `openIssues > 0` and not recent | `issues_quiet`  | quiet          | drafting table + blueprint; **no crew**      |
| 5   | no issues/PRs, recent           | `idle_active`   | live           | empty yard                                   |
| 6   | else                            | `fully_dormant` | quiet          | empty dirt                                   |

Combined extras (applied after the kind is chosen):

- If `openPrs > 0` **and** `openIssues > 0` → also `showBlueprint` (small sheet next to the stacks).

## Drones

`showDrone` is true only on a PR yard when:

- `openPrs ≥ 15` (`HIGH_PR_COUNT`), or
- a bot/agent login appears in open-PR authors or recent commit authors (`type === "Bot"`, `*[bot]*`, `*-bot`, or the known list in `thresholds.ts`).

These are the city defaults. Validated repository loading-zone rules can customize each state's props, including a drone on an issue yard.

## What the parser does _not_ do

- It does not special-case `LegadoTeam/legado`, `caillette/Oak`, or any other name.
- It does not invent stars, issues, or PRs. Those come from `RepoMetrics` (live GitHub or a recorded fixture).
