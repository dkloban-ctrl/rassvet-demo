"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/app/providers";
import { Button, Card, Notice } from "@/components/ui";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";
import { humanError, supabase } from "@/lib/supabase";
import type { Role } from "@/lib/types";

type Prefs = { leaflet: boolean; question: boolean; announcement: boolean; inbox: boolean; email_leaflet: boolean };
const DEFAULTS: Prefs = { leaflet: true, question: true, announcement: true, inbox: true, email_leaflet: true };

// Что имеет смысл присылать каждой роли (совпадает с notify_recipients в базе).
const OPTIONS: Record<Role, { key: keyof Prefs; label: string }[]> = {
  teen: [
    { key: "leaflet", label: "Новый листок недели" },
    { key: "question", label: "Новый вопрос недели" },
    { key: "announcement", label: "Объявления" },
    { key: "inbox", label: "Лидеры ответили на моё сообщение" },
  ],
  helper: [
    { key: "leaflet", label: "Новый листок недели" },
    { key: "question", label: "Новый вопрос недели" },
    { key: "announcement", label: "Объявления" },
    { key: "inbox", label: "Лидеры ответили на моё сообщение" },
  ],
  parent: [
    { key: "leaflet", label: "Новый листок недели" },
    { key: "announcement", label: "Объявления" },
    { key: "inbox", label: "Лидеры ответили на моё сообщение" },
    { key: "email_leaflet", label: "Письмо на e-mail о новом листке" },
  ],
  admin: [{ key: "inbox", label: "Новые сообщения в ящике лидеров" }],
};

function usePushState() {
  const [state, setState] = useState<PushState | null>(null);
  const reload = useCallback(() => { pushState().then(setState).catch(() => setState("unsupported")); }, []);
  useEffect(reload, [reload]);
  return [state, setState, reload] as const;
}

/** Блок «Уведомления» на экране «Ещё». */
export function NotificationSettings() {
  const { profile } = useAuth();
  const [state, setState] = usePushState();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    supabase.from("notification_prefs").select("*").eq("user_id", profile.id).maybeSingle()
      .then(({ data }) => setPrefs({ ...DEFAULTS, ...(data ?? {}) }));
  }, [profile]);

  if (!profile) return null;
  const options = OPTIONS[profile.role];

  async function toggleDevice() {
    setBusy(true); setErr(null);
    try {
      if (state === "on") { await disablePush(); setState("off"); }
      else setState(await enablePush());
    } catch (e) { setErr(humanError(e)); }
    finally { setBusy(false); }
  }

  async function setPref(key: keyof Prefs, value: boolean) {
    if (!prefs || !profile) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    const { error } = await supabase.from("notification_prefs")
      .upsert({ user_id: profile.id, ...next, updated_at: new Date().toISOString() });
    if (error) { setErr(humanError(error)); setPrefs(prefs); }
  }

  return (
    <Card>
      <DeviceRow state={state} busy={busy} onToggle={toggleDevice} />
      {err && <Notice tone="warn">{err}</Notice>}
      {prefs && (
        <div className="mt-3 pt-3 border-t border-line space-y-2.5">
          <p className="text-xs text-muted">Что присылать (на все ваши устройства):</p>
          {options.map((o) => (
            <label key={o.key} className="flex items-center gap-3 text-[15px]">
              <input type="checkbox" className="h-5 w-5 accent-[#1c2340]" checked={prefs[o.key]}
                onChange={(e) => setPref(o.key, e.target.checked)} />
              {o.label}
            </label>
          ))}
          {profile.role !== "admin" && (
            <p className="text-xs text-muted pt-1">В уведомлении не бывает имён и текстов сообщений — только «есть новое». Экран блокировки могут видеть другие.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function DeviceRow({ state, busy, onToggle }: { state: PushState | null; busy: boolean; onToggle: () => void }) {
  if (state === null) return <p className="text-sm text-muted">Проверяем…</p>;
  if (state === "unsupported") {
    return <p className="text-sm text-muted">Этот браузер не умеет присылать уведомления. На Android откройте приложение в Chrome, на iPhone — установите на экран «Домой».</p>;
  }
  if (state === "ios-install") {
    return <p className="text-sm">На iPhone уведомления работают только в установленном приложении: <b>«Поделиться» → «На экран “Домой”»</b>, затем откройте «Рассвет» с экрана и включите здесь.</p>;
  }
  if (state === "denied") {
    return <p className="text-sm">Уведомления запрещены в настройках браузера для этого сайта. Разрешите их там (значок замка рядом с адресом или «Настройки» → «Уведомления»), затем вернитесь сюда.</p>;
  }
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <p className="font-semibold text-night">{state === "on" ? "Включены на этом устройстве" : "Выключены на этом устройстве"}</p>
        <p className="text-xs text-muted">{state === "on" ? "Новый листок и вопрос придут сразу." : "Включите, чтобы не пропустить листок и вопрос недели."}</p>
      </div>
      <Button size="sm" variant={state === "on" ? "secondary" : "primary"} loading={busy} onClick={onToggle}>
        {state === "on" ? "Выключить" : "Включить"}
      </Button>
    </div>
  );
}

/** Ненавязчивое приглашение на главном экране. Скрывается навсегда по «Не сейчас». */
export function PushPrompt() {
  const { profile } = useAuth();
  const [state, setState] = usePushState();
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { setHidden(localStorage.getItem("rassvet-push-prompt") === "no"); } catch { setHidden(false); }
  }, []);

  if (!profile || hidden || (state !== "off" && state !== "ios-install")) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem("rassvet-push-prompt", "no"); } catch { /* приватный режим */ } };

  return (
    <Card className="mt-3 border-gold/40 bg-dawn">
      <p className="font-semibold text-night">🔔 Не пропускать новое</p>
      {state === "ios-install" ? (
        <p className="text-sm mt-1">Установите «Рассвет» на экран «Домой» — тогда придут уведомления о листке и вопросе недели. <Link href="/more/" className="underline">Как установить</Link></p>
      ) : (
        <p className="text-sm mt-1">Пришлём уведомление, когда выйдет листок или вопрос недели. Без имён и текстов сообщений.</p>
      )}
      <div className="flex gap-2 mt-3">
        {state === "off" && (
          <Button size="sm" loading={busy} onClick={async () => {
            setBusy(true);
            try { setState(await enablePush()); } catch { setState("off"); } finally { setBusy(false); }
          }}>Включить</Button>
        )}
        <Button size="sm" variant="ghost" onClick={dismiss}>Не сейчас</Button>
      </div>
    </Card>
  );
}
