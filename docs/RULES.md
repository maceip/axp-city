# Building and loading-zone rules

Both rules files are declarative JSON, never executable code. The files in the city checkout's `.city/` directory establish defaults. A represented GitHub repository can declare partial overrides at `.city/building.json` and `.city/loading-zone.json` in its default branch. Refresh order is metrics + validated defaults + repository overrides → parser → persisted lot → Phaser.

For example, a repository may select a catalog building:

```json
{ "version": 1, "buildingId": 42, "quietAlpha": 0.5 }
```

`buildingId` is an integer 1–50. It selects artwork independently of the S/M/L footprint size derived from stars. The correct atlas sheet is selected from that ID. Without a fixed ID, the repository name hashes stably into its band's configured `ids` range. Default star bands are S below 5,000, M below 20,000, and L at 20,000 or more. `bands.S.maxStarsExclusive`, `bands.M.maxStarsExclusive`, and each band's inclusive `ids` pair may be overridden. Thresholds must increase; IDs stay inside 1–50. `quietAlpha` is in (0,1].

Loading-zone example:

```json
{
  "version": 1,
  "props": {
    "issues": ["blueprint", "drafting-table"],
    "prs": ["materials"],
    "recent": ["crew"],
    "highPrsOrBot": ["drone"]
  },
  "combinedBlueprint": true
}
```

Empty prop arrays disable that class of props. PRs take precedence over issues; recent activity activates crews on working yards. `combinedBlueprint` controls whether a PR yard also displays an issue blueprint. Recent idle lots retain their ambient human/robot walker. The fixed precedence is `openPrs`, `openIssues`, `recentActivity`; invalid values and unknown properties are rejected.

Missing files (404) use city defaults. Malformed/invalid files use validated defaults for that file and publish a warning in the inspect card. Upstream authentication, rate-limit, or transport failures fail the refresh, retain the last committed lot, and leave webhook delivery retryable. Files are limited to 64 KiB. Only the trusted GitHub Contents API is queried; rule files cannot name network endpoints or code to execute.

Push webhooks refresh the files, so changing a repository's rules changes its city lot without deploying the client. Authenticated reconciliation also rereads them. Construction timestamps and addresses survive rule/metric changes.
