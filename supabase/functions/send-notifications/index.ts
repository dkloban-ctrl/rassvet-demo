// Рассылка уведомлений: разбирает очередь notification_outbox.
//
// Будят функцию база (pg_net сразу после публикации, pg_cron раз в 5 минут) заголовком
// x-notify-token. Пароль хранится в Vault (rassvet_notify_token), как и ключи VAPID —
// функции не нужны отдельные секреты в панели. verify_jwt = false (вызывает не человек).
//
// Письма родителям о листке — через Resend, если заданы секреты RESEND_API_KEY и
// EMAIL_FROM («Рассвет <rassvet@vifania.by>»). Без них пуши работают, письма пропускаются.
// APP_URL — адрес приложения для ссылок (по умолчанию демо).

import { adminClient, handle, json } from "../_shared/http.ts";
import { sendPush, type VapidKeys } from "../_shared/webpush.ts";
import { buildMessage, leafletEmail, type Item, type Kind } from "./messages.ts";

const APP_URL = (Deno.env.get("APP_URL") || "https://dkloban-ctrl.github.io/rassvet-demo/").replace(/\/?$/, "/");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_FROM = Deno.env.get("EMAIL_FROM");
const STALE_MS = 3 * 24 * 3600 * 1000; // не слать уведомления старше 3 суток (функция долго лежала)

type Job = { id: number; kind: Kind; ref_id: string; due_at: string; attempts: number; emails_sent: number | null };
type Recipient = { user_id: string; endpoint: string; p256dh: string; auth: string };

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(handle(async (req) => {
  const db = adminClient();
  const { data: cfg, error: cfgErr } = await db.rpc("notify_config");
  if (cfgErr) throw cfgErr;
  const token = req.headers.get("x-notify-token") ?? "";
  if (!cfg?.token || !safeEqual(token, cfg.token)) return json(req, 401, { error: "Нет доступа" });
  if (!cfg.vapid_public || !cfg.vapid_private || !cfg.vapid_subject) {
    return json(req, 503, { error: "Ключи VAPID не настроены" });
  }
  const keys: VapidKeys = { publicKey: cfg.vapid_public, privateJwk: JSON.parse(cfg.vapid_private), subject: cfg.vapid_subject };

  const { data: jobs, error: claimErr } = await db.rpc("notify_claim", { p_limit: 20 });
  if (claimErr) throw claimErr;

  const report: unknown[] = [];
  for (const job of (jobs ?? []) as Job[]) {
    try {
      report.push(await processJob(db, job, keys));
    } catch (e) {
      // Задание вернётся в очередь (до 5 попыток), остальные продолжаем.
      console.error("job failed", job.id, e);
      await db.rpc("notify_finish", { p_id: job.id, p_done: false, p_note: `ошибка: ${String((e as Error)?.message ?? e)}` });
      report.push({ id: job.id, error: true });
    }
  }
  return json(req, 200, { processed: report.length, report });
}));

async function loadItem(db: ReturnType<typeof adminClient>, kind: Kind, ref: string): Promise<Item | null> {
  const table = kind === "leaflet" ? "leaflets" : kind === "question" ? "questions" : kind === "announcement" ? "announcements" : null;
  if (!table) return {};
  const { data, error } = await db.from(table).select("*").eq("id", ref).maybeSingle();
  if (error) throw error;
  if (!data || !data.published_at || new Date(data.published_at) > new Date()) return null; // удалили / сняли
  return data as Item;
}

async function processJob(db: ReturnType<typeof adminClient>, job: Job, keys: VapidKeys) {
  const finish = (done: boolean, pushSent: number, pushFailed: number, emails: number, note?: string) =>
    db.rpc("notify_finish", { p_id: job.id, p_done: done, p_push_sent: pushSent, p_push_failed: pushFailed, p_emails_sent: emails, p_note: note ?? null });

  if (Date.now() - new Date(job.due_at).getTime() > STALE_MS) {
    await finish(true, 0, 0, 0, "устарело — не отправлено");
    return { id: job.id, skipped: "stale" };
  }
  const item = await loadItem(db, job.kind, job.ref_id);
  if (!item) {
    await finish(true, 0, 0, 0, "снято с публикации — не отправлено");
    return { id: job.id, skipped: "unpublished" };
  }

  const message = buildMessage(job.kind, item);
  const { data: recipients, error } = await db.rpc("notify_recipients", { p_kind: job.kind, p_ref: job.ref_id });
  if (error) throw error;

  let sent = 0, failed = 0;
  const gone: string[] = [];
  const results = await Promise.all((recipients as Recipient[]).map(async (r) => ({
    r,
    res: await sendPush(r, message, keys, {
      topic: message.tag,                          // не копить одинаковые на выключенном телефоне
      urgency: job.kind.startsWith("inbox") ? "high" : "normal",
      ttl: job.kind.startsWith("inbox") ? 7 * 24 * 3600 : 3 * 24 * 3600,
    }),
  })));
  const now = new Date().toISOString();
  for (const { r, res } of results) {
    if (res.ok) {
      sent++;
      await db.from("push_subscriptions").update({ last_ok_at: now, failures: 0 }).eq("endpoint", r.endpoint);
    } else {
      failed++;
      if (res.gone) gone.push(r.endpoint);
      else {
        console.warn("push failed", res.status, res.error);
        const { data: row } = await db.from("push_subscriptions").select("failures").eq("endpoint", r.endpoint).maybeSingle();
        const failures = (row?.failures ?? 0) + 1;
        // Пять неудач подряд — подписка мёртвая (сменили браузер, сбросили телефон).
        if (failures >= 5) gone.push(r.endpoint);
        else await db.from("push_subscriptions").update({ failures }).eq("endpoint", r.endpoint);
      }
    }
  }
  if (gone.length) await db.from("push_subscriptions").delete().in("endpoint", gone);

  let emails = 0;
  let note: string | undefined;
  // Письма — один раз, даже если пуш-часть задания повторяется после сбоя.
  if (job.kind === "leaflet" && job.emails_sent === null) {
    const out = await sendLeafletEmails(db, job.ref_id, item);
    emails = out.sent;
    note = out.note;
  }
  await finish(true, sent, failed, emails, note);
  return { id: job.id, kind: job.kind, sent, failed, removed: gone.length, emails };
}

async function sendLeafletEmails(db: ReturnType<typeof adminClient>, leafletId: string, item: Item) {
  if (!RESEND_API_KEY || !EMAIL_FROM) return { sent: 0, note: "письма выключены (нет RESEND_API_KEY / EMAIL_FROM)" };
  const { data: parents, error } = await db.rpc("notify_parent_emails", { p_leaflet: leafletId });
  if (error) throw error;
  let sent = 0;
  const errors: string[] = [];
  for (const p of (parents ?? []) as { email: string; display_name: string }[]) {
    const mail = leafletEmail(item, p.display_name, APP_URL);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [p.email], subject: mail.subject, text: mail.text, html: mail.html }),
    });
    if (res.ok) sent++;
    else errors.push(`${res.status}`);
    await res.body?.cancel().catch(() => {});
  }
  return { sent, note: errors.length ? `писем не ушло: ${errors.length} (${errors.slice(0, 3).join(", ")})` : undefined };
}
