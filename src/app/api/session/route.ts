import { NextResponse } from "next/server";
import { COOKIE_NAME, checkAccessCode, hasSession, mintToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ authenticated: await hasSession() });
}

export async function POST(req: Request) {
  let code = "";
  try {
    ({ code = "" } = await req.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (!checkAccessCode(code)) {
    return NextResponse.json({ error: "invalid access code" }, { status: 401 });
  }

  const token = mintToken();
  const res = NextResponse.json({ authenticated: true });
  res.cookies.set(COOKIE_NAME, token.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: token.maxAge,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ authenticated: false });
  res.cookies.delete(COOKIE_NAME);
  return res;
}
