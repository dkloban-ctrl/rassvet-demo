"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Logo } from "@/components/AppShell";
import { Button, Card, ErrorBox, Field, Input, Loading } from "@/components/ui";
import { FieldError, callFunction, humanError, loginToEmail, supabase } from "@/lib/supabase";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { VERSE } from "@/lib/verse";

export default function JoinPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Join />
    </Suspense>
  );
}

function Join() {
  const params = useSearchParams();
  const router = useRouter();
  const code = params.get("code") ?? "";
  const [role, setRole] = useState<Role | null>(null);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!code) {
      setInvalid("В ссылке нет кода приглашения.");
      setChecking(false);
      return;
    }
    callFunction<{ role: Role }>("redeem-invite", { code, peek: true })
      .then((r) => setRole(r.role))
      .catch((e) => setInvalid(humanError(e)))
      .finally(() => setChecking(false));
  }, [code]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErr({});
    if (password !== password2) return setFieldErr({ password2: "Пароли не совпадают" });
    setBusy(true);
    try {
      const teen = role === "teen";
      await callFunction("redeem-invite", {
        code,
        displayName: name,
        password,
        ...(teen ? { login } : { email }),
      });
      const { error } = await supabase.auth.signInWithPassword({
        email: teen ? loginToEmail(login) : email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
      router.replace("/");
    } catch (e) {
      if (e instanceof FieldError && e.field) setFieldErr({ [e.field]: e.message });
      else setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-sunrise-soft safe-top">
      <div className="mx-auto max-w-sm px-5 py-8">
        <div className="text-center mb-6">
          <div className="mx-auto w-fit"><Logo size={52} /></div>
          <h1 className="text-3xl font-bold text-night mt-2">Рассвет</h1>
          <p className="text-sm text-muted mt-1 font-serif italic">{VERSE.ref}</p>
        </div>

        {checking && <Loading />}

        {!checking && invalid && (
          <Card>
            <h2 className="font-bold text-night">Приглашение не работает</h2>
            <p className="text-sm text-muted mt-1">{invalid} Попросите у лидера новую ссылку.</p>
          </Card>
        )}

        {!checking && role && (
          <Card>
            <h2 className="text-lg font-bold text-night">Создание аккаунта</h2>
            <p className="text-sm text-muted mb-4">Вас пригласили как: <b>{ROLE_LABEL[role]}</b></p>
            <form onSubmit={submit}>
              <Field label="Имя" hint="Только имя, без фамилии. Его увидят ребята и лидеры." error={fieldErr.displayName}>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
              </Field>
              {role === "teen" ? (
                <Field label="Придумай логин" hint="Латинские буквы и цифры, например masha.k" error={fieldErr.login}>
                  <Input value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" autoCorrect="off"
                         spellCheck={false} autoComplete="username" required />
                </Field>
              ) : (
                <Field label="E-mail" hint="Тот, на который лидер выдал приглашение" error={fieldErr.email}>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
                </Field>
              )}
              <Field label="Пароль" hint="Минимум 8 символов, не только цифры" error={fieldErr.password}>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
              </Field>
              <Field label="Пароль ещё раз" error={fieldErr.password2}>
                <Input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
              </Field>
              <ErrorBox>{error}</ErrorBox>
              <Button type="submit" className="w-full" loading={busy}>Создать аккаунт</Button>
              {(role === "teen" || role === "helper") && (
                <p className="text-xs text-muted mt-3">
                  Аккаунт заработает после того, как родитель подпишет согласие в своём аккаунте.
                </p>
              )}
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
