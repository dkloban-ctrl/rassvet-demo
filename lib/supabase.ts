import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;

// Публичный ключ виден в браузере по замыслу Supabase: доступ к данным решают политики RLS.
export const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "rassvet-auth" },
});

export const TEEN_EMAIL_DOMAIN = "rassvet.internal";
export const loginToEmail = (login: string) => `${login.trim().toLowerCase()}@${TEEN_EMAIL_DOMAIN}`;
export const emailToLogin = (email?: string | null) =>
  email && email.endsWith(`@${TEEN_EMAIL_DOMAIN}`) ? email.slice(0, -TEEN_EMAIL_DOMAIN.length - 1) : null;

/** Вызов серверной функции с понятной ошибкой на русском. */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: KEY,
      ...(s.session ? { Authorization: `Bearer ${s.session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new FieldError(json.error ?? "Ошибка сервера", json.field);
  return json as T;
}

export class FieldError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}

/** Человеческий текст для ошибок базы. */
export function humanError(e: unknown): string {
  if (e instanceof FieldError) return e.message;
  const err = e as { message?: string; code?: string };
  const m = err?.message ?? String(e);
  if (/Invalid login credentials/i.test(m)) return "Неверный логин или пароль";
  if (/row-level security|permission denied|42501/i.test(m) || err?.code === "42501") return "Нет прав на это действие";
  if (/duplicate key/i.test(m)) return "Такая запись уже есть";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Нет связи с сервером. Проверьте интернет.";
  return m;
}
