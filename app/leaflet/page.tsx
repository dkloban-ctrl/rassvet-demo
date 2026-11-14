"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { IconBack } from "@/components/icons";
import { Badge, Card, ErrorBox, Loading, SectionTitle } from "@/components/ui";
import { fmtWeek } from "@/lib/format";
import { Markdown } from "@/lib/markdown";
import { supabase } from "@/lib/supabase";
import type { Leaflet } from "@/lib/types";
import { must, useLoad } from "@/lib/useLoad";

export default function LeafletPage() {
  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <LeafletView />
      </Suspense>
    </AppShell>
  );
}

function LeafletView() {
  const id = useSearchParams().get("id");
  const { data, error, loading } = useLoad(async () => {
    const all = must(await supabase.from("leaflets").select("id, week, title, published_at, verse_ref").order("week", { ascending: false })) as Leaflet[];
    const targetId = id ?? all.find((l) => l.published_at)?.id;
    const one = targetId
      ? (must(await supabase.from("leaflets").select("*").eq("id", targetId).maybeSingle()) as Leaflet | null)
      : null;
    return { all, one };
  }, [id]);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;
  const { all, one } = data;

  return (
    <div>
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-dusk mb-3"><IconBack /> Неделя</Link>
      {one ? (
        <article>
          <p className="text-xs uppercase tracking-widest text-muted px-1">Листок недели · {fmtWeek(one.week)}</p>
          <h1 className="text-3xl font-bold text-night mt-1 px-1">{one.title}</h1>
          {!one.published_at && <div className="px-1 mt-2"><Badge tone="gold">черновик — видят только лидеры</Badge></div>}
          {one.verse_text && (
            <div className="bg-sunrise-soft rounded-2xl p-4 mt-4 border border-[#f5dfb8]">
              <p className="font-serif italic text-[17px] leading-snug text-night">«{one.verse_text}»</p>
              <p className="text-sm text-plum mt-2 font-semibold">{one.verse_ref}</p>
            </div>
          )}
          <div className="mt-5 px-1">
            <Markdown text={one.body} />
          </div>
          <Link href="/question/" className="block mt-4">
            <Card className="bg-dawn border-[#f5dfb8]">
              <p className="text-sm font-semibold text-night">Есть вопрос недели к этому листку →</p>
            </Card>
          </Link>
        </article>
      ) : (
        <Card className="text-sm text-muted">Листок не найден.</Card>
      )}

      {all.length > 1 && (
        <>
          <SectionTitle>Архив листков</SectionTitle>
          <Card className="p-0 divide-y divide-line">
            {all.filter((l) => l.id !== one?.id).map((l) => (
              <Link key={l.id} href={`/leaflet/?id=${l.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-cream">
                <div>
                  <p className="font-medium text-night">{l.title}</p>
                  <p className="text-xs text-muted">{fmtWeek(l.week)}{l.verse_ref ? ` · ${l.verse_ref}` : ""}</p>
                </div>
                {!l.published_at && <Badge tone="gold">черновик</Badge>}
              </Link>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
