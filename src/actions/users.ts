"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  SESSION_COOKIE,
  encodeSession,
  getSession,
  sessionCookieOptions,
} from "@/lib/auth";
import {
  deleteLoginActivityRecords,
  deleteOffRequestRecord,
  deleteStaffUserRecord,
  getStore,
  insertLoginActivityRecord,
  insertOffRequestRecord,
  updateLoginActivityTimeRecord,
  updateOffRequestStatusRecord,
  updateStore,
} from "@/lib/store";
import { phDateString, phIsoFromDateTimeInput } from "@/lib/datetime";
import { openBaristaShifts } from "@/lib/staff-sessions";
import {
  canUsePos,
  parseRole,
  staffUserId,
  toSession,
} from "@/lib/users";
import { sanitizeLoginGate } from "@/lib/staff-gates";
import type { LoginActivity, OffRequest, Role, StaffUser, StoreData } from "@/lib/types";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    throw new Error("Only admin can manage staff.");
  }
  return session;
}

function refresh() {
  revalidatePath("/admin");
  revalidatePath("/pos");
}

async function requirePosSession() {
  const session = await getSession();
  if (!session || !canUsePos(session.role)) {
    throw new Error("Only cashier or manager can punch barista shifts.");
  }
  return session;
}

function compactStaffKey(value: string) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function looksLikeBarista(user: StaffUser) {
  if (user.role === "barista") return true;
  return /barista/i.test(`${user.title} ${user.username} ${user.name}`);
}

