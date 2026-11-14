// Печатает SQL для Vault: ключи VAPID, пароль пробуждения рассылки, ключ регистрации.
// Выполнить ОДИН раз в SQL Editor проекта Supabase. Ничего не сохраняет на диск.
//
//   node --experimental-strip-types scripts/setup-secrets.ts <project-ref> <subject>
//   например: ... degxuvmvtwzirnfbnwrc https://dkloban-ctrl.github.io/rassvet-demo/
//
// subject — контакт для push-сервисов: mailto:адрес или https-адрес сайта.
// Повторный запуск с новыми ключами VAPID отключит все подписки (их придётся включить заново).
import { randomBytes } from "node:crypto";
import { generateVapidKeys } from "../supabase/functions/_shared/webpush.ts";

const [ref, subject] = process.argv.slice(2);
if (!ref || !subject || !/^(mailto:|https:\/\/)/.test(subject)) {
  console.error("Использование: setup-secrets.ts <project-ref> <mailto:… | https://…>");
  process.exit(1);
}
const keys = await generateVapidKeys(subject);
const token = randomBytes(32).toString("base64url");
const signupKey = randomBytes(32).toString("base64url");
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const secrets: [string, string][] = [
  ["rassvet_vapid_public", keys.publicKey],
  ["rassvet_vapid_private", JSON.stringify(keys.privateJwk)],
  ["rassvet_vapid_subject", subject],
  ["rassvet_notify_token", token],
  ["rassvet_notify_url", `https://${ref}.supabase.co/functions/v1/send-notifications`],
  ["rassvet_signup_key", signupKey],
];
console.log("-- Секреты «Рассвета». Не сохранять в репозиторий.");
console.log("delete from vault.secrets where name like 'rassvet\\_%';");
for (const [name, value] of secrets) console.log(`select vault.create_secret(${q(value)}, ${q(name)});`);
