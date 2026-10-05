import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  decodeSession,
  encodeSession,
  POS_SESSION_COOKIE,
  POS_TERMINAL_USER_ID,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";
import type { Session } from "@/lib/types";

const POS_TERMINAL_SESSION: Session = {
  userId: POS_TERMINAL_USER_ID,
  username: "pos-terminal",
  name: "POS Terminal",
  role: "cashier",
};

export async function GET(request: Request) {
  const jar = await cookies();
  const posSession = decodeSession(jar.get(POS_SESSION_COOKIE)?.value);
  if (posSession?.role === "cashier" || posSession?.role === "manager") {
    return NextResponse.redirect(new URL("/pos", request.url));
  }

  const primarySession = decodeSession(jar.get(SESSION_COOKIE)?.value);
  const session =
    primarySession?.role === "cashier" || primarySession?.role === "manager"
      ? primarySession
      : POS_TERMINAL_SESSION;
  const response = NextResponse.redirect(new URL("/pos", request.url));
  response.cookies.set(
    POS_SESSION_COOKIE,
    encodeSession(session),
    { ...sessionCookieOptions(), path: "/pos" },
  );
  return response;
}
