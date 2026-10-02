"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  SESSION_COOKIE,
  encodeSession,
  getSession,
  homeForRole,
  sessionCookieOptions,
} from "@/lib/auth";
import { getStore, recordAuthActivity } from "@/lib/store";
import { loginPathForRole, normalizeLoginGates } from "@/lib/staff-gates";
import { parseLoginRole, toSession } from "@/lib/users";

export type LoginState = {
  error?: string;
};

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const selectedRole = parseLoginRole(String(formData.get("role") ?? ""));

  if (!selectedRole) {
    return { error: "Select Admin or Cashier." };
  }
  if (!username || !password) {
    return { error: "Enter a username and password." };
  }

  const store = await getStore();
  const user = store.users.find(
    (entry) => entry.username.trim().toLowerCase() === username.toLowerCase(),
  );

  if (!user || !user.password) {
    return { error: "Those credentials do not match a Coffee ZZ staff account." };
  }

  const passwordMatches = user.password.startsWith("$2")
    ? await bcrypt.compare(password, user.password)
    : user.password === password;
  if (!passwordMatches) {
    return { error: "Those credentials do not match a Coffee ZZ staff account." };
  }

  const titleRole = String(user.title ?? "").trim().toLowerCase();
  const effectiveRole =
    titleRole === "admin" || titleRole === "owner" || user.role === "admin"
      ? "admin"
      : titleRole === "manager"
        ? "manager"
        : /cashier|sale\s+in\s+charge/.test(titleRole)
          ? "cashier"
          : user.role;
  if (selectedRole === "admin" && effectiveRole !== "admin") {
    return { error: "Those credentials are not for the Admin role." };
  }
  if (selectedRole === "cashier" && effectiveRole !== "cashier" && effectiveRole !== "manager") {
    return { error: "Those credentials are not for the Cashier role." };
  }

  const session = toSession({ ...user, role: effectiveRole });
  await recordAuthActivity({
    userId: user.id,
    username: user.username,
    name: user.name,
    role: effectiveRole,
    type: "login",
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession(session), sessionCookieOptions());

  redirect(homeForRole(session.role));
}

export async function logout() {
  const session = await getSession();
  if (session) {
    await recordAuthActivity({
      userId: session.userId,
      username: session.username,
      name: session.name,
      role: session.role,
      type: "logout",
    });
  }
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);

  const gateRole =
    session?.role === "admin"
      ? "admin"
      : session?.role === "cashier" || session?.role === "manager"
        ? "cashier"
        : null;

  if (gateRole) {
    let loginPath = "/";
    try {
      const store = await getStore();
      const gates = normalizeLoginGates(store.loginGates);
      loginPath = loginPathForRole(gateRole, gates);
    } catch {
      // gate resolution failed — fall back to landing page
    }
    redirect(loginPath);
  }

  redirect("/");
}

