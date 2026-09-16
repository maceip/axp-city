import type { CityEvent, CitySignal } from "./types.js";

interface RepoRef {
  full_name?: string;
  id?: number;
  owner?: { login?: string };
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
  const repository = payload.repository as RepoRef | undefined;
  const repo = repository?.full_name;
  if (!repo) return null;

  const actor = ((payload.sender as ActorRef | undefined)?.login ?? null) as
    | string
    | null;

  const base: Omit<CityEvent, "signal"> = {
    id: deliveryId,
    receivedAt,
    repo,
    repoId: typeof repository?.id === "number" ? repository.id : null,
    actor,
  };

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
    case "star":
      if (payload.action === "created" || payload.action === "deleted")
        return { ...base, signal: "repo_updated" };
      return null;
    case "fork":
      return { ...base, signal: "repo_updated" };
    case "repository":
      return normalizeRepository(base, payload);
    default:
      return null;
  }
}

/**
 * Repository lifecycle. Renames and transfers carry the old name so the lot
 * keeps its address; deletion and privatization withdraw published data.
 */
function normalizeRepository(
  base: Omit<CityEvent, "signal">,
  payload: Record<string, unknown>,
): CityEvent | null {
  const action = payload.action;
  const changes = payload.changes as
    | {
        repository?: { name?: { from?: string } };
        owner?: { from?: { user?: { login?: string }; organization?: { login?: string } } };
      }
    | undefined;
  const [owner, name] = base.repo.split("/");
  switch (action) {
    case "created":
      return { ...base, signal: "repo_created" };
    case "renamed": {
      const from = changes?.repository?.name?.from;
      return {
        ...base,
        signal: "repo_renamed",
        previousRepo: from ? `${owner}/${from}` : undefined,
      };
    }
    case "transferred": {
      const from =
        changes?.owner?.from?.user?.login ??
        changes?.owner?.from?.organization?.login;
      return {
        ...base,
        signal: "repo_transferred",
        previousRepo: from ? `${from}/${name}` : undefined,
      };
    }
    case "deleted":
    case "archived":
      return { ...base, signal: action === "deleted" ? "repo_removed" : "repo_updated" };
    case "privatized":
      return { ...base, signal: "repo_privatized" };
    case "publicized":
      return { ...base, signal: "repo_publicized" };
    case "edited":
    case "unarchived":
      return { ...base, signal: "repo_updated" };
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
    | {
        number?: number;
        title?: string | null;
        html_url?: string | null;
        merged?: boolean;
      }
    | undefined;
  if (!pr) return null;
  let signal: CitySignal | null = null;
  if (action === "opened" || action === "reopened") signal = "pr_opened";
  else if (action === "closed")
    signal = pr.merged === true ? "pr_merged" : "pr_closed";
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
