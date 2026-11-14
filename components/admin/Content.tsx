"use client";

import { useState } from "react";
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Field, Input, Loading, SectionTitle, Textarea } from "@/components/ui";
import { currentMonday, fmtDate, fmtDateTime, fmtWeek, fromLocalInput, toLocalInput } from "@/lib/format";
import { humanError, supabase } from "@/lib/supabase";
import type { Announcement, EventItem, Leaflet, Question } from "@/lib/types";
import { must, useLoad } from "@/lib/useLoad";

type Table = "leaflets" | "questions" | "announcements" | "events";

function useSave(table: Table, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(id: string | null, values: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = id
      ? await supabase.from(table).update(values).eq("id", id)
      : await supabase.from(table).insert(values);
    setBusy(false);
    if (res.error) return setError(humanError(res.error));
    onDone();
  }
  async function remove(id: string) {
    setBusy(true);
    const res = await supabase.from(table).delete().eq("id", id);
    setBusy(false);
    if (res.error) return setError(humanError(res.error));
    onDone();
  }
  return { busy, error, save, remove };
}

/** published_at: оставить прежнюю дату, если уже опубликовано; иначе сейчас / null. */
const publishValue = (checked: boolean, prev: string | null | undefined) => (checked ? prev ?? new Date().toISOString() : null);

function PublishBox({ checked, onChange, label = "Опубликовать (увидят все)" }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm mb-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#1c2340]" />
      {label}
    </label>
  );
}

function DeleteButton({ busy, onConfirm, what }: { busy: boolean; onConfirm: () => void; what: string }) {
  const [ask, setAsk] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setAsk(true)}>Удалить</Button>
      <Confirm open={ask} title={`Удалить ${what}?`} text="Действие попадёт в журнал." danger confirmText="Удалить" loading={busy}
        onConfirm={() => { setAsk(false); onConfirm(); }} onCancel={() => setAsk(false)} />
    </>
  );
}


// ───────────────── Статус рассылки (очередь notification_outbox) ─────────────────
type Outbox = { ref_id: string; sent_at: string | null; due_at: string; push_sent: number | null; emails_sent: number | null; attempts: number; note: string | null };

function useNotifyStatus(kind: "leaflet" | "question" | "announcement", list: unknown) {
  const { data } = useLoad(async () => {
    const { data } = await supabase.from("notification_outbox")
      .select("ref_id, sent_at, due_at, push_sent, emails_sent, attempts, note").eq("kind", kind);
    return new Map(((data ?? []) as Outbox[]).map((r) => [r.ref_id, r]));
  }, [kind, list]); // перечитываем вместе со списком (после сохранения)
  return data ?? new Map<string, Outbox>();
}

function NotifyBadge({ row }: { row?: Outbox }) {
  if (!row) return null;
  if (row.sent_at) {
    const emails = row.emails_sent ? ` · ✉ ${row.emails_sent}` : "";
    return <span className="text-xs text-muted" title={row.note ?? "уведомление отправлено"}>🔔 {row.push_sent ?? 0}{emails}</span>;
  }
  if (row.attempts >= 5) return <span className="text-xs text-red-700" title={row.note ?? ""}>🔔 не ушло</span>;
  return <span className="text-xs text-muted" title={row.note ?? ""}>🔔 {new Date(row.due_at) > new Date() ? `в ${fmtDateTime(row.due_at)}` : "отправляется…"}</span>;
}

const NOTIFY_HINT = " — придёт уведомление";

