import type { Role, Session, StaffUser } from "@/lib/types";

export type PublicStaffUser = Omit<StaffUser, "password">;

export const DEFAULT_USERS: StaffUser[] = [
  {
    id: "admin-1",
    username: "admin",
    password: "coffeezz",
    name: "Admin",
    role: "admin",
    title: "Owner",
  },
  {
    id: "cashier-1",
    username: "cashier",
    password: "coffeezz",
    name: "Sale In Charge",
    role: "cashier",
    title: "Cashier",
  },
  {
    id: "manager-1",
    username: "manager",
    password: "coffeezz",
    name: "Manager",
    role: "manager",
    title: "Manager",
  },
  {
    id: "barista-1",
    username: "barista",
    password: "coffeezz",
    name: "Barista",
    role: "barista",
    title: "Barista",
  },
];

export function staffUserId(username: string): string {
  const slug = username
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "user"}-${Date.now().toString(36)}`;
}

export function toSession(user: StaffUser): Session {
  return {
    userId: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
  };
}

export function publicUser(user: StaffUser): PublicStaffUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    title: user.title,
  };
}

export function parseRole(value: string): Role {
  const normalized = value.toLowerCase();
  if (normalized === "admin") return "admin";
  if (normalized === "manager") return "manager";
  if (normalized === "cashier") return "cashier";
  return "barista";
}

export function parseLoginRole(value: string): "admin" | "cashier" | null {
  const normalized = value.toLowerCase();
  if (normalized === "admin" || normalized === "cashier") {
    return normalized;
  }
  return null;
}

export function canUsePos(role: Role) {
  return role === "cashier" || role === "manager";
}

export function normalizeStaffRole(item: Pick<StaffUser, "role" | "password">): Role {
  if (item.role === "admin" || item.role === "manager" || item.role === "cashier" || item.role === "barista") {
    return item.role;
  }
  return item.password ? "cashier" : "barista";
}