import crypto from "crypto";

export const AUTH_COOKIE_NAME = "btc_auth_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const DEFAULT_USERNAME = "chris";
const DEFAULT_PASSWORD = "buggles";
const DEFAULT_SECRET = "dev-insecure-secret-change-me";

function getSecret() {
  return process.env.AUTH_SECRET ?? DEFAULT_SECRET;
}

export function getAuthCredentials() {
  return {
    username: process.env.AUTH_USERNAME ?? DEFAULT_USERNAME,
    password: process.env.AUTH_PASSWORD ?? DEFAULT_PASSWORD,
  };
}

function signPayload(payload: string) {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function createSessionToken(username: string) {
  const issuedAt = Date.now();
  const payload = `${username}.${issuedAt}`;
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function verifySessionToken(token: string | undefined | null) {
  if (!token) return null;
  const [username, issuedAtRaw, signature] = token.split(".");
  if (!username || !issuedAtRaw || !signature) return null;
  const payload = `${username}.${issuedAtRaw}`;
  const expected = signPayload(payload);
  if (!safeEqual(signature, expected)) return null;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return null;
  const maxAgeMs = SESSION_MAX_AGE_SECONDS * 1000;
  if (Date.now() - issuedAt > maxAgeMs) return null;

  return { username, issuedAt };
}
