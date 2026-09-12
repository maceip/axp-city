import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

/**
 * Verify a GitHub webhook HMAC-SHA256 signature.
 *
 * `header` is the raw `X-Hub-Signature-256` value (`sha256=<hex>`).
 * Returns false for missing, malformed, or mismatched signatures — never
 * throws, so the server can map false → 401 in one place.
 */
export function signatureMatches(
  rawBody: Buffer,
  secret: string,
  header: string | string[] | undefined,
): boolean {
  if (!secret || typeof header !== "string" || !header.startsWith(PREFIX)) {
    return false;
  }
  const hex = header.slice(PREFIX.length);
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(hex, "hex");
    actual = createHmac("sha256", secret).update(rawBody).digest();
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Compute a signature (used by tests and the local-dev signer). */
export function signBody(rawBody: Buffer, secret: string): string {
  return `${PREFIX}${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}