// Still mutates store.loginActivity in memory synchronously (so an
// "already clocked in" check made later in the same updateStore() queue
// turn sees this punch immediately, exactly as before persistence was
// added) - it returns the created entry so the caller can persist it via
// insertLoginActivityRecord() once this queue turn has finished, rather
// than nesting a DB call inside updateStore()'s callback.
function appendPunch(store: StoreData, user: StaffUser, type: "login" | "logout", role = user.role): LoginActivity {
  if (!Array.isArray(store.loginActivity)) store.loginActivity = [];
  const activity: LoginActivity = {
    id: `auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    userId: user.id,
    username: user.username,
    name: user.name,
    role,
    type,
    at: new Date().toISOString(),
  };
  store.loginActivity.unshift(activity);
  return activity;
}

function parseStaff(input: {
  name: string;
  username: string;
  title: string;
  role: string;
  password: string;
  requirePassword: boolean;
}): { error: string } | { name: string; username: string; title: string; role: Role; password?: string } {
  const name = input.name.trim();
  const role = parseRole(input.role);
  if (!name) return { error: "Enter a display name." };

  const title =
    role === "barista"
      ? "Barista"
      : input.title.trim() || (role === "admin" ? "Owner" : "Staff");
  const password = input.password;
  const username = (
    input.username.trim() ||
    name.toLowerCase().replace(/[^a-z0-9]+/g, "")
  )
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 32);

  if (!username || username.length < 2) {
    return { error: "Enter a username (letters and numbers)." };
  }
  if (input.requirePassword && password.length < 4) {
    return { error: "Password must be at least 4 characters." };
  }
  if (!input.requirePassword && password && password.length < 4) {
    return { error: "Password must be at least 4 characters." };
  }

  return {
    name,
    username,
    title,
    role,
    password: password ? password : undefined,
  };
}

export async function createStaffUser(input: {
  name: string;
  username: string;
  title: string;
  role: string;
  password: string;
}) {
  await requireAdmin();
  const parsed = parseStaff({ ...input, requirePassword: true });
  if ("error" in parsed) return parsed;

  let error: string | undefined;
  await updateStore((store) => {
    if (!Array.isArray(store.users)) store.users = [];
    const taken = store.users.some(
      (user) => user.username === parsed.username,
    );
    if (taken) {
      error = "That username is already in use.";
      return;
    }
    store.users.push({
      id: staffUserId(parsed.username),
      name: parsed.name,
      username: parsed.username,
      title: parsed.title,
      role: parsed.role,
      password: parsed.password ?? "",
    });
  });
  if (error) return { error };
  refresh();
  return { ok: true };
}

export async function updateStaffUser(input: {
  id: string;
  name: string;
  username: string;
  title: string;
  role: string;
  password: string;
}) {
  const session = await requireAdmin();
  const parsed = parseStaff({ ...input, requirePassword: false });
  if ("error" in parsed) return parsed;

  let error: string | undefined;
  let nextUser: StaffUser | undefined;

  await updateStore((store) => {
    const user = store.users.find((entry) => entry.id === input.id);
    if (!user) {
      error = "Staff account not found.";
      return;
    }
    const taken = store.users.some(
      (entry) => entry.id !== input.id && entry.username === parsed.username,
    );
    if (taken) {
      error = "That username is already in use.";
      return;
    }
    const admins = store.users.filter((entry) => entry.role === "admin");
    if (
      user.role === "admin" &&
      parsed.role !== "admin" &&
      admins.length < 2
    ) {
      error = "Keep at least one admin account.";
      return;
    }
    user.name = parsed.name;
    user.username = parsed.username;
    user.title = parsed.title;
    user.role = parsed.role;
    if (parsed.password) {
      user.password = parsed.password;
    }
    nextUser = { ...user };
  });

  if (error) return { error };

  if (nextUser && session.userId === nextUser.id) {
    const jar = await cookies();
    jar.set(SESSION_COOKIE, encodeSession(toSession(nextUser)), sessionCookieOptions());
  }

  refresh();
  return { ok: true };
}

export async function deleteStaffUser(id: string) {
  const session = await requireAdmin();
  if (session.userId === id) {
    return { error: "You cannot delete the account you are using." };
  }

  const store = await getStore();
  const user = store.users.find((entry) => entry.id === id);
  if (!user) {
    return { error: "Staff account not found." };
  }
  const admins = store.users.filter((entry) => entry.role === "admin");
  if (user.role === "admin" && admins.length < 2) {
    return { error: "Keep at least one admin account." };
  }

  try {
    await deleteStaffUserRecord(id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not delete that staff account." };
  }
  refresh();
  return { ok: true };
}

export async function punchStaff(userId: string, type: "login" | "logout") {
  await requireAdmin();
  let error: string | undefined;
  let activity: LoginActivity | undefined;
  await updateStore((store) => {
    const user = store.users.find((entry) => entry.id === userId);
    if (!user || user.role === "admin") {
      error = "Pick a staff member.";
      return;
    }
    activity = appendPunch(store, user, type);
  });
  if (error) return { error };
  if (activity) await insertLoginActivityRecord(activity);
  refresh();
  return { ok: true };
}

export async function punchBaristaShift(input: {
  type: "login" | "logout";
  username?: string;
  password?: string;
  userId?: string;
}) {
  await requirePosSession();

  let error: string | undefined;
  let punched: { id: string; name: string; username: string } | undefined;
  let activity: LoginActivity | undefined;
  await updateStore((store) => {
    const openShifts = openBaristaShifts(store.loginActivity ?? []);

    if (input.type === "login") {
      const username = String(input.username ?? "").trim().toLowerCase();
      const compact = compactStaffKey(username);
      const password = String(input.password ?? "").trim();
      const user = store.users.find((entry) => {
        const entryUser = String(entry.username ?? "").trim().toLowerCase();
        return (
          entryUser === username ||
          compactStaffKey(entry.username) === compact ||
          compactStaffKey(entry.name) === compact
        );
      });
      if (!user || String(user.password ?? "").trim() !== password) {
        error = "Barista username or password is incorrect.";
        return;
      }
      if (user.role === "admin" || !looksLikeBarista(user)) {
        error = "Use a barista account to clock in here.";
        return;
      }
      if (!user.password) {
        error = "This barista does not have a password yet. Ask admin to set one.";
        return;
      }
      if (openShifts.some((shift) => shift.userId === user.id)) {
        punched = { id: user.id, name: user.name, username: user.username };
        error = `${user.name} is already clocked in.`;
        return;
      }
      if (user.role !== "barista") {
        user.role = "barista";
        user.title = "Barista";
      }
      activity = appendPunch(store, user, "login", "barista");
      punched = { id: user.id, name: user.name, username: user.username };
      return;
    }

    const userId = String(input.userId ?? "").trim();
    const open = openShifts.find((shift) => shift.userId === userId) ?? (userId ? null : openShifts[0]);
    if (!open) {
      error = "That barista is not clocked in.";
      return;
    }
    const user = store.users.find((entry) => entry.id === open.userId);
    if (!user) {
      error = "Barista account not found.";
      return;
    }
    activity = appendPunch(store, user, "logout", "barista");
    punched = { id: user.id, name: user.name, username: user.username };
  });

  if (error) {
    return punched
      ? { error, id: punched.id, name: punched.name, username: punched.username }
      : { error };
  }
  if (activity) await insertLoginActivityRecord(activity);
  refresh();
  return { ok: true as const, id: punched?.id ?? "", name: punched?.name ?? "", username: punched?.username ?? "" };
}

export async function updateStaffSessionTimes(input: {
  loginId?: string;
  loginAt?: string;
  logoutId?: string;
  logoutAt?: string;
}) {
  await requireAdmin();

  if (!input.loginId && !input.logoutId) {
    return { error: "No in / out time was selected." };
  }

  const loginAt = input.loginId ? phIsoFromDateTimeInput(input.loginAt ?? "") : undefined;
  const logoutAt = input.logoutId ? phIsoFromDateTimeInput(input.logoutAt ?? "") : undefined;
  if ((input.loginId && !loginAt) || (input.logoutId && !logoutAt)) {
    return { error: "Enter a valid date and time." };
  }

  const store = await getStore();
  const login = input.loginId
    ? store.loginActivity.find((entry) => entry.id === input.loginId && entry.type === "login")
    : undefined;
  const logout = input.logoutId
    ? store.loginActivity.find((entry) => entry.id === input.logoutId && entry.type === "logout")
    : undefined;

  if ((input.loginId && !login) || (input.logoutId && !logout)) {
    return { error: "In / off record not found." };
  }
  if (login && logout && login.userId !== logout.userId) {
    return { error: "The in and off records do not belong to the same staff member." };
  }

  const nextLoginAt = loginAt ?? login?.at;
  const nextLogoutAt = logoutAt ?? logout?.at;
  if (
    nextLoginAt &&
    nextLogoutAt &&
    new Date(nextLogoutAt).getTime() < new Date(nextLoginAt).getTime()
  ) {
    return { error: "Off time cannot be earlier than in time." };
  }

  // Targeted single-row updates, not a rebuild of the whole activity array.
  if (login && loginAt) await updateLoginActivityTimeRecord(login.id, loginAt);
  if (logout && logoutAt) await updateLoginActivityTimeRecord(logout.id, logoutAt);

  refresh();
  return { ok: true };
}

export async function deleteStaffSession(input: { loginId?: string; logoutId?: string }) {
  await requireAdmin();

  if (!input.loginId && !input.logoutId) {
    return { error: "No in / out record was selected." };
  }

  const ids = [input.loginId, input.logoutId].filter((id): id is string => Boolean(id));
  const store = await getStore();
  const existingIds = new Set(store.loginActivity.map((entry) => entry.id));
  const found = ids.some((id) => existingIds.has(id));
  if (!found) return { error: "In / out record not found." };

  // Delete exactly the rows this session is made of (its loginId and/or
  // logoutId), not the whole array - other sessions/users are untouched.
  await deleteLoginActivityRecords(ids);

  refresh();
  return { ok: true };
}

export async function createOffRequest(input: { userId?: string; date: string; reason: string }) {
  const session = await getSession();
  if (!session) return { error: "Sign in first." };
  const date = phDateString(input.date);
  const reason = input.reason.trim();
  if (!date) return { error: "Pick a date." };
  if (!reason) return { error: "Enter a reason." };

  const asAdmin = session.role === "admin";
  if (!asAdmin && session.role !== "cashier" && session.role !== "manager") {
    return { error: "Only staff can request off." };
  }

  const store = await getStore();
  const userId = asAdmin ? input.userId : session.userId;
  const user = store.users.find((entry) => entry.id === userId);
  if (!user || user.role === "admin") {
    return { error: "Pick a staff member." };
  }

  await insertOffRequestRecord({
    id: `off-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    userId: user.id,
    name: user.name,
    date,
    reason,
    status: asAdmin ? "approved" : "pending",
    createdAt: new Date().toISOString(),
  });
  refresh();
  return { ok: true };
}

