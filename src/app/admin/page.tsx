import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/AdminDashboard";
import { AdminShell } from "@/components/AdminShell";
import { getSession } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { publicUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    
    redirect("/");
  }

  
  const store = await getStore();

  return (
    <main
      suppressHydrationWarning
      className="min-h-svh overflow-x-hidden bg-neutral-100 text-black"
    >
      <AdminShell session={session} users={store.users.map(publicUser)} store={store}>
        <AdminDashboard store={store} />
      </AdminShell>
    </main>
  );
}
