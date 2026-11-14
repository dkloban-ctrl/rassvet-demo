"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/app/providers";
import { Logo } from "@/components/AppShell";
import { Button, ErrorBox, Field, Input } from "@/components/ui";
import { humanError, loginToEmail, supabase } from "@/lib/supabase";
import { CHURCH, VERSE } from "@/lib/verse";

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  useEffect(() => {
    if (!loading && session) router.replace("/");
  }, [loading, session, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const raw = id.trim();
    if (!raw || !password) return setError("Введите логин и пароль");
    setBusy(true);
    const email = raw.includes("@") ? raw.toLowerCase() : loginToEmail(raw);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(humanError(error));
    router.replace("/");
  }

  return (
    <div className="min-h-dvh bg-sunrise text-white flex flex-col safe-top">
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6 text-center">
        <Logo size={64} />
        <h1 className="mt-4 text-5xl font-bold tracking-wide">Рассвет</h1>
        <p className="mt-5 max-w-xs font-serif italic text-[17px] leading-snug text-white/95">«{VERSE.text}»</p>
        <p className="mt-2 text-sm text-white/80">{VERSE.ref}</p>
        <p className="mt-6 text-xs uppercase tracking-[0.2em] text-white/70">{CHURCH}</p>
      </div>

      <div className="bg-cream text-ink rounded-t-3xl px-6 pt-6 pb-8 safe-bottom">
        <form onSubmit={submit} className="mx-auto max-w-sm">
          <Field label="Логин или e-mail">
            <Input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" autoCapitalize="none"
                   autoCorrect="off" spellCheck={false} placeholder="masha или mama@mail.by" />
          </Field>
          <Field label="Пароль">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <ErrorBox>{error}</ErrorBox>
          <Button type="submit" className="w-full mt-1" loading={busy}>Войти</Button>
          <button type="button" onClick={() => setForgot((v) => !v)} className="block mx-auto mt-4 text-sm text-dusk underline-offset-2 hover:underline">
            Забыли пароль?
          </button>
          {forgot && (
            <p className="text-sm text-muted mt-2 text-center">
              Подросткам пароль сбрасывает родитель в своём аккаунте или лидер. Взрослым — обратитесь к лидеру.
            </p>
          )}
          <p className="text-xs text-muted mt-6 text-center">
            Аккаунт создаётся только по приглашению лидера. Открытой регистрации нет.
          </p>
        </form>
      </div>
    </div>
  );
}
