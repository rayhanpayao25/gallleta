"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/actions/auth";

const initial: LoginState = {};

const field =
  "w-full rounded-none border border-white/30 bg-transparent px-4 py-3 text-white outline-none focus:border-white";

export function LoginForm({ role }: { role: "admin" | "cashier" }) {
  const [state, action, pending] = useActionState(login, initial);

  return (
    <form action={action} className="w-full max-w-md space-y-6">
      <input type="hidden" name="role" value={role} />

      <label className="block text-left text-sm">
        <span className="mb-2 block tracking-wide text-neutral-400 uppercase">
          Username
        </span>
        <input
          name="username"
          autoComplete="username"
          autoFocus
          className={field}
        />
      </label>

      <label className="block text-left text-sm">
        <span className="mb-2 block tracking-wide text-neutral-400 uppercase">
          Password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          className={field}
        />
      </label>

      {state?.error ? (
        <p className="text-sm text-red-300">{state.error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-white py-3 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Enter Galleta Café"}
      </button>
    </form>
  );
}
