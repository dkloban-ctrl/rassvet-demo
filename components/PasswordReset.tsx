"use client";

import { useState } from "react";
import { callFunction, humanError } from "@/lib/supabase";
import { Button, Confirm, ErrorBox } from "./ui";

/** Сброс пароля подростку: сервер генерирует пароль и показывает его один раз. */
export function PasswordReset({ teenId, name }: { teenId: string; name: string }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ login: string | null; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      setResult(await callFunction("reset-teen-password", { teenId }));
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
      setAsk(false);
    }
  }

  return (
    <div>
      {!result && <Button size="sm" variant="secondary" onClick={() => setAsk(true)}>Сбросить пароль</Button>}
      <ErrorBox>{error}</ErrorBox>
      {result && (
        <div className="rounded-xl bg-dawn border border-[#f5dfb8] p-3 mt-2">
          <p className="text-sm font-semibold text-night">Новый пароль · {name}</p>
          {result.login && <p className="text-sm mt-1">Логин: <b className="font-mono">{result.login}</b></p>}
          <p className="text-sm">Пароль: <b className="font-mono text-lg tracking-wide">{result.password}</b></p>
          <p className="text-xs text-muted mt-1">Передайте лично. После закрытия пароль больше не покажется.</p>
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => setResult(null)}>Готово</Button>
        </div>
      )}
      <Confirm open={ask} title={`Сбросить пароль? (${name})`} text="Старый пароль перестанет работать. Новый пароль покажется один раз." confirmText="Сбросить"
        loading={busy} onConfirm={reset} onCancel={() => setAsk(false)} />
    </div>
  );
}
