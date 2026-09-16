/**
 * Normalized city signals. GitHub delivers dozens of event types; the city
 * page only cares about the handful that light up a lot. Everything else is
 * acknowledged and ignored.
 */
export type CitySignal =
  | "push"
  | "pr_opened"
  | "pr_merged"
  | "pr_closed"
  | "issue_opened"
  | "issue_closed"
  | "repo_created"
  | "repo_updated"
  | "ping";

export interface CityEvent {
  /** GitHub `X-GitHub-Delivery` id — also the dedup key. */
  id: string;
  /** When the catcher received it (ISO 8601). */
  receivedAt: string;
  /** `owner/name`. */
  repo: string;
  signal: CitySignal;
  actor: string | null;
  /** Push ref, e.g. `refs/heads/main`. */
  ref?: string;
  /** PR / issue number. */
  number?: number;
  title?: string | null;
  url?: string | null;
  /** True when a closed PR was merged (crew celebration). */
  merged?: boolean;
}

export interface DeliveryResult {
  status: 200 | 400 | 401 | 413 | 429 | 500;
  body: string;
  /** Present when the delivery produced a city signal. */
  event?: CityEvent;
}
