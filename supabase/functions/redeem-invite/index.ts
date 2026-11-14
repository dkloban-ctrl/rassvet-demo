// Регистрация по приглашению. Публичная функция (без входа): verify_jwt = false в config.toml.
//
// POST { code, displayName, password, login? (подросток), email? (взрослый, помощник) }
// 201 { role, status }    status = "pending" для несовершеннолетних (ждут согласия), иначе "active"
//
// Порядок: проверить приглашение → создать пользователя в Auth → под блокировкой
// завершить в базе (профиль, связь с родителем, «использовано»). Если база отказала —
// пользователь в Auth удаляется, чтобы не осталось «висячих» аккаунтов.

import { adminClient, handle, json } from "../_shared/http.ts";
import {
  loginToEmail,
  normalizeEmail,
  validateDisplayName,
  validateInviteCode,
  validateLogin,
  validatePassword,
} from "../_shared/validate.ts";

type Invite = { id: string; role: "admin" | "helper" | "parent" | "teen"; email: string | null; parent_id: string | null };

const INVALID = "Приглашение недействительно или уже использовано";

// Не больше 20 обращений за 15 минут с одного адреса (включая предпросмотр): перебор
// кодов бессмыслен (128 бит), но так функцию нельзя завалить запросами.
async function tooMany(req: Request): Promise<boolean> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const { data, error } = await adminClient().rpc("rate_limit_hit", { p_key: `redeem:${ip}`, p_max: 20, p_window: "15 minutes" });
  if (error) { console.error("rate limit", error); return false; } // сбой счётчика не должен ломать регистрацию
  return data === false;
}

Deno.serve(handle(async (req, body) => {
  if (await tooMany(req)) return json(req, 429, { error: "Слишком много попыток. Подождите 15 минут." });
  const code = validateInviteCode(body.code);
  if (!code.ok) return json(req, 400, { error: INVALID });

  // Предпросмотр: экран регистрации узнаёт роль (спросить логин или e-mail), ничего не создавая.
  if (body.peek === true) {
    const { data, error } = await adminClient().rpc("invite_lookup", { p_code: code.value });
    if (error) throw error;
    const inv = (data as Invite[] | null)?.[0];
    return inv ? json(req, 200, { role: inv.role }) : json(req, 400, { error: INVALID });
  }

  const name = validateDisplayName(body.displayName);
  if (!name.ok) return json(req, 400, { error: name.error, field: "displayName" });

  const admin = adminClient();
  const { data: found, error: lookupErr } = await admin.rpc("invite_lookup", { p_code: code.value });
  if (lookupErr) throw lookupErr;
  const invite = (found as Invite[] | null)?.[0];
  if (!invite) return json(req, 400, { error: INVALID });

  // Адрес для Auth: у подростка — технический по логину, у остальных — тот, на который выдано приглашение.
  let email: string;
  let login: string | undefined;
  if (invite.role === "teen") {
    const l = validateLogin(body.login);
    if (!l.ok) return json(req, 400, { error: l.error, field: "login" });
    login = l.value;
    email = loginToEmail(login);
  } else {
    const e = normalizeEmail(body.email);
    if (!e.ok) return json(req, 400, { error: e.error, field: "email" });
    if (e.value !== invite.email) {
      return json(req, 400, { error: "Это приглашение выдано на другой e-mail", field: "email" });
    }
    email = e.value;
  }

  const pw = validatePassword(body.password, login);
  if (!pw.ok) return json(req, 400, { error: pw.error, field: "password" });

  // Ключ регистрации: база пропускает в auth.users только пользователей с ним (открытая
  // регистрация закрыта даже при включённом флажке в панели). Триггер ключ вырезает.
  const { data: signupKey, error: keyErr } = await admin.rpc("signup_key");
  if (keyErr) throw keyErr;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: pw.value,
    user_metadata: signupKey ? { rassvet_signup_key: signupKey } : {},
    // Подтверждать почту не нужно: у подростка адрес технический, у взрослого его вписал админ в приглашение.
    email_confirm: true,
  });
  if (createErr || !created.user) {
    // Различаем по коду ошибки Auth, а не по статусу: 422 бывает и у слабого пароля.
    const authCode = (createErr as { code?: string } | null)?.code;
    if (authCode === "weak_password") {
      return json(req, 400, { error: "Пароль слишком простой", field: "password" });
    }
    if (authCode === "email_exists" || authCode === "user_already_exists") {
      return invite.role === "teen"
        ? json(req, 409, { error: "Такой логин уже занят", field: "login" })
        : json(req, 409, { error: "С этим e-mail уже есть аккаунт. Войдите или обратитесь к лидеру.", field: "email" });
    }
    throw createErr;
  }

  const { data: role, error: finishErr } = await admin.rpc("invite_complete", {
    p_code: code.value,
    p_user: created.user.id,
    p_display_name: name.value,
  });
  if (finishErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    if (finishErr.code === "P0002") return json(req, 409, { error: INVALID });
    throw finishErr;
  }

  const minor = role === "teen" || role === "helper";
  return json(req, 201, { role, status: minor ? "pending" : "active" });
}));
