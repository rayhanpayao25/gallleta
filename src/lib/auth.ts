import { cookies } from "next/headers";
import type { Session } from "@/lib/types";

export const SESSION_COOKIE = "coffeezz_session";
export const POS_SESSION_COOKIE = "galleta_pos_session";
export const POS_TERMINAL_USER_ID = "pos-terminal";

export function encodeSession(session: Session): string {
  return btoa(JSON.stringify(session))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeSession(value: string | undefined): Session | null {
  if (!value) return null;

  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded);
    const parsed = JSON.parse(json) as Session;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.username !== "string" ||
      typeof parsed.name !== "string" ||
      parsed.role !== "admin" && parsed.role !== "cashier" && parsed.role !== "manager"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const posSession = decodeSession(jar.get(POS_SESSION_COOKIE)?.value);
  if (posSession) return posSession;

  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);
  return session?.userId === POS_TERMINAL_USER_ID ? null : session;
}

export function homeForRole(role: Session["role"]): string {
  if (role === "admin") return "/admin";
  if (role === "cashier" || role === "manager") return "/pos";
  return "/";
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 12,
    secure: process.env.VERCEL === "1",
  };
}