export async function setOffRequestStatus(id: string, status: OffRequest["status"]) {
  await requireAdmin();
  const store = await getStore();
  const request = store.offRequests?.find((entry) => entry.id === id);
  if (!request) {
    return { error: "Request not found." };
  }
  await updateOffRequestStatusRecord(id, status);
  refresh();
  return { ok: true };
}

export async function deleteOffRequest(id: string) {
  await requireAdmin();
  await deleteOffRequestRecord(id);
  refresh();
  return { ok: true };
}

export async function updateLoginGates(
  adminPath: string,
  cashierPath: string,
): Promise<{ error: string } | { ok: true; admin: string; cashier: string }> {
  await requireAdmin();
  const admin = sanitizeLoginGate(adminPath);
  if (!admin.ok) return { error: admin.error };
  const cashier = sanitizeLoginGate(cashierPath);
  if (!cashier.ok) return { error: cashier.error };
  if (admin.value === cashier.value) {
    return { error: "Use different paths for admin and cashier." };
  }

  let previous = { admin: "", cashier: "" };
  await updateStore((store) => {
    previous = { ...store.loginGates };
    store.loginGates = { admin: admin.value, cashier: cashier.value };
  });
  refresh();
  if (previous.admin) revalidatePath(`/${previous.admin}`);
  if (previous.cashier) revalidatePath(`/${previous.cashier}`);
  revalidatePath(`/${admin.value}`);
  revalidatePath(`/${cashier.value}`);
  return { ok: true, admin: admin.value, cashier: cashier.value };
}
