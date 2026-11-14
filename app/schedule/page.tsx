"use client";

import { AppShell } from "@/components/AppShell";
import { Badge, Card, Empty, ErrorBox, Loading, PageTitle, SectionTitle } from "@/components/ui";
import { fmtDate, fmtTime, fmtWeekday } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Announcement, EventItem } from "@/lib/types";
import { must, useLoad } from "@/lib/useLoad";

export default function SchedulePage() {
  return (
    <AppShell>
      <Schedule />
    </AppShell>
  );
}

function Schedule() {
  const { data, error, loading } = useLoad(async () => {
    const now = new Date().toISOString();
    const [ev, ann] = await Promise.all([
      supabase.from("events").select("*").gte("starts_at", new Date(Date.now() - 3 * 3600e3).toISOString()).order("starts_at"),
      supabase.from("announcements").select("*").not("published_at", "is", null).lte("published_at", now)
        .order("pinned", { ascending: false }).order("published_at", { ascending: false }),
    ]);
    return { events: must(ev) as EventItem[], ann: must(ann) as Announcement[] };
  }, []);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;

  return (
    <div>
      <PageTitle>Встречи и объявления</PageTitle>
      <SectionTitle>Расписание</SectionTitle>
      {data.events.length === 0 ? <Empty>Встреч пока не запланировано.</Empty> : (
        <div className="space-y-2">
          {data.events.map((ev) => (
            <Card key={ev.id}>
              <p className="text-xs font-semibold uppercase tracking-wide text-coral">{fmtWeekday(ev.starts_at)}</p>
              <p className="text-lg font-bold text-night mt-0.5">{ev.title}</p>
              <p className="text-sm text-muted">
                {fmtTime(ev.starts_at)}{ev.ends_at ? `–${fmtTime(ev.ends_at)}` : ""}{ev.place ? ` · ${ev.place}` : ""}
              </p>
              {ev.note && <p className="text-sm mt-2">{ev.note}</p>}
            </Card>
          ))}
        </div>
      )}

      <SectionTitle>Объявления</SectionTitle>
      {data.ann.length === 0 ? <Empty>Объявлений нет.</Empty> : (
        <div className="space-y-2">
          {data.ann.map((a) => (
            <Card key={a.id}>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-night">{a.title}</p>
                {a.pinned && <Badge tone="gold">важно</Badge>}
              </div>
              <p className="text-sm mt-1 whitespace-pre-line">{a.body}</p>
              {a.published_at && <p className="text-xs text-muted mt-2">{fmtDate(a.published_at)}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
