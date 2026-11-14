"use client";

import { useState } from "react";
import { useAuth } from "@/app/providers";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { humanError, supabase } from "@/lib/supabase";
import type { InboxAccess, Message, Profile, Thread } from "@/lib/types";
import { must, useLoad } from "@/lib/useLoad";
import { IconBack, IconEye } from "./icons";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Notice, SectionTitle, Textarea, cx } from "./ui";

type Data = {
  threads: Thread[];
  messages: Message[];
  people: Record<string, Pick<Profile, "id" | "display_name" | "role">>;
  watchers: InboxAccess[];
};

async function loadInbox(): Promise<Data> {
  const [t, m, p, w] = await Promise.all([
    supabase.from("inbox_threads").select("*").order("created_at", { ascending: false }),
    supabase.from("inbox_messages").select("*").order("created_at"),
    supabase.from("profiles").select("id, display_name, role"),
    supabase.from("parent_inbox_access").select("*").is("revoked_at", null),
  ]);
  const people = must(p) as Pick<Profile, "id" | "display_name" | "role">[];
  return {
    threads: must(t) as Thread[],
    messages: must(m) as Message[],
    people: Object.fromEntries(people.map((x) => [x.id, x])),
    watchers: must(w) as InboxAccess[],
  };
}

/** «Написать лидеру» для подростков, помощников и родителей. Админский вид — mode="admin". */
export function Inbox({ mode = "user" }: { mode?: "user" | "admin" }) {
  const { profile } = useAuth();
  const { data, error, loading, reload } = useLoad(loadInbox, []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;

  const leaders = Object.values(data.people).filter((p) => p.role === "admin").map((p) => p.display_name);
  const myWatchers = data.watchers.filter((w) => w.teen_id === profile!.id);

  const thread = openId ? data.threads.find((t) => t.id === openId) : null;
  if (thread) {
    return (
      <ThreadView thread={thread} data={data} mode={mode} onBack={() => setOpenId(null)} onChange={reload}
                  leaders={leaders} watchers={myWatchers} />
    );
  }

  const threads = mode === "admin" && filter === "open" ? data.threads.filter((t) => t.status === "open") : data.threads;

  return (
    <div>
      {mode === "user" && (
        <>
          <WhoSees leaders={leaders} watchers={myWatchers} people={data.people} />
          <NewThread onCreated={(id) => { reload(); setOpenId(id); }} />
          <p className="text-xs text-muted mt-3 px-1">
            Если тебе или кому-то угрожает опасность прямо сейчас — звони <b>112</b>.
          </p>
        </>
      )}

      {mode === "admin" && (
        <div className="flex gap-2 mb-3">
          {(["open", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cx("rounded-full px-3 py-1 text-sm font-medium border", filter === f ? "bg-night text-white border-night" : "bg-white border-line text-muted")}>
              {f === "open" ? "Открытые" : "Все"}
            </button>
          ))}
        </div>
      )}

      <SectionTitle>{mode === "admin" ? "Обращения" : "Мои обращения"}</SectionTitle>
      {threads.length === 0 ? (
        <Empty>{mode === "admin" ? "Нет обращений." : "Пока пусто. Напиши, если что-то нужно, — лидеры ответят."}</Empty>
      ) : (
        <Card className="p-0 divide-y divide-line">
          {threads.map((t) => {
            const msgs = data.messages.filter((m) => m.thread_id === t.id);
            const last = msgs[msgs.length - 1];
            const author = t.author_id ? data.people[t.author_id] : null;
            const awaiting = last && last.author_id === t.author_id && t.status === "open";
            return (
              <button key={t.id} onClick={() => setOpenId(t.id)} className="w-full text-left px-4 py-3 hover:bg-cream">
                <div className="flex items-center gap-2">
                  {mode === "admin" && <span className="font-semibold text-night">{author?.display_name ?? "Удалённый аккаунт"}</span>}
                  {t.kind === "report" && <Badge tone="red">жалоба</Badge>}
                  {t.status === "closed" && <Badge>закрыто</Badge>}
                  {mode === "admin" && awaiting && <Badge tone="gold">ждёт ответа</Badge>}
                  <span className="ml-auto text-xs text-muted">{last ? fmtDate(last.created_at) : fmtDate(t.created_at)}</span>
                </div>
                <p className="text-sm text-ink/80 line-clamp-2 mt-0.5">{last?.body ?? "—"}</p>
              </button>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function WhoSees({ leaders, watchers, people }: { leaders: string[]; watchers: InboxAccess[]; people: Data["people"] }) {
  return (
    <Card className="bg-dawn border-[#f5dfb8]">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-night"><IconEye /> Кто читает эти сообщения</p>
      <ul className="text-sm mt-1.5 space-y-0.5 text-ink/85">
        <li>Все лидеры: {leaders.join(", ") || "—"}</li>
        {watchers.map((w) => (
          <li key={w.id}>
            Родитель: <b>{people[w.parent_id]?.display_name ?? "родитель"}</b> — сообщения начиная с {fmtDate(w.granted_at)}
          </li>
        ))}
        <li className="text-muted">Помощники и другие ребята не видят.</li>
      </ul>
    </Card>
  );
}

function NewThread({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"message" | "report">("message");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!body.trim()) return setError("Напиши сообщение");
    setBusy(true);
    setError(null);
    try {
      const t = await supabase.from("inbox_threads").insert({ kind }).select("id").single();
      if (t.error) throw t.error;
      const m = await supabase.from("inbox_messages").insert({ thread_id: t.data.id, body: body.trim() });
      if (m.error) throw m.error;
      setBody("");
      setOpen(false);
      onCreated(t.data.id);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <Button className="w-full mt-4" onClick={() => setOpen(true)}>Написать лидеру</Button>;
  return (
    <Card className="mt-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-cream p-1 border border-line mb-3">
        {(["message", "report"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={cx("rounded-lg py-2 text-sm font-semibold", kind === k ? "bg-white shadow-sm text-night" : "text-muted")}>
            {k === "message" ? "Сообщение" : "Сообщить о проблеме"}
          </button>
        ))}
      </div>
      {kind === "report" && (
        <p className="text-xs text-muted mb-2">Если кто-то обижает, пишет что-то неприятное или тебя что-то тревожит — расскажи. Лидеры разберутся.</p>
      )}
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="Что случилось или о чём хочешь спросить?" />
      <p className="text-xs text-muted mt-2">Сообщения нельзя изменить или удалить после отправки.</p>
      <ErrorBox>{error}</ErrorBox>
      <div className="flex gap-2 mt-3">
        <Button onClick={send} loading={busy}>Отправить</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
      </div>
    </Card>
  );
}

function ThreadView({ thread, data, mode, onBack, onChange, leaders, watchers }: {
  thread: Thread; data: Data; mode: "user" | "admin"; onBack: () => void; onChange: () => void;
  leaders: string[]; watchers: InboxAccess[];
}) {
  const { profile } = useAuth();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const msgs = data.messages.filter((m) => m.thread_id === thread.id);
  const author = thread.author_id ? data.people[thread.author_id] : null;
  const canWrite = mode === "admin" || thread.status === "open";

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("inbox_messages").insert({ thread_id: thread.id, body: body.trim() });
    setBusy(false);
    if (error) return setError(humanError(error));
    setBody("");
    onChange();
  }
  async function setStatus(status: "open" | "closed") {
    setBusy(true);
    const { error } = await supabase.from("inbox_threads").update({ status }).eq("id", thread.id);
    setBusy(false);
    if (error) return setError(humanError(error));
    onChange();
  }

  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-dusk mb-3"><IconBack /> Назад</button>
      <div className="flex items-center gap-2 mb-3 px-1">
        <h1 className="text-xl font-bold text-night">{mode === "admin" ? author?.display_name ?? "Удалённый аккаунт" : "Обращение"}</h1>
        {thread.kind === "report" && <Badge tone="red">жалоба</Badge>}
        {thread.status === "closed" && <Badge>закрыто</Badge>}
      </div>
      {mode === "user" && <WhoSees leaders={leaders} watchers={watchers} people={data.people} />}
      {mode === "admin" && (
        <Notice>Переписку видят все лидеры{author ? `, а также родители автора, если им открыт доступ` : ""}. Помощники не видят.</Notice>
      )}

      <div className="space-y-2 mt-4">
        {msgs.map((m) => {
          const mine = m.author_id === profile!.id;
          const who = m.author_id ? data.people[m.author_id] : null;
          return (
            <div key={m.id} className={cx("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cx("max-w-[85%] rounded-2xl px-3.5 py-2", mine ? "bg-night text-white rounded-br-md" : "bg-white border border-line rounded-bl-md")}>
                {!mine && <p className={cx("text-xs font-semibold mb-0.5", who?.role === "admin" ? "text-plum" : "text-dusk")}>
                  {who?.display_name ?? "—"}{who?.role === "admin" ? " · лидер" : ""}
                </p>}
                <p className="text-[15px] whitespace-pre-line">{m.body}</p>
                <p className={cx("text-[11px] mt-1", mine ? "text-white/60" : "text-muted")}>{fmtDateTime(m.created_at)}</p>
              </div>
            </div>
          );
        })}
      </div>

      <ErrorBox>{error}</ErrorBox>
      {canWrite ? (
        <div className="mt-4">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Сообщение…" />
          <div className="flex gap-2 mt-2">
            <Button onClick={send} loading={busy}>Отправить</Button>
            {mode === "admin" && (thread.status === "open"
              ? <Button variant="secondary" onClick={() => setStatus("closed")} loading={busy}>Закрыть обращение</Button>
              : <Button variant="secondary" onClick={() => setStatus("open")} loading={busy}>Открыть снова</Button>)}
          </div>
        </div>
      ) : (
        <Notice>Обращение закрыто лидером. Если нужно — начни новое.</Notice>
      )}
    </div>
  );
}
