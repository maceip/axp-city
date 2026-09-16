import { afterEach, expect, it, vi } from "vitest";
import { fetchViaRest } from "../src/ingest/github.js";
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
