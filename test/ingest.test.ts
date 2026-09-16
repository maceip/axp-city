import { afterEach, expect, it, vi } from "vitest";
import { fetchViaGraphQl, fetchViaRest } from "../src/ingest/github.js";
afterEach(() => vi.unstubAllGlobals());
it("counts more than one REST page of PRs before subtracting them from combined issues", async () => {
  const request = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/pulls"))
      return new Response(
        JSON.stringify(
          Array.from({ length: url.includes("page=3") ? 1 : 100 }, () => ({
            user: { login: "human", type: "User" },
          })),
        ),
        {
          headers: {
            link: '<https://api.github.com/repos/acme/widget/pulls?state=open&per_page=100&page=3>; rel="last"',
          },
        },
      );
    if (url.endsWith("/languages")) return new Response("{}");
    if (url.includes("/commits?")) return new Response("[]");
    return new Response(
      JSON.stringify({
        full_name: "acme/widget",
        html_url: "https://github.com/acme/widget",
        stargazers_count: 5000,
        forks_count: 5,
        open_issues_count: 260,
        size: 100,
        description: null,
        pushed_at: null,
        updated_at: null,
        language: null,
      }),
    );
  });
  vi.stubGlobal("fetch", request);
  const [row] = await fetchViaRest([{ owner: "acme", name: "widget" }]);
  expect(row.openPrs).toBe(201);
  expect(row.openIssues).toBe(59);
});

it("reports a failed GraphQL issues field as unknown instead of a measured zero (finding A)", async () => {
  const request = vi.fn(async () =>
    new Response(
      JSON.stringify({
        data: {
          r0: {
            nameWithOwner: "acme/widget",
            url: "https://github.com/acme/widget",
            description: null,
            databaseId: 7,
            isPrivate: false,
            stargazerCount: 10,
            forkCount: 1,
            diskUsage: 100,
            pushedAt: "2026-09-10T00:00:00Z",
            updatedAt: "2026-09-10T00:00:00Z",
            primaryLanguage: null,
            languages: { edges: [] },
            issues: null,
            pullRequests: { totalCount: 3 },
            defaultBranchRef: { name: "main", target: { recentCount: { totalCount: 1 }, recent: { nodes: [] } } },
            openPrAuthors: { nodes: [] },
          },
        },
        errors: [{ message: "Something went wrong while executing your query.", path: ["r0", "issues"] }],
      }),
    ),
  );
  const [row] = await fetchViaGraphQl([{ owner: "acme", name: "widget" }], { token: "t", request });
  expect(row.unknownFields).toContain("openIssues");
  expect(row.unknownFields).not.toContain("openPrs");
  expect(row.openPrs).toBe(3);
});

it("reports REST 503s for commits and languages as unknown fields, not zero commits and no languages (finding A)", async () => {
  const request = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/pulls")) return new Response(JSON.stringify([{ user: { login: "human", type: "User" } }]));
    if (url.endsWith("/languages") || url.includes("/commits?")) return new Response("upstream down", { status: 503 });
    return new Response(
      JSON.stringify({
        full_name: "acme/widget",
        html_url: "https://github.com/acme/widget",
        id: 7,
        private: false,
        stargazers_count: 5000,
        forks_count: 5,
        open_issues_count: 4,
        size: 100,
        description: null,
        pushed_at: null,
        updated_at: null,
        language: null,
      }),
    );
  });
  vi.stubGlobal("fetch", request);
  const [row] = await fetchViaRest([{ owner: "acme", name: "widget" }]);
  expect(row.source).toBe("github-rest");
  expect(new Set(row.unknownFields)).toEqual(new Set(["languageBytes", "recentDefaultCommits", "recentAuthors"]));
  expect(row.openPrs).toBe(1);
  expect(row.openIssues).toBe(3);
});
