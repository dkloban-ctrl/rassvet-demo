// Проверки ввода. Чистые функции без сети — покрыты unit-тестами (validate.test.ts).

export const TEEN_EMAIL_DOMAIN = "rassvet.internal";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

/** Логин подростка: латиница, цифры, точка, подчёркивание; 3–24 символа; начинается с буквы. */
export function validateLogin(raw: unknown): Result<string> {
  if (typeof raw !== "string") return fail("Укажи логин");
  const login = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._]{2,23}$/.test(login)) {
    return fail("Логин: 3–24 символа, латинские буквы, цифры, точка или _, начинается с буквы");
  }
  if (/[._]{2}/.test(login) || /[._]$/.test(login)) {
    return fail("В логине не может быть двух знаков подряд и знака в конце");
  }
  return ok(login);
}

/** Технический адрес подростка в Supabase Auth. Тот же код нужен экрану входа. */
export function loginToEmail(login: string): string {
  return `${login}@${TEEN_EMAIL_DOMAIN}`;
}

export function emailToLogin(email: string | undefined | null): string | null {
  if (!email) return null;
  const suffix = `@${TEEN_EMAIL_DOMAIN}`;
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : null;
}

export function normalizeEmail(raw: unknown): Result<string> {
  if (typeof raw !== "string") return fail("Укажите e-mail");
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Неверный e-mail");
  if (email.endsWith(`@${TEEN_EMAIL_DOMAIN}`)) return fail("Неверный e-mail");
  return ok(email);
}

/** Минимум 8 символов, не только цифры, не совпадает с логином. */
export function validatePassword(raw: unknown, login?: string): Result<string> {
  if (typeof raw !== "string") return fail("Укажи пароль");
  if (raw.length < 8) return fail("Пароль — минимум 8 символов");
  if (raw.length > 72) return fail("Пароль — не длиннее 72 символов");
  if (/^\d+$/.test(raw)) return fail("Пароль не может состоять только из цифр");
  if (login && raw.toLowerCase().includes(login)) return fail("Пароль не должен содержать логин");
  return ok(raw);
}

/** Имя без фамилии: 1–40 символов, без управляющих символов. */
export function validateDisplayName(raw: unknown): Result<string> {
  if (typeof raw !== "string") return fail("Укажи имя");
  const name = raw.replace(/\s+/g, " ").trim();
  // deno-lint-ignore no-control-regex
  if (name.length < 1 || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
    return fail("Имя: от 1 до 40 символов");
  }
  return ok(name);
}

/** Код приглашения: по умолчанию 32 hex-символа (gen_random_uuid без дефисов). */
export function validateInviteCode(raw: unknown): Result<string> {
  if (typeof raw !== "string") return fail("Нет кода приглашения");
  const code = raw.trim();
  if (!/^[A-Za-z0-9]{16,64}$/.test(code)) return fail("Приглашение недействительно");
  return ok(code);
}

/** Временный пароль для сброса: 3 группы по 4 символа без похожих (0/o, 1/l/i). ~59 бит. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function generatePassword(groups = 3, size = 4): string {
  const out: string[] = [];
  const limit = 256 - (256 % ALPHABET.length); // без перекоса распределения
  while (out.length < groups * size) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && out.length < groups * size) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  const parts: string[] = [];
  for (let i = 0; i < groups; i++) parts.push(out.slice(i * size, (i + 1) * size).join(""));
  return parts.join("-");
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
