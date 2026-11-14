import { ok as assert, strictEqual as assertEquals } from "node:assert/strict";
const assertFalse = (v: unknown, msg?: string) => assert(!v, msg);
import {
  emailToLogin,
  generatePassword,
  isUuid,
  loginToEmail,
  normalizeEmail,
  validateDisplayName,
  validateInviteCode,
  validateLogin,
  validatePassword,
} from "./validate.ts";

Deno.test("логин: нормализуется и проверяется", () => {
  const r = validateLogin("  Masha.K ");
  assert(r.ok && r.value === "masha.k");
  for (const bad of ["ma", "1masha", "маша", "masha..k", "masha_", "a".repeat(25), "masha k", "m@sha", 42]) {
    assertFalse(validateLogin(bad).ok, `должен быть отклонён: ${bad}`);
  }
});

Deno.test("логин ⇄ технический адрес", () => {
  assertEquals(loginToEmail("masha"), "masha@rassvet.internal");
  assertEquals(emailToLogin("masha@rassvet.internal"), "masha");
  assertEquals(emailToLogin("mama@example.com"), null);
});

Deno.test("e-mail: нижний регистр, технический домен запрещён", () => {
  const r = normalizeEmail(" Mama@Example.COM ");
  assert(r.ok && r.value === "mama@example.com");
  assertFalse(normalizeEmail("masha@rassvet.internal").ok);
  assertFalse(normalizeEmail("not-an-email").ok);
});

Deno.test("пароль", () => {
  assert(validatePassword("solnce-2026").ok);
  assertFalse(validatePassword("short1").ok);
  assertFalse(validatePassword("12345678").ok);
  assertFalse(validatePassword("masha2026!", "masha").ok);
  assertFalse(validatePassword("x".repeat(73)).ok);
});

Deno.test("имя: пробелы схлопываются, длина 1–40", () => {
  const r = validateDisplayName("  Маша   К. ");
  assert(r.ok && r.value === "Маша К.");
  assertFalse(validateDisplayName("   ").ok);
  assertFalse(validateDisplayName("я".repeat(41)).ok);
  assertFalse(validateDisplayName("Маша\u0000").ok);
});

Deno.test("код приглашения", () => {
  assert(validateInviteCode("3f2a9c0d1e4b5a6978c0d1e2f3a4b5c6").ok);
  assertFalse(validateInviteCode("short").ok);
  assertFalse(validateInviteCode("abc'; drop table x;--abcdefgh").ok);
});

Deno.test("временный пароль: формат, алфавит, уникальность, проходит проверку", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const p = generatePassword();
    assert(/^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/.test(p), p);
    assert(validatePassword(p).ok);
    seen.add(p);
  }
  assertEquals(seen.size, 2000);
});

Deno.test("uuid", () => {
  assert(isUuid("00000000-0000-0000-0000-000000000011"));
  assertFalse(isUuid("11; select 1"));
});
