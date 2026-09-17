"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { StaffHeader, type AdminPanel } from "@/components/StaffHeader";
import { UserManager } from "@/components/UserManager";
import { SalePurchaseTransactions } from "@/components/SalePurchaseTransactions";
import { MenuCatalog } from "@/components/MenuCatalog";
import { VoidRequestApproval } from "@/components/VoidRequestApproval";
import type { PublicStaffUser } from "@/lib/users";
import type { Session, StoreData } from "@/lib/types";

type AdminShellProps = {
  session: Session;
  users: PublicStaffUser[];
  store: StoreData;
  children: ReactNode;
};

function readSavedPanel(): AdminPanel {
  const savedPanel = window.localStorage.getItem("admin_activePanel");
  const savedSection = window.localStorage.getItem("admin_section");
  if (savedPanel === "staff" || savedSection === "staff") return "staff";
  if (savedPanel === "menu" || savedPanel === "transactions" || savedPanel === "voids") {
    return savedPanel;
  }
  return "sales";
}

export function AdminShell({ session, users, store, children }: AdminShellProps) {
  const [panel, setPanel] = useState<AdminPanel>("sales");
  const [isMounted, setIsMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (panel !== "transactions" && panel !== "sales" && panel !== "voids" && panel !== "staff") return;
    const refreshTimer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(refreshTimer);
  }, [panel, router]);

  useEffect(() => {
    setPanel(readSavedPanel());
    setIsMounted(true);
  }, []);

  function handlePanelChange(next: AdminPanel) {
    setPanel(next);
    window.localStorage.setItem("admin_activePanel", next);
    window.localStorage.setItem("admin_section", next === "staff" ? "staff" : "admin");
  }

  const current = isMounted ? panel : "sales";

  return (
    <>
      <StaffHeader session={session} panel={current} onPanelChange={handlePanelChange} />

      {current === "staff" ? (
        <UserManager
          users={users}
          session={session}
          loginActivity={store.loginActivity ?? []}
          offRequests={store.offRequests ?? []}
          loginGates={store.loginGates ?? { admin: "mouna1233", cashier: "sale1803" }}
        />
      ) : null}
      {current === "sales" ? children : null}
      {current === "menu" ? (
        <MenuCatalog menu={store.menu} categories={store.categories} inventory={store.inventory} />
      ) : null}
      {current === "transactions" ? <SalePurchaseTransactions store={store} /> : null}
      {current === "voids" ? <VoidRequestApproval requests={store.voidRequests ?? []} /> : null}
    </>
  );
}
