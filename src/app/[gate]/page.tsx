import { notFound, redirect } from "next/navigation";
import { StaffLogin } from "@/components/StaffLogin";
import { getSession, homeForRole } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { roleForLoginGate } from "@/lib/staff-gates";

export const dynamic = "force-dynamic";

export default async function GatePage({
  params,
}: {
  params: Promise<{ gate: string }>;
}) {
  const { gate } = await params;
  const store = await getStore();
  const role = roleForLoginGate(gate, store.loginGates);
  if (!role) notFound();

  const session = await getSession();
  if (session) {
    redirect(homeForRole(session.role));
  }

  return <StaffLogin role={role} />;
}
