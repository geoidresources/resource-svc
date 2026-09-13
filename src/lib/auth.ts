import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const COOKIE_NAME = "geoid_up";
const TTL_MS = 12 * 60 * 60 * 1000;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("missing env SESSION_SECRET");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function equal(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkAccessCode(supplied: string): boolean {
  const expected = process.env.UPLOAD_ACCESS_CODE;
  if (!expected) throw new Error("missing env UPLOAD_ACCESS_CODE");
  return equal(supplied, expected);
}

export function mintToken(): { value: string; maxAge: number } {
  const exp = Date.now() + TTL_MS;
  return { value: `${exp}.${sign(String(exp))}`, maxAge: Math.floor(TTL_MS / 1000) };
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  if (!equal(sig, sign(exp))) return false;
  return Number(exp) > Date.now();
}

export async function hasSession(): Promise<boolean> {
  const jar = await cookies();
  return verifyToken(jar.get(COOKIE_NAME)?.value);
}
