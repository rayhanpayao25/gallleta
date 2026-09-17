"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createOffRequest,
  createStaffUser,
  deleteOffRequest,
  deleteStaffUser,
  punchStaff,
  setOffRequestStatus,
  updateLoginGates,
  updateStaffSessionTimes,
  deleteStaffSession,
  updateStaffUser,
} from "@/actions/users";
import type { PublicStaffUser } from "@/lib/users";
import { phDateString, phDateTimeInputValue, phDateTimeLabel } from "@/lib/datetime";
import { pairLoginSessions, type StaffSession } from "@/lib/staff-sessions";
import type { LoginActivity, OffRequest, Session } from "@/lib/types";
import type { LoginGates } from "@/lib/staff-gates";

const field =
  "w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition-all focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900";

type UserManagerProps = {
  users: PublicStaffUser[];
  session: Session;
  loginActivity: LoginActivity[];
  offRequests: OffRequest[];
  loginGates: LoginGates;
};

type SubTab = "staff" | "inout" | "off" | "gates";
type StaffRole = "Admin" | "Barista" | "Manager" | "Cashier";

export function UserManager({ users, session, loginActivity, offRequests, loginGates }: UserManagerProps) {
  const [tab, setTab] = useState<SubTab>("staff");
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<StaffRole>("Cashier");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [punchUserId, setPunchUserId] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editLoginAt, setEditLoginAt] = useState("");
  const [editLogoutAt, setEditLogoutAt] = useState("");
  const [offUserId, setOffUserId] = useState("");
  const [offDate, setOffDate] = useState(phDateString());
  const [offReason, setOffReason] = useState("");
  const [adminGate, setAdminGate] = useState(loginGates.admin);
  const [cashierGate, setCashierGate] = useState(loginGates.cashier);

  const uniqueUsers = useMemo(
    () => Array.from(new Map(users.map((user) => [user.id, user])).values()),
    [users],
  );
  const editing = uniqueUsers.find((user) => user.id === editingId) ?? null;
  const floorStaff = uniqueUsers.filter((user) => user.role !== "admin");
  const sessions = useMemo(() => pairLoginSessions(loginActivity), [loginActivity]);
  const requests = useMemo(
    () => [...offRequests].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [offRequests],
  );

  function startCreate() {
    setEditingId("new");
    setName("");
    setUsername("");
    setRole("Cashier");
    setTitle("");
    setPassword("");
    setNotice(null);
    setTab("staff");
  }

  function startEdit(user: PublicStaffUser) {
    setEditingId(user.id);
    setName(user.name);
    setUsername(user.username);
    setTitle(user.title ?? "");
    const lowerRole = user.role.toLowerCase();
    setRole(
      lowerRole === "admin"
        ? "Admin"
        : lowerRole === "manager"
          ? "Manager"
          : lowerRole === "cashier"
            ? "Cashier"
            : "Barista",
    );
    setPassword("");
    setNotice(null);
  }

  function resetForm() {
    setEditingId(null);
    setPassword("");
  }

  function startSessionEdit(row: StaffSession) {
    setEditingSessionId(row.id);
    setEditLoginAt(row.loginAt ? phDateTimeInputValue(row.loginAt) : "");
    setEditLogoutAt(row.logoutAt ? phDateTimeInputValue(row.logoutAt) : "");
    setNotice(null);
  }

  return (
    <div className="min-h-screen min-w-0 space-y-6 rounded-none border-0 border-neutral-300 bg-white p-3 sm:rounded-xl sm:border sm:p-6">
      <div className="flex gap-2 overflow-x-auto border-b border-neutral-400 pb-3">
        {(
          [
            { id: "staff", label: "Staff" },
            { id: "inout", label: "In / Out" },
            { id: "off", label: "Request off" },
            { id: "gates", label: "Login links" },
          ] as const
        ).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              setTab(entry.id);
              setNotice(null);
            }}
            className={`shrink-0 px-4 py-1.5 rounded text-xs font-bold transition shadow-sm uppercase ${
              tab === entry.id ? "bg-black text-white" : "bg-white text-neutral-700 hover:bg-neutral-100"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="w-full space-y-5">
        {notice ? <p className="text-sm text-neutral-600">{notice}</p> : null}

        {tab === "staff" ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-xl font-semibold tracking-tight">Staff</h1>
              <button
                type="button"
                onClick={startCreate}
                className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Add staff
              </button>
            </div>

            {editingId ? (
              <form
                className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  startTransition(async () => {
                    const payload = {
                      name,
                      username,
                      title: role === "Barista" ? "Barista" : title || role,
                      role: role.toLowerCase(),
                      password,
                    };
                    const result =
                      editingId === "new"
                        ? await createStaffUser(payload)
                        : await updateStaffUser({ id: editingId, ...payload });
                    if (result && "error" in result && result.error) {
                      setNotice(typeof result.error === "string" ? result.error : "Could not save.");
                      return;
                    }
                    if (editingId === "new") {
                      startCreate();
                      setEditingId(null);
                      setNotice(null);
                      return;
                    }
                    resetForm();
                    setNotice(null);
                  });
                }}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {editingId === "new" ? "New staff" : `Edit ${editing?.name ?? ""}`}
                  </p>
                  <button type="button" onClick={resetForm} className="text-xs text-neutral-500 hover:text-black">
                    Cancel
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-neutral-600">
                    <span className="mb-1.5 block">Name</span>
                    <input value={name} onChange={(event) => setName(event.target.value)} className={field} required />
                  </label>
                  <label className="text-xs font-medium text-neutral-600">
                    <span className="mb-1.5 block">Username</span>
                    <input value={username} onChange={(event) => setUsername(event.target.value)} className={field} required />
                  </label>
                  {role !== "Barista" ? (
                    <label className="text-xs font-medium text-neutral-600">
                      <span className="mb-1.5 block">Title</span>
                      <input value={title} onChange={(event) => setTitle(event.target.value)} className={field} />
                    </label>
                  ) : (
                    <p className="sm:col-span-2 text-xs text-neutral-500">
                      Baristas use this username and password to clock in and out on POS.
                    </p>
                  )}
                  <label className="text-xs font-medium text-neutral-600">
                    <span className="mb-1.5 block">Password</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className={field}
                      required={editingId === "new"}
                      placeholder={editingId === "new" ? "" : "Leave blank to keep current"}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(["Admin", "Manager", "Cashier", "Barista"] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setRole(id)}
                      className={`rounded-full border py-2 text-xs font-medium ${
                        role === id ? "border-black bg-black text-white" : "border-neutral-200 bg-white text-neutral-600"
                      }`}
                    >
                      {id}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
                >
                  {editingId === "new" ? "Add" : "Save"}
                </button>
              </form>
            ) : null}

            <div className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              {uniqueUsers.map((user) => (
                <div key={user.id} className="flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{user.name}</p>
                      {user.id === session.userId ? (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500 uppercase">
                          you
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-400">
                      {`${user.username} · ${user.title || user.role}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Edit ${user.name}`}
                      onClick={() => startEdit(user)}
                      className="flex h-9 w-9 items-center justify-center rounded-xl text-neutral-400 hover:bg-neutral-100 hover:text-black"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
                        <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" strokeWidth="1.7" strokeLinejoin="round" />
                        <path d="M13.5 6.5l3 3" strokeWidth="1.7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${user.name}`}
                      disabled={pending || user.id === session.userId}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await deleteStaffUser(user.id);
                          if (result && "error" in result && result.error) {
                            setNotice(typeof result.error === "string" ? result.error : "Could not delete.");
                            return;
                          }
                          if (editingId === user.id) resetForm();
                          setNotice(null);
                        })
                      }
                      className="flex h-9 w-9 items-center justify-center rounded-xl text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
                        <path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12" strokeWidth="1.7" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {tab === "inout" ? (
          <>
            <h1 className="text-xl font-semibold tracking-tight">Staff in / out</h1>
            <form
              className="flex flex-col gap-2 rounded-2xl border border-neutral-200 bg-white p-3 sm:flex-row sm:items-center"
              onSubmit={(event) => event.preventDefault()}
            >
              <select
                value={punchUserId}
                onChange={(event) => setPunchUserId(event.target.value)}
                className={`${field} sm:max-w-xs`}
              >
                <option value="">Select staff</option>
                {floorStaff.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending || !punchUserId}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await punchStaff(punchUserId, "login");
                      if (result && "error" in result && result.error) {
                        setNotice(typeof result.error === "string" ? result.error : "Could not record.");
                        return;
                      }
                      setNotice(null);
                    })
                  }
                  className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  In
                </button>
                <button
                  type="button"
                  disabled={pending || !punchUserId}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await punchStaff(punchUserId, "logout");
                      if (result && "error" in result && result.error) {
                        setNotice(typeof result.error === "string" ? result.error : "Could not record.");
                        return;
                      }
                      setNotice(null);
                    })
                  }
                  className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium hover:border-black disabled:opacity-40"
                >
                  Out
                </button>
              </div>
            </form>
            <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs font-medium tracking-wide text-neutral-400 uppercase">
                    <th className="px-4 py-3">Staff</th>
                    <th className="px-4 py-3">In</th>
                    <th className="px-4 py-3">Out</th>
                    <th className="px-4 py-3 text-right"> </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-sm text-neutral-400">
                        No in / out records yet.
                      </td>
                    </tr>
                  ) : (
                    sessions.map((row) => {
                      const isEditing = editingSessionId === row.id;
                      return (
                        <tr key={row.id} className="border-t border-neutral-100">
                          <td className="px-4 py-3">
                            <p className="font-medium">{row.name}</p>
                            <p className="text-xs text-neutral-400">{row.username}</p>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {isEditing && row.loginId ? (
                              <input
                                type="datetime-local"
                                value={editLoginAt}
                                onChange={(event) => setEditLoginAt(event.target.value)}
                                className={`${field} min-w-48`}
                                required
                              />
                            ) : row.loginAt ? phDateTimeLabel(row.loginAt) : "—"}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {isEditing && row.logoutId ? (
                              <input
                                type="datetime-local"
                                value={editLogoutAt}
                                onChange={(event) => setEditLogoutAt(event.target.value)}
                                className={`${field} min-w-48`}
                                required
                              />
                            ) : row.logoutAt ? phDateTimeLabel(row.logoutAt) : "Still in"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2 text-xs font-medium">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() =>
                                      startTransition(async () => {
                                        const result = await updateStaffSessionTimes({
                                          loginId: row.loginId ?? undefined,
                                          loginAt: row.loginId ? editLoginAt : undefined,
                                          logoutId: row.logoutId ?? undefined,
                                          logoutAt: row.logoutId ? editLogoutAt : undefined,
                                        });
                                        if (result && "error" in result && result.error) {
                                          setNotice(typeof result.error === "string" ? result.error : "Could not save.");
                                          return;
                                        }
                                        setEditingSessionId(null);
                                        setNotice(null);
                                      })
                                    }
                                    className="hover:underline disabled:opacity-40"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => setEditingSessionId(null)}
                                    className="text-neutral-500 hover:underline disabled:opacity-40"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => startSessionEdit(row)}
                                    className="hover:underline disabled:opacity-40"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Delete in / out record for ${row.name}`}
                                    title="Delete in / out record"
                                    disabled={pending}
                                    onClick={() => {
                                      startTransition(async () => {
                                        const result = await deleteStaffSession({
                                          loginId: row.loginId ?? undefined,
                                          logoutId: row.logoutId ?? undefined,
                                        });
                                        if (result && "error" in result && result.error) {
                                          setNotice(result.error);
                                          return;
                                        }
                                        setNotice(null);
                                      });
                                    }}
                                    className="inline-flex size-8 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-sm hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                                  >
                                    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" aria-hidden="true">
                                      <path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12" strokeWidth="1.7" />
                                    </svg>
                                    <span className="sr-only">Delete</span>
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === "off" ? (
          <>
            <h1 className="text-xl font-semibold tracking-tight">Request off</h1>
            <form
              className="grid gap-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:grid-cols-4 sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                startTransition(async () => {
                  const result = await createOffRequest({ userId: offUserId, date: offDate, reason: offReason });
                  if (result && "error" in result && result.error) {
                    setNotice(typeof result.error === "string" ? result.error : "Could not save.");
                    return;
                  }
                  setOffReason("");
                  setNotice(null);
                });
              }}
            >
              <label className="text-xs font-medium text-neutral-600">
                <span className="mb-1.5 block">Staff</span>
                <select value={offUserId} onChange={(event) => setOffUserId(event.target.value)} className={field} required>
                  <option value="">Select staff</option>
                  {floorStaff.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-neutral-600">
                <span className="mb-1.5 block">Date</span>
                <input type="date" value={offDate} onChange={(event) => setOffDate(event.target.value)} className={field} required />
              </label>
              <label className="text-xs font-medium text-neutral-600 sm:col-span-1">
                <span className="mb-1.5 block">Reason</span>
                <input value={offReason} onChange={(event) => setOffReason(event.target.value)} className={field} required />
              </label>
              <button
                type="submit"
                disabled={pending}
                className="rounded-full bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
              >
                Add
              </button>
            </form>
            <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs font-medium tracking-wide text-neutral-400 uppercase">
                    <th className="px-4 py-3">Staff</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right"> </th>
                  </tr>
                </thead>
                <tbody>
                  {requests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-neutral-400">
                        No off requests yet.
                      </td>
                    </tr>
                  ) : (
                    requests.map((request) => (
                      <tr key={request.id} className="border-t border-neutral-100">
                        <td className="px-4 py-3 font-medium">{request.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{phDateTimeLabel(request.date)}</td>
                        <td className="px-4 py-3 text-neutral-600">{request.reason}</td>
                        <td className="px-4 py-3 capitalize">{request.status}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2 text-xs font-medium">
                            {request.status === "pending" ? (
                              <>
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => startTransition(async () => { await setOffRequestStatus(request.id, "approved"); })}
                                  className="hover:underline"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => startTransition(async () => { await setOffRequestStatus(request.id, "denied"); })}
                                  className="hover:underline"
                                >
                                  Deny
                                </button>
                              </>
                            ) : null}
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => startTransition(async () => { await deleteOffRequest(request.id); })}
                              className="text-red-600 hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === "gates" ? (
          <>
            <h1 className="text-xl font-semibold tracking-tight">Login links</h1>
            <form
              className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5"
              onSubmit={(event) => {
                event.preventDefault();
                startTransition(async () => {
                  const result = await updateLoginGates(adminGate, cashierGate);
                  if (result && "error" in result && result.error) {
                    setNotice(typeof result.error === "string" ? result.error : "Could not save.");
                    return;
                  }
                  if (result && "ok" in result && result.ok) {
                    setAdminGate(result.admin);
                    setCashierGate(result.cashier);
                  }
                  setNotice(null);
                });
              }}
            >
              <label className="block text-xs font-medium text-neutral-600">
                <span className="mb-1.5 block">Admin path</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-neutral-400">/</span>
                  <input
                    value={adminGate}
                    onChange={(event) => setAdminGate(event.target.value)}
                    className={field}
                    required
                  />
                </div>
                <span className="mt-1.5 block text-xs font-normal text-neutral-400">
                  Open: /{adminGate.trim() || "…"}
                </span>
              </label>
              <label className="block text-xs font-medium text-neutral-600">
                <span className="mb-1.5 block">Cashier path</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-neutral-400">/</span>
                  <input
                    value={cashierGate}
                    onChange={(event) => setCashierGate(event.target.value)}
                    className={field}
                    required
                  />
                </div>
                <span className="mt-1.5 block text-xs font-normal text-neutral-400">
                  Open: /{cashierGate.trim() || "…"}
                </span>
              </label>
              <button
                type="submit"
                disabled={pending}
                className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
              >
                {pending ? "Saving..." : "Save links"}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}


