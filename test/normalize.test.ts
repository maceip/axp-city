import { describe, expect, it } from "vitest";
import { fromGraphQl, fromRest } from "../src/ingest/normalize.js";

describe("fromGraphQl", () => {
  it("keeps GraphQL issue and PR counts separate", () => {
    const row = fromGraphQl(
      {
        nameWithOwner: "acme/widget",
        url: "https://github.com/acme/widget",
        description: "d",
        stargazerCount: 42,
        forkCount: 3,
        diskUsage: 99,
        pushedAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
        primaryLanguage: { name: "Kotlin" },
        languages: { edges: [{ size: 1000, node: { name: "Kotlin" } }] },
        issues: { totalCount: 7 },
        pullRequests: { totalCount: 2 },
        defaultBranchRef: {
          target: {
            recentCount: { totalCount: 4 },
            recent: {
              nodes: [
                {
                  committedDate: "2026-09-01T00:00:00Z",
                  authors: { nodes: [{ user: { login: "ada" } }] },
                },
              ],
            },
          },
        },
        openPrAuthors: {
          nodes: [{ author: { login: "hosted-weblate", __typename: "Bot" } }],
        },
      },
      "2026-09-11T00:00:00Z",
    );
    expect(row.openIssues).toBe(7);
    expect(row.openPrs).toBe(2);
    expect(row.recentDefaultCommits).toBe(4);
    expect(row.recentAuthors).toEqual(["ada"]);
    expect(row.prAuthors).toEqual([{ login: "hosted-weblate", type: "Bot" }]);
    expect(row.source).toBe("github-graphql");
  });
});

describe("fromRest", () => {
  it("subtracts open PRs from GitHub's open_issues_count", () => {
    const row = fromRest({
      repo: {
        full_name: "acme/widget",
        html_url: "https://github.com/acme/widget",
        description: null,
        stargazers_count: 10,
        forks_count: 1,
        open_issues_count: 9,
        size: 50,
        pushed_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        language: "Go",
      },
      openPrs: 4,
      languageBytes: { Go: 200 },
      recentDefaultCommits: 0,
      recentAuthors: [],
      prAuthors: [],
      fetchedAt: "2026-09-11T00:00:00Z",
    });
    expect(row.openIssues).toBe(5);
    expect(row.openPrs).toBe(4);
    expect(row.source).toBe("github-rest");
  });
});
