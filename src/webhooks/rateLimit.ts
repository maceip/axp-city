export const LOOPBACK_PROXIES: readonly string[] = [
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
];

/**
 * Client identity for rate limiting behind a reverse proxy. The socket
 * address is authoritative unless it belongs to a trusted proxy; then the
 * rightmost `X-Forwarded-For` hop that is not itself a trusted proxy is the
 * client. Headers from untrusted peers are ignored, so a direct caller cannot
 * spoof another client's identity, and a trusted proxy always contributes the
 * hop it observed, so a client cannot hide behind a fabricated chain.
 */
export function clientAddress(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustedProxies: readonly string[] = LOOPBACK_PROXIES,
): string {
  const remote = remoteAddress ?? "unknown";
  if (!trustedProxies.includes(remote)) return remote;
  const header = Array.isArray(forwardedFor)
    ? forwardedFor.join(",")
    : (forwardedFor ?? "");
  const hops = header
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!trustedProxies.includes(hops[i])) return hops[i];
  }
  return remote;
}

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max deliveries per key per window. */
  max: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the window resets (0 when allowed). */
  retryAfterMs: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window per-key rate limiter. Dependency-free and allocation-light:
 * one small record per active key, expired records swept opportunistically.
 * Clocks come from the caller (`now`) so tests can drive time.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max } = options;
  const windows = new Map<string, Window>();

  function sweep(now: number): void {
    if (windows.size < 1024) return;
    for (const [key, window] of windows) {
      if (now >= window.resetAt) windows.delete(key);
    }
  }

  function check(key: string, now: number = Date.now()): RateLimitDecision {
    sweep(now);
    let window = windows.get(key);
    if (!window || now >= window.resetAt) {
      window = { count: 0, resetAt: now + windowMs };
      windows.set(key, window);
    }
    if (window.count < max) {
      window.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    return { allowed: false, retryAfterMs: Math.max(0, window.resetAt - now) };
  }

  return { check };
}
