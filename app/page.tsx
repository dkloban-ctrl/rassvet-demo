"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PushPrompt } from "@/components/Notifications";
import { Badge, Card, ErrorBox, Loading, SectionTitle } from "@/components/ui";
import { useAuth } from "./providers";
import { fmtDate, fmtWeek, fmtWeekday, fmtTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Announcement, EventItem, Leaflet, Question } from "@/lib/types";
import { must, useLoad } from "@/lib/useLoad";

export default function Home() {
  return (
    <AppShell>
      <Week />
    </AppShell>
  );
}

function Week() {
  const { profile } = useAuth();
  const { data, error, loading } = useLoad(async () => {
    const now = new Date().toISOString();
    const [leaflet, question, events, ann] = await Promise.all([
      supabase.from("leaflets").select("*").not("published_at", "is", null).lte("published_at", now)
        .order("week", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("questions").select("*").not("published_at", "is", null).lte("published_at", now)
        .order("week", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("events").select("*").gte("starts_at", now).order("starts_at").limit(2),
      supabase.from("announcements").select("*").not("published_at", "is", null).lte("published_at", now)
        .order("pinned", { ascending: false }).order("published_at", { ascending: false }).limit(3),
    ]);
    const q = must(question) as Question | null;
    let answered = false;
    if (q && profile?.role === "teen") {
      const { count } = await supabase.from("answers").select("id", { count: "exact", head: true })
        .eq("question_id", q.id).eq("author_id", profile.id);
      answered = (count ?? 0) > 0;
    }
    return {
      leaflet: must(leaflet) as Leaflet | null,
      question: q,
      answered,
      events: must(events) as EventItem[],
      ann: must(ann) as Announcement[],
    };
  }, [profile?.id]);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;
  const { leaflet, question, answered, events, ann } = data;
  const open = question && (!question.closes_at || new Date(question.closes_at) > new Date());

  return (
    <div>
      <p className="px-1 text-sm text-muted">Привет, {profile?.display_name}!</p>
      <PushPrompt />

      {leaflet ? (
        <Link href={`/leaflet/?id=${leaflet.id}`} className="block mt-3">
          <div className="rounded-3xl bg-sunrise text-white p-5 shadow-md">
            <p className="text-xs uppercase tracking-widest text-white/75">Листок недели · {fmtWeek(leaflet.week)}</p>
            <h2 className="text-2xl font-bold mt-2">{leaflet.title}</h2>
            {leaflet.verse_text && (
              <p className="font-serif italic text-[15px] leading-snug mt-3 text-white/95">
                «{leaflet.verse_text}» <span className="not-italic text-white/75">— {leaflet.verse_ref}</span>
              </p>
            )}
            <p className="mt-4 text-sm font-semibold text-gold">Читать →</p>
          </div>
        </Link>
      ) : (
        <Card className="mt-3 text-sm text-muted">Листок этой недели скоро появится.</Card>
      )}

      {question && (
        <>
          <SectionTitle>Вопрос недели</SectionTitle>
          <Link href="/question/" className="block">
            <Card className="hover:border-coral/50 transition">
              <p className="text-[17px] font-semibold text-night leading-snug">{question.body}</p>
              <div className="mt-3 flex items-center gap-2">
                {profile?.role === "teen" && (answered ? <Badge tone="green">Ты ответил(а)</Badge> : open ? <Badge tone="gold">Ждём твой ответ</Badge> : null)}
                {!open && <Badge>Ответы закрыты</Badge>}
                {profile?.role === "parent" && <span className="text-xs text-muted">Хороший повод поговорить дома</span>}
                <span className="ml-auto text-sm font-semibold text-coral">
                  {profile?.role === "teen" && open && !answered ? "Ответить →" : "Открыть →"}
                </span>
              </div>
            </Card>
          </Link>
        </>
      )}

      <SectionTitle action={<Link href="/schedule/" className="text-xs font-semibold text-dusk">Все →</Link>}>Ближайшие встречи</SectionTitle>
      {events.length ? (
        <div className="space-y-2">
          {events.map((ev) => (
            <Card key={ev.id} className="flex gap-3 items-center">
              <div className="rounded-xl bg-dawn text-night w-14 py-1.5 text-center shrink-0">
                <div className="text-lg font-bold leading-none">{new Date(ev.starts_at).toLocaleDateString("ru-RU", { day: "numeric", timeZone: "Europe/Minsk" })}</div>
                <div className="text-[11px] uppercase">{new Date(ev.starts_at).toLocaleDateString("ru-RU", { month: "short", timeZone: "Europe/Minsk" })}</div>
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-night">{ev.title}</p>
                <p className="text-sm text-muted truncate">{fmtWeekday(ev.starts_at).split(",")[0]}, {fmtTime(ev.starts_at)}{ev.place ? ` · ${ev.place}` : ""}</p>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="text-sm text-muted">Встреч пока не запланировано.</Card>
      )}

      {ann.length > 0 && (
        <>
          <SectionTitle>Объявления</SectionTitle>
          <div className="space-y-2">
            {ann.map((a) => (
              <Card key={a.id}>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-night">{a.title}</p>
                  {a.pinned && <Badge tone="gold">важно</Badge>}
                </div>
                <p className="text-sm text-ink/80 mt-1 whitespace-pre-line">{a.body}</p>
                {a.published_at && <p className="text-xs text-muted mt-2">{fmtDate(a.published_at)}</p>}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
