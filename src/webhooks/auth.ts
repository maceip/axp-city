import { timingSafeEqual, createHash } from "node:crypto";
import { signatureMatches } from "./verify.js";

export type Principal = "github-webhook" | "admin";

export type AuthOk = { ok: true; principal: Principal };
export type AuthFail = { ok: false; status: 401; body: string };
export type AuthResult = AuthOk | AuthFail;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Timing-safe secret compare; empty expected token always denies. */
export function secretMatches(provided: string, expected: string): boolean {
  if (!expected || !provided) return false;
  const a = sha256(provided);
  const b = sha256(expected);
  return timingSafeEqual(a, b);
}

export function bearerToken(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1];
}

/**
 * GitHub webhook deliveries: HMAC-SHA256 of the raw body.
 * Unsigned is allowed only when the operator set an empty secret AND
 * `--allow-unsigned` (local dev). A configured secret never degrades.
 */
export function authorizeWebhook(
  rawBody: Buffer,
  secret: string,
  signature: string | string[] | undefined,
  allowUnsigned: boolean,
): AuthResult {
  if (signatureMatches(rawBody, secret, signature)) {
    return { ok: true, principal: "github-webhook" };
  }
  if (allowUnsigned === true && secret === "") {
    return { ok: true, principal: "github-webhook" };
  }
  return { ok: false, status: 401, body: "bad signature" };
}

/**
 * Mutating city APIs (plot a repo by hand). The public map is read-only;
 * this token never goes into the page.
 */
export function authorizeAdmin(
  headers: Record<string, string | string[] | undefined>,
  adminToken: string,
): AuthResult {
  const provided = bearerToken(headers);
  if (!provided || !secretMatches(provided, adminToken)) {
    return { ok: false, status: 401, body: "unauthorized" };
  }
  return { ok: true, principal: "admin" };
}
