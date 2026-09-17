# Parser decision table

`parser/` is the city logic. Ingest never decides a lot's look. Render never re-derives activity from repo names.

Clock: `now` (default: current time). Window: **N = 14 days** (`RECENT_ACTIVITY_DAYS`). The same window is used for the GraphQL commit count, for filtering recent authors by `committedDate`, and for the crew label.

Recent activity is true if **either**:

- `pushed_at >= now − 14d`, or
- `recentDefaultCommits > 0` (default-branch commits counted inside that window)

## Unknown is not zero

A GitHub fetch may fail partially (GraphQL field errors, REST 5xx for commits or languages, rate limits). Such fields are listed in `RepoMetrics.unknownFields` instead of being written as `0` or `{}`. `mergeMetrics` then carries the **last good value** for each unknown field from the previous complete refresh and marks the lot `partial` (`carriedFields`, `carriedFrom`); the inspect card shows `PARTIAL: … carried from <date>`. If a field is unknown and there is no earlier value, the refresh is rejected as **incomplete**: the previously published lot stays, `refresh_status` records the error, and freshness reports the failure. A refresh never produces a fresh-looking zero from a failure.

## Building band (stars)

| Band |            Stars | Catalog IDs | Silhouette family                   |
| ---- | ---------------: | ----------- | ----------------------------------- |
| S    |        `< 5 000` | 01–17       | sheds, shops, houses, small offices |
| M    | `5 000 … 19 999` | 18–34       | mid-rise campus / civic             |
| L    |       `≥ 20 000` | 35–50       | towers and landmarks                |

By default, `buildingId` is the lower catalog ID plus `hash(fullName) % bandSize`. It stays stable when other repositories are added or refreshed; buildings can repeat. A repository can override thresholds, catalog ranges, a fixed `buildingId`, or approved custom artwork through [its rules](RULES.md). There is no post-hoc de-duplication of silhouettes: stable appearance and explicit overrides win over forced variety.

`sizeKb` and language bytes are stored on the lot for display. They do not change the band.

A second, independent hash of `fullName` (`pickFacade`) assigns a muted `facadeTint` (one of eight isometric roof/wall tints) and a `dressingProp` (`tree`, `bush`, `planter`, `lamp`, or `none`). This does not change `buildingId` or lot address. Neighbours may share a silhouette; they still read as different houses because tint and yard dressing differ. Custom artwork still uses the tint when present.

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

Lot plates and loading zones use the v5 Kenney-style **single** isometric diamonds (`grassA`/`dirtA`/`paveA`/`asphaltSlab`) at native 2:1 aspect. The dual-plot hex pads are not stamped under buildings. Construction props sit on the concrete apron, not on a competing 3-D dirt island.

Combined extras (applied after the kind is chosen):

- If `openPrs > 0` **and** `openIssues > 0` → also `showBlueprint` (small sheet next to the stacks).
- Version-2 rules may add decor props and an explicit layout; see `RULES.md`.

## Crew label (`occupantClass` + `crewBasis`)

Authors come from two sampled sources: open-PR authors (first 20 open PRs in GraphQL, first 100 in REST) and default-branch commit authors **inside the 14-day window** (the latest 15 commits are inspected and anything older than the window is dropped). `authorSample` records how many were inspected and whether the sample was complete. An account is "automation" when its GitHub type is `Bot`, its login ends in `[bot]` or `-bot`, or it is on the known list in `thresholds.ts`.

| Label | When | What the card says |
| --- | --- | --- |
| `none` | not recent | "No default-branch push or commit in the last 14 days." |
| `robot` | not recent, bots hold open PRs, drone shown | parked drone only |
| `unknown` | recent, but author fields were unknown in the last refresh | "the crew type is not known" |
| `mixed` | recent, humans **and** bots among in-window authors | both counted |
| `robot` | recent, only bots | heuristic disclaimer: not proof of machine-written code |
| `human` | recent, only human-looking accounts | disclaimer: absence of a detected bot is not proof of exclusively human work |
| `human` | recent, no sampled authors | "treated as a human crew by default" |

Every label carries the sample note when the sample was incomplete ("N in-window commits and M open PRs inspected; more exist"). The label drives which crew art appears: `human` → people with distinct walk/work/carry/wave behaviours, `mixed` → people with every other ground worker a robot, `robot` and `unknown` → the robot atlas, with the `unknown` notice in the card. The census shows the same label.

## Drones

`showDrone` is true only on a PR yard when:

- `openPrs ≥ 15` (`HIGH_PR_COUNT`), or
- an automation account appears among open-PR authors or in-window commit authors.

These are the city defaults. Validated repository loading-zone rules can customize each state's props, including a drone on an issue yard.

## What the parser does _not_ do

- It does not special-case any repository by name.
- It does not invent stars, issues, or PRs. Those come from `RepoMetrics` (live GitHub or a recorded fixture) and unknown fields stay unknown.
- It does not claim who wrote the code: crew labels are account heuristics with their basis written out.