// ───────────────────────── Листки ─────────────────────────
export function LeafletsAdmin() {
  const { data, error, loading, reload } = useLoad(async () =>
    must(await supabase.from("leaflets").select("*").order("week", { ascending: false })) as Leaflet[], []);
  const notify = useNotifyStatus("leaflet", data);
  const [edit, setEdit] = useState<Leaflet | "new" | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;
  if (edit) return <LeafletForm item={edit === "new" ? null : edit} onDone={() => { setEdit(null); reload(); }} onCancel={() => setEdit(null)} />;
  return (
    <div>
      <Button onClick={() => setEdit("new")}>Новый листок</Button>
      <SectionTitle>Листки</SectionTitle>
      {data.length === 0 ? <Empty>Пока нет листков.</Empty> : (
        <Card className="p-0 divide-y divide-line">
          {data.map((l) => (
            <button key={l.id} onClick={() => setEdit(l)} className="w-full text-left px-4 py-3 hover:bg-cream flex items-center gap-2">
              <div className="min-w-0">
                <p className="font-medium text-night truncate">{l.title}</p>
                <p className="text-xs text-muted">{fmtWeek(l.week)}{l.verse_ref ? ` · ${l.verse_ref}` : ""}</p>
              </div>
              <span className="ml-auto flex items-center gap-2 shrink-0"><NotifyBadge row={notify.get(l.id)} />{l.published_at ? <Badge tone="green">опубликован</Badge> : <Badge tone="gold">черновик</Badge>}</span>
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

function LeafletForm({ item, onDone, onCancel }: { item: Leaflet | null; onDone: () => void; onCancel: () => void }) {
  const [week, setWeek] = useState(item?.week ?? currentMonday(1));
  const [title, setTitle] = useState(item?.title ?? "");
  const [verseRef, setVerseRef] = useState(item?.verse_ref ?? "");
  const [verseText, setVerseText] = useState(item?.verse_text ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [pub, setPub] = useState(!!item?.published_at);
  const { busy, error, save, remove } = useSave("leaflets", onDone);
  return (
    <Card>
      <p className="font-semibold text-night mb-3">{item ? "Редактирование листка" : "Новый листок"}</p>
      <Field label="Неделя (понедельник)"><Input type="date" value={week} onChange={(e) => setWeek(e.target.value)} /></Field>
      <Field label="Заголовок"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Ссылка на стих" hint="Например: Мк 1:35"><Input value={verseRef} onChange={(e) => setVerseRef(e.target.value)} /></Field>
      <Field label="Текст стиха" hint="Синодальный перевод, слово в слово"><Textarea value={verseText} onChange={(e) => setVerseText(e.target.value)} className="min-h-16" /></Field>
      <Field label="Текст листка" hint="Абзацы — через пустую строку. ## Подзаголовок, - пункт списка, **жирный**.">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-64" />
      </Field>
      <PublishBox checked={pub} onChange={setPub} label={`Опубликовать (увидят все)${item?.published_at ? "" : NOTIFY_HINT}`} />
      <ErrorBox>{error}</ErrorBox>
      <div className="flex gap-2 flex-wrap">
        <Button loading={busy} disabled={!title.trim() || !body.trim()} onClick={() => save(item?.id ?? null, {
          week, title: title.trim(), body, verse_ref: verseRef.trim() || null, verse_text: verseText.trim() || null,
          published_at: publishValue(pub, item?.published_at),
        })}>Сохранить</Button>
        <Button variant="secondary" onClick={onCancel}>Отмена</Button>
        {item && <DeleteButton busy={busy} what="листок" onConfirm={() => remove(item.id)} />}
      </div>
    </Card>
  );
}

// ───────────────────────── Вопросы ─────────────────────────
export function QuestionsAdmin() {
  const { data, error, loading, reload } = useLoad(async () =>
    must(await supabase.from("questions").select("*").order("week", { ascending: false })) as Question[], []);
  const notify = useNotifyStatus("question", data);
  const [edit, setEdit] = useState<Question | "new" | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;
  if (edit) return <QuestionForm item={edit === "new" ? null : edit} onDone={() => { setEdit(null); reload(); }} onCancel={() => setEdit(null)} />;
  return (
    <div>
      <Button onClick={() => setEdit("new")}>Новый вопрос</Button>
      <SectionTitle>Вопросы недели</SectionTitle>
      {data.length === 0 ? <Empty>Пока нет вопросов.</Empty> : (
        <Card className="p-0 divide-y divide-line">
          {data.map((q) => {
            const closed = q.closes_at && new Date(q.closes_at) <= new Date();
            return (
              <button key={q.id} onClick={() => setEdit(q)} className="w-full text-left px-4 py-3 hover:bg-cream">
                <p className="text-sm font-medium text-night line-clamp-2">{q.body}</p>
                <div className="flex gap-2 mt-1 items-center">
                  <span className="text-xs text-muted">{fmtWeek(q.week)}</span>
                  {!q.published_at ? <Badge tone="gold">черновик</Badge> : closed ? <Badge>закрыт</Badge> : <Badge tone="green">открыт</Badge>}
                  <NotifyBadge row={notify.get(q.id)} />
                </div>
              </button>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function QuestionForm({ item, onDone, onCancel }: { item: Question | null; onDone: () => void; onCancel: () => void }) {
  const [week, setWeek] = useState(item?.week ?? currentMonday(1));
  const [body, setBody] = useState(item?.body ?? "");
  const [pub, setPub] = useState(!!item?.published_at);
  const [closes, setCloses] = useState(toLocalInput(item?.closes_at ?? null));
  const { busy, error, save, remove } = useSave("questions", onDone);
  return (
    <Card>
      <p className="font-semibold text-night mb-3">{item ? "Редактирование вопроса" : "Новый вопрос"}</p>
      <Field label="Неделя (понедельник)"><Input type="date" value={week} onChange={(e) => setWeek(e.target.value)} /></Field>
      <Field label="Вопрос" hint="Открытый, личный, без «правильного» ответа"><Textarea value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <Field label="Принимать ответы до" hint="Пусто — без срока"><Input type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} /></Field>
      <PublishBox checked={pub} onChange={setPub} label={`Опубликовать (ребята смогут отвечать)${item?.published_at ? "" : NOTIFY_HINT}`} />
      <ErrorBox>{error}</ErrorBox>
      <div className="flex gap-2 flex-wrap">
        <Button loading={busy} disabled={!body.trim()} onClick={() => save(item?.id ?? null, {
          week, body: body.trim(), closes_at: fromLocalInput(closes), published_at: publishValue(pub, item?.published_at),
        })}>Сохранить</Button>
        <Button variant="secondary" onClick={onCancel}>Отмена</Button>
        {item && <DeleteButton busy={busy} what="вопрос со всеми ответами" onConfirm={() => remove(item.id)} />}
      </div>
    </Card>
  );
}

// ───────────────────────── Объявления ─────────────────────────
export function AnnouncementsAdmin() {
  const { data, error, loading, reload } = useLoad(async () =>
    must(await supabase.from("announcements").select("*").order("created_at", { ascending: false })) as Announcement[], []);
  const notify = useNotifyStatus("announcement", data);
  const [edit, setEdit] = useState<Announcement | "new" | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;
  if (edit) return <AnnouncementForm item={edit === "new" ? null : edit} onDone={() => { setEdit(null); reload(); }} onCancel={() => setEdit(null)} />;
  return (
    <div>
      <Button onClick={() => setEdit("new")}>Новое объявление</Button>
      <SectionTitle>Объявления</SectionTitle>
      {data.length === 0 ? <Empty>Нет объявлений.</Empty> : (
        <Card className="p-0 divide-y divide-line">
          {data.map((a) => (
            <button key={a.id} onClick={() => setEdit(a)} className="w-full text-left px-4 py-3 hover:bg-cream">
              <div className="flex gap-2 items-center">
                <p className="font-medium text-night">{a.title}</p>
                {a.pinned && <Badge tone="gold">важно</Badge>}
                {!a.published_at && <Badge>черновик</Badge>}
                <span className="ml-auto"><NotifyBadge row={notify.get(a.id)} /></span>
              </div>
              <p className="text-xs text-muted">{fmtDate(a.published_at ?? a.created_at)}</p>
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

function AnnouncementForm({ item, onDone, onCancel }: { item: Announcement | null; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [pinned, setPinned] = useState(item?.pinned ?? false);
  const [pub, setPub] = useState(item ? !!item.published_at : true);
  const { busy, error, save, remove } = useSave("announcements", onDone);
  return (
    <Card>
      <p className="font-semibold text-night mb-3">{item ? "Редактирование" : "Новое объявление"}</p>
      <Field label="Заголовок"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Текст"><Textarea value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <PublishBox checked={pinned} onChange={setPinned} label="Важное (закрепить сверху)" />
      <PublishBox checked={pub} onChange={setPub} label={`Опубликовать (увидят все)${item?.published_at ? "" : NOTIFY_HINT}`} />
      <ErrorBox>{error}</ErrorBox>
      <div className="flex gap-2 flex-wrap">
        <Button loading={busy} disabled={!title.trim() || !body.trim()} onClick={() => save(item?.id ?? null, {
          title: title.trim(), body: body.trim(), pinned, published_at: publishValue(pub, item?.published_at),
        })}>Сохранить</Button>
        <Button variant="secondary" onClick={onCancel}>Отмена</Button>
        {item && <DeleteButton busy={busy} what="объявление" onConfirm={() => remove(item.id)} />}
      </div>
    </Card>
  );
}

// ───────────────────────── События ─────────────────────────
export function EventsAdmin() {
  const { data, error, loading, reload } = useLoad(async () =>
    must(await supabase.from("events").select("*").order("starts_at", { ascending: false })) as EventItem[], []);
  const [edit, setEdit] = useState<EventItem | "new" | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;
  if (edit) return <EventForm item={edit === "new" ? null : edit} onDone={() => { setEdit(null); reload(); }} onCancel={() => setEdit(null)} />;
  return (
    <div>
      <Button onClick={() => setEdit("new")}>Новая встреча</Button>
      <SectionTitle>Расписание</SectionTitle>
      {data.length === 0 ? <Empty>Встреч нет.</Empty> : (
        <Card className="p-0 divide-y divide-line">
          {data.map((ev) => (
            <button key={ev.id} onClick={() => setEdit(ev)} className="w-full text-left px-4 py-3 hover:bg-cream">
              <p className="font-medium text-night">{ev.title}</p>
              <p className="text-xs text-muted">{fmtDateTime(ev.starts_at)}{ev.place ? ` · ${ev.place}` : ""}
                {new Date(ev.starts_at) < new Date() ? " · прошла" : ""}</p>
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

function EventForm({ item, onDone, onCancel }: { item: EventItem | null; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(item?.title ?? "Подростковая встреча");
  const [starts, setStarts] = useState(toLocalInput(item?.starts_at ?? null));
  const [ends, setEnds] = useState(toLocalInput(item?.ends_at ?? null));
  const [place, setPlace] = useState(item?.place ?? "церковь «Вифания»");
  const [note, setNote] = useState(item?.note ?? "");
  const { busy, error, save, remove } = useSave("events", onDone);
  return (
    <Card>
      <p className="font-semibold text-night mb-3">{item ? "Редактирование встречи" : "Новая встреча"}</p>
      <Field label="Название"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Начало"><Input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></Field>
      <Field label="Окончание (необязательно)"><Input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></Field>
      <Field label="Место"><Input value={place} onChange={(e) => setPlace(e.target.value)} /></Field>
      <Field label="Заметка"><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" /></Field>
      <ErrorBox>{error}</ErrorBox>
      <div className="flex gap-2 flex-wrap">
        <Button loading={busy} disabled={!title.trim() || !starts} onClick={() => save(item?.id ?? null, {
          title: title.trim(), starts_at: fromLocalInput(starts), ends_at: fromLocalInput(ends), place: place.trim() || null, note: note.trim() || null,
        })}>Сохранить</Button>
        <Button variant="secondary" onClick={onCancel}>Отмена</Button>
        {item && <DeleteButton busy={busy} what="встречу" onConfirm={() => remove(item.id)} />}
      </div>
    </Card>
  );
}
