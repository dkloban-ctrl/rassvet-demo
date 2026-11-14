"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Inbox } from "@/components/Inbox";
import { AnnouncementsAdmin, EventsAdmin, LeafletsAdmin, QuestionsAdmin } from "@/components/admin/Content";
import { Audit } from "@/components/admin/Audit";
import { Invites } from "@/components/admin/Invites";
import { People } from "@/components/admin/People";
import { PageTitle, cx } from "@/components/ui";

const TABS = [
  { id: "inbox", label: "Ящик" },
  { id: "people", label: "Люди" },
  { id: "invites", label: "Приглашения" },
  { id: "leaflets", label: "Листки" },
  { id: "questions", label: "Вопросы" },
  { id: "announcements", label: "Объявления" },
  { id: "events", label: "Встречи" },
  { id: "audit", label: "Журнал" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("inbox");

  useEffect(() => {
    const h = location.hash.slice(1) as Tab;
    if (TABS.some((t) => t.id === h)) setTab(h);
  }, []);
  const choose = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };

  return (
    <AppShell allow={["admin"]}>
      <PageTitle>Админка</PageTitle>
      <div className="-mx-4 px-4 overflow-x-auto mb-4">
        <div className="flex gap-1.5 w-max">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => choose(t.id)}
              className={cx("rounded-full px-3.5 py-1.5 text-sm font-medium border whitespace-nowrap",
                tab === t.id ? "bg-night text-white border-night" : "bg-white text-muted border-line")}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "inbox" && <Inbox mode="admin" />}
      {tab === "people" && <People />}
      {tab === "invites" && <Invites />}
      {tab === "leaflets" && <LeafletsAdmin />}
      {tab === "questions" && <QuestionsAdmin />}
      {tab === "announcements" && <AnnouncementsAdmin />}
      {tab === "events" && <EventsAdmin />}
      {tab === "audit" && <Audit />}
    </AppShell>
  );
}
