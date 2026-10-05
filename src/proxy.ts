import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  POS_SESSION_COOKIE,
  POS_TERMINAL_USER_ID,
  SESSION_COOKIE,
  decodeSession,
  homeForRole,
} from "@/lib/auth";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (pathname === "/pos/auto-login") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/pos")) {
    const session = decodeSession(
      request.cookies.get(POS_SESSION_COOKIE)?.value,
    );
    if (!session) {
      return NextResponse.redirect(new URL("/pos/auto-login", request.url));
    }
    if (session.role !== "cashier" && session.role !== "manager") {
      return NextResponse.redirect(new URL("/pos/auto-login", request.url));
    }
  }

  if (pathname.startsWith("/admin")) {
    const decodedSession = decodeSession(
      request.cookies.get(SESSION_COOKIE)?.value,
    );
    const session =
      decodedSession?.userId === POS_TERMINAL_USER_ID ? null : decodedSession;
    if (!session) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    if (session.role !== "admin") {
      return NextResponse.redirect(new URL(homeForRole(session.role), request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/pos/:path*", "/admin/:path*", "/login"],
};
