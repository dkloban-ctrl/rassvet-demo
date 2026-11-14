"use client";

import { AppShell } from "@/components/AppShell";
import { Inbox } from "@/components/Inbox";
import { PageTitle } from "@/components/ui";

export default function InboxPage() {
  return (
    <AppShell allow={["teen", "helper", "parent"]}>
      <PageTitle sub="Сообщение уходит всем лидерам сразу. Личной переписки один на один в приложении нет — так безопаснее для всех.">
        Написать лидеру
      </PageTitle>
      <Inbox />
    </AppShell>
  );
}
