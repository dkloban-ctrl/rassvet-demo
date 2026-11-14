"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/app/providers";
import { AppShell } from "@/components/AppShell";
import { IconEye, IconLock } from "@/components/icons";
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Loading, Notice, SectionTitle, Textarea, cx } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtWeek } from "@/lib/format";
import { humanError, supabase } from "@/lib/supabase";
import type { FeedItem, Question, Reply } from "@/lib/types";
import { must, useLoad } from "@/lib/useLoad";

export default function QuestionPage() {
  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <QuestionView />
      </Suspense>
    </AppShell>
  );
}

function QuestionView() {
  const id = useSearchParams().get("id");
  const { profile } = useAuth();
  const role = profile!.role;

  const { data, error, loading, reload } = useLoad(async () => {
    const qs = must(await supabase.from("questions").select("*").order("week", { ascending: false })) as Question[];
    const visible = role === "admin" ? qs : qs.filter((q) => q.published_at);
    const q = (id ? qs.find((x) => x.id === id) : visible.find((x) => x.published_at)) ?? null;
    let feed: FeedItem[] = [];
    let replies: Reply[] = [];
    if (q && role !== "parent") {
      feed = must(await supabase.rpc("answers_feed", { p_question: q.id })) as FeedItem[];
      if (feed.length) {
        replies = must(await supabase.from("answer_replies").select("*").in("answer_id", feed.map((f) => f.id)).order("created_at")) as Reply[];
      }
    }
    const people = must(await supabase.from("profiles").select("id, display_name")) as { id: string; display_name: string }[];
    return { qs: visible, q, feed, replies, names: Object.fromEntries(people.map((p) => [p.id, p.display_name])) };
  }, [id, role]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;
  const { qs, q, feed, replies, names } = data;
  if (!q) return <Empty>Вопросов пока нет.</Empty>;

  const open = !!q.published_at && new Date(q.published_at) <= new Date() && (!q.closes_at || new Date(q.closes_at) > new Date());
  const mine = feed.find((f) => f.is_mine);
  const others = feed.filter((f) => !f.is_mine);

  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-muted px-1">Вопрос недели · {fmtWeek(q.week)}</p>
      <h1 className="text-2xl font-bold text-night mt-1 px-1 leading-snug">{q.body}</h1>
      <div className="px-1 mt-2 flex gap-2 flex-wrap">
        {!q.published_at && <Badge tone="gold">черновик</Badge>}
        {open && q.closes_at && <Badge tone="dusk">отвечаем до {fmtDate(q.closes_at)}</Badge>}
        {!open && q.published_at && <Badge>ответы закрыты</Badge>}
      </div>

      {role === "parent" && (
        <Notice>
          Ответы ребят видят только ребята и лидеры — так подросткам проще быть честными.
          Спросите дома, что ваш подросток думает об этом вопросе.
        </Notice>
      )}

      {role === "teen" && !mine && open && <AnswerForm questionId={q.id} onDone={reload} />}
      {role === "teen" && mine && (
        <>
          <SectionTitle>Твой ответ</SectionTitle>
          <MyAnswer item={mine} open={open} onChange={reload} replies={replies.filter((r) => r.answer_id === mine.id)} names={names} />
        </>
      )}

      {role !== "parent" && (
        <>
          <SectionTitle>{role === "teen" ? "Что ответили ребята" : `Ответы (${feed.length})`}</SectionTitle>
          {(role === "teen" ? others : feed).length === 0 ? (
            <Empty>{role === "teen" ? "Пока никто не ответил — будь первым!" : "Ответов пока нет."}</Empty>
          ) : (
            <div className="space-y-2">
              {(role === "teen" ? others : feed).map((f) => (
                <AnswerCard key={f.id} item={f} isAdmin={role === "admin"} replies={replies.filter((r) => r.answer_id === f.id)} names={names} onChange={reload} />
              ))}
            </div>
          )}
        </>
      )}

      {qs.length > 1 && (
        <>
          <SectionTitle>Другие вопросы</SectionTitle>
          <Card className="p-0 divide-y divide-line">
            {qs.filter((x) => x.id !== q.id).map((x) => (
              <Link key={x.id} href={`/question/?id=${x.id}`} className="block px-4 py-3 hover:bg-cream">
                <p className="text-sm font-medium text-night line-clamp-2">{x.body}</p>
                <p className="text-xs text-muted mt-0.5">{fmtWeek(x.week)}{!x.published_at ? " · черновик" : ""}</p>
              </Link>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function PrivacyToggle({ anon, setAnon }: { anon: boolean; setAnon: (v: boolean) => void }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-cream p-1 border border-line">
        {[false, true].map((v) => (
          <button key={String(v)} type="button" onClick={() => setAnon(v)}
            className={cx("rounded-lg py-2 text-sm font-semibold transition", anon === v ? "bg-white shadow-sm text-night" : "text-muted")}>
            {v ? "Анонимно для ребят" : "С именем"}
          </button>
        ))}
      </div>
      <p className="flex items-start gap-1.5 text-xs text-muted mt-2">
        {anon ? <IconLock /> : <IconEye />}
        <span>
          {anon
            ? <><b className="text-ink">Ребята не увидят твоё имя. Лидеры видят.</b> Помощники тоже не видят.</>
            : "Ответ с твоим именем увидят ребята, помощники и лидеры."}{" "}
          Родители ответов не видят.
        </span>
      </p>
    </div>
  );
}

function AnswerForm({ questionId, onDone }: { questionId: string; onDone: () => void }) {
  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    if (!body.trim()) return setError("Напиши хотя бы пару слов");
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("answers").insert({ question_id: questionId, body: body.trim(), is_anonymous: anon });
    setBusy(false);
    if (error) return setError(humanError(error));
    onDone();
  }
  return (
    <Card className="mt-4">
      <p className="text-sm font-semibold text-night mb-2">Твой ответ</p>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="Честно, своими словами…" />
      <div className="mt-3"><PrivacyToggle anon={anon} setAnon={setAnon} /></div>
      <ErrorBox>{error}</ErrorBox>
      <Button className="w-full mt-3" onClick={send} loading={busy}>Отправить</Button>
    </Card>
  );
}

function MyAnswer({ item, open, onChange, replies, names }: { item: FeedItem; open: boolean; onChange: () => void; replies: Reply[]; names: Record<string, string> }) {
  const [edit, setEdit] = useState(false);
  const [body, setBody] = useState(item.body);
  const [anon, setAnon] = useState(item.is_anonymous);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [del, setDel] = useState(false);

  async function save() {
    setBusy(true);
    const { error } = await supabase.from("answers").update({ body: body.trim(), is_anonymous: anon }).eq("id", item.id);
    setBusy(false);
    if (error) return setError(humanError(error));
    setEdit(false);
    onChange();
  }
  async function remove() {
    setBusy(true);
    const { error } = await supabase.from("answers").delete().eq("id", item.id);
    setBusy(false);
    setDel(false);
    if (error) return setError(humanError(error));
    onChange();
  }

  return (
    <Card className="border-coral/40">
      {edit ? (
        <>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
          <div className="mt-3"><PrivacyToggle anon={anon} setAnon={setAnon} /></div>
          <ErrorBox>{error}</ErrorBox>
          <div className="flex gap-2 mt-3">
            <Button onClick={save} loading={busy}>Сохранить</Button>
            <Button variant="ghost" onClick={() => setEdit(false)}>Отмена</Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex gap-2 mb-1">
            {item.is_anonymous ? <Badge tone="dusk">анонимно для ребят</Badge> : <Badge>с именем</Badge>}
            {item.is_hidden && <Badge tone="red">скрыт лидером</Badge>}
          </div>
          <p className="text-[15px] whitespace-pre-line">{item.body}</p>
          <Replies replies={replies} names={names} />
          <ErrorBox>{error}</ErrorBox>
          {open && (
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="secondary" onClick={() => setEdit(true)}>Изменить</Button>
              <Button size="sm" variant="ghost" onClick={() => setDel(true)}>Удалить</Button>
            </div>
          )}
        </>
      )}
      <Confirm open={del} title="Удалить ответ?" text="Его больше никто не увидит. Можно будет ответить заново, пока вопрос открыт."
        confirmText="Удалить" danger loading={busy} onConfirm={remove} onCancel={() => setDel(false)} />
    </Card>
  );
}

function Replies({ replies, names }: { replies: Reply[]; names: Record<string, string> }) {
  if (!replies.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {replies.map((r) => (
        <div key={r.id} className="rounded-xl bg-dawn px-3 py-2 border-l-4 border-gold">
          <p className="text-xs font-semibold text-plum">{(r.author_id && names[r.author_id]) || "Лидер"} · лидер</p>
          <p className="text-sm whitespace-pre-line mt-0.5">{r.body}</p>
        </div>
      ))}
    </div>
  );
}

function AnswerCard({ item, isAdmin, replies, names, onChange }: { item: FeedItem; isAdmin: boolean; replies: Reply[]; names: Record<string, string>; onChange: () => void }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendReply() {
    if (!reply.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("answer_replies").insert({ answer_id: item.id, body: reply.trim() });
    setBusy(false);
    if (error) return setError(humanError(error));
    setReply("");
    setReplyOpen(false);
    onChange();
  }
  async function toggleHidden() {
    setBusy(true);
    const { error } = await supabase.rpc("hide_answer", { p_answer: item.id, p_hidden: !item.is_hidden });
    setBusy(false);
    if (error) return setError(humanError(error));
    onChange();
  }

  return (
    <Card className={cx(item.is_hidden && "opacity-60")}>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-sm font-semibold text-night">
          {item.author_name ?? "Аноним"}
        </span>
        {item.is_anonymous && isAdmin && <Badge tone="dusk">аноним для ребят</Badge>}
        {item.is_hidden && <Badge tone="red">скрыт</Badge>}
        <span className="ml-auto text-xs text-muted">{fmtDateTime(item.created_at)}</span>
      </div>
      <p className="text-[15px] whitespace-pre-line">{item.body}</p>
      <Replies replies={replies} names={names} />
      {isAdmin && (
        <>
          {item.is_anonymous && replyOpen && (
            <Notice tone="warn">Ответ анонимный. Не называйте автора по имени в ответе — его увидят все ребята.</Notice>
          )}
          {replyOpen && (
            <div className="mt-3">
              <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Ответ лидера (увидят все, кто видит этот ответ)" />
            </div>
          )}
          <ErrorBox>{error}</ErrorBox>
          <div className="flex gap-2 mt-3">
            {replyOpen ? (
              <>
                <Button size="sm" onClick={sendReply} loading={busy}>Отправить</Button>
                <Button size="sm" variant="ghost" onClick={() => setReplyOpen(false)}>Отмена</Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => setReplyOpen(true)}>Ответить</Button>
                <Button size="sm" variant="ghost" onClick={toggleHidden} loading={busy}>{item.is_hidden ? "Показать" : "Скрыть"}</Button>
              </>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
