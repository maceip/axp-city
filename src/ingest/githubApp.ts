import { createSign } from "node:crypto";
import { GITHUB_API_URL } from "./github.js";

/**
 * GitHub App installation credentials. An installation token is scoped to the
 * repositories the owner granted, expires after an hour, and can be limited
 * to metadata/contents read permission — unlike a personal token that carries
 * the deploying user's full access.
 */
export interface GitHubAppConfig {
  appId: string;
  /** PEM-encoded RSA private key (`\n` escapes are accepted for env vars). */
  privateKey: string;
  installationId: string;
}

export interface TokenProvider {
  /** Current credential or undefined for anonymous access. */
  token(): Promise<string | undefined>;
  readonly kind: "github-app" | "github-token" | "github-anonymous";
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** RS256 JWT for GitHub App authentication; valid for ten minutes. */
export function appJwt(
  appId: string,
  privateKey: string,
  now = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKey.replaceAll("\\n", "\n"));
  return `${header}.${payload}.${base64url(signature)}`;
}

export function appConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GitHubAppConfig | undefined {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  const installationId = env.GITHUB_APP_INSTALLATION_ID;
  if (!appId && !privateKey && !installationId) return undefined;
  if (!appId || !privateKey || !installationId)
    throw new Error(
      "GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_APP_INSTALLATION_ID must be set together",
    );
  return { appId, privateKey, installationId };
}

export function createAppTokenProvider(
  config: GitHubAppConfig,
  request: typeof fetch = fetch,
  clock: () => number = Date.now,
): TokenProvider {
  let cached: { token: string; expiresAt: number } | undefined;
  let inflight: Promise<string> | undefined;
  async function mint(): Promise<string> {
    const response = await request(
      `${GITHUB_API_URL}/app/installations/${config.installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "axp-city",
          Authorization: `Bearer ${appJwt(config.appId, config.privateKey, Math.floor(clock() / 1000))}`,
        },
        body: JSON.stringify({ permissions: { metadata: "read", contents: "read" } }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `GitHub App installation token HTTP ${response.status}: ${text.slice(0, 200)}`,
      );
    const body = JSON.parse(text) as { token: string; expires_at: string };
    cached = {
      token: body.token,
      // Renew five minutes early so an in-flight refresh never uses an expiring token.
      expiresAt: Date.parse(body.expires_at) - 5 * 60_000,
    };
    return body.token;
  }
  return {
    kind: "github-app",
    async token() {
      if (cached && cached.expiresAt > clock()) return cached.token;
      inflight ??= mint().finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
  };
}

export function staticTokenProvider(token: string | undefined): TokenProvider {
  return {
    kind: token ? "github-token" : "github-anonymous",
    token: async () => token || undefined,
  };
}

/** App credentials win over a personal token; both absent means anonymous REST. */
export function tokenProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): TokenProvider {
  const app = appConfigFromEnv(env);
  if (app) return createAppTokenProvider(app, request);
  return staticTokenProvider(env.GITHUB_TOKEN);
}
