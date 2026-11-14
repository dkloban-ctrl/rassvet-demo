// Сброс пароля подростка (или помощника) — только админ или родитель этого ребёнка.
//
// POST { teenId }   Authorization: Bearer <токен вызывающего>
// 200 { login, password }   временный пароль показывается ОДИН раз — передать ребёнку лично.
//
// Почему пароль генерирует сервер, а не вводит родитель: иначе будут «12345678».

import { adminClient, callerId, handle, json } from "../_shared/http.ts";
import { emailToLogin, generatePassword, isUuid } from "../_shared/validate.ts";

Deno.serve(handle(async (req, body) => {
  const actor = await callerId(req);
  if (!actor) return json(req, 401, { error: "Нужно войти" });
  if (!isUuid(body.teenId)) return json(req, 400, { error: "Неверный запрос" });
  const teenId = body.teenId;

  const admin = adminClient();
  const { data: allowed, error: checkErr } = await admin.rpc("can_reset_password", {
    p_actor: actor,
    p_target: teenId,
  });
  if (checkErr) throw checkErr;
  if (allowed !== true) return json(req, 403, { error: "Нет прав на сброс пароля этому пользователю" });

  const password = generatePassword();
  const { data: updated, error: updErr } = await admin.auth.admin.updateUserById(teenId, { password });
  if (updErr) throw updErr;

  const { error: auditErr } = await admin.from("audit_log").insert({
    actor_id: actor,
    action: "password_reset",
    table_name: "auth.users",
    row_id: teenId,
  });
  if (auditErr) console.error("audit_log insert failed", auditErr);

  return json(req, 200, { login: emailToLogin(updated.user?.email), password });
}));
