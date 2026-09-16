import type { CityEvent, CitySignal } from "./types.js";

interface RepoRef {
  full_name?: string;
}

interface ActorRef {
  login?: string;
}

/**
 * Map one GitHub delivery to a city event. Returns null for event types or
 * actions the city does not visualize — the caller still acks those with 200
 * so GitHub does not retry them.
 */
export function normalizeDelivery(
  eventName: string,
  payload: Record<string, unknown>,
  deliveryId: string,
  receivedAt: string,
): CityEvent | null {
  const repo = (payload.repository as RepoRef | undefined)?.full_name;
  if (!repo) return null;

  const actor =
    ((payload.sender as ActorRef | undefined)?.login ?? null) as string | null;

  const base = { id: deliveryId, receivedAt, repo, actor };

  switch (eventName) {
    case "ping":
      return { ...base, signal: "ping" };
    case "push":
      return {
        ...base,
        signal: "push",
        ref: typeof payload.ref === "string" ? payload.ref : undefined,
        url: typeof payload.compare === "string" ? payload.compare : null,
      };
    case "pull_request":
      return normalizePullRequest(base, payload);
    case "issues":
      return normalizeIssue(base, payload);
    case "repository":
      if (payload.action === "created") return { ...base, signal: "repo_created" };
      return null;
    default:
      return null;
  }
}

function normalizePullRequest(
  base: Omit<CityEvent, "signal">,
  payload: Record<string, unknown>,
): CityEvent | null {
  const action = payload.action;
  const pr = payload.pull_request as
    | { number?: number; title?: string | null; html_url?: string | null; merged?: boolean }
    | undefined;
  if (!pr) return null;
  let signal: CitySignal | null = null;
  if (action === "opened" || action === "reopened") signal = "pr_opened";
  else if (action === "closed") signal = pr.merged === true ? "pr_merged" : "pr_closed";
  if (!signal) return null;
  return {
    ...base,
    signal,
    number: pr.number,
    title: pr.title ?? null,
    url: pr.html_url ?? null,
    merged: pr.merged,
  };
}

function normalizeIssue(
  base: Omit<CityEvent, "signal">,
  payload: Record<string, unknown>,
): CityEvent | null {
  const action = payload.action;
  const issue = payload.issue as
    | { number?: number; title?: string | null; html_url?: string | null }
    | undefined;
  if (!issue) return null;
  let signal: CitySignal | null = null;
  if (action === "opened" || action === "reopened") signal = "issue_opened";
  else if (action === "closed") signal = "issue_closed";
  if (!signal) return null;
  return {
    ...base,
    signal,
    number: issue.number,
    title: issue.title ?? null,
    url: issue.html_url ?? null,
  };
}
