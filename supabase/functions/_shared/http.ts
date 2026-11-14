import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// Разрешённые адреса приложения через запятую, например:
// ALLOWED_ORIGINS=https://rassvet.vifania.by,https://rassvet-vifania.vercel.app,http://localhost:3000
// Если секрет не задан — адреса демо и локальной разработки.
const DEFAULT_ORIGINS = "https://dkloban-ctrl.github.io,http://localhost:3000";
const allowed = (Deno.env.get("ALLOWED_ORIGINS") || DEFAULT_ORIGINS).split(",").map((s) => s.trim()).filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : (allowed[0] ?? ""),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Общая обвязка: CORS-предзапрос, только POST, разбор JSON, перехват ошибок. */
export function handle(fn: (req: Request, body: Record<string, unknown>) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    if (req.method !== "POST") return json(req, 405, { error: "Только POST" });
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch {
      return json(req, 400, { error: "Неверный запрос" });
    }
    try {
      return await fn(req, body);
    } catch (e) {
      // Подробности — только в логи сервера, наружу — общий текст.
      console.error(e);
      return json(req, 500, { error: "Ошибка сервера. Попробуйте позже." });
    }
  };
}

/** Клиент с сервисным ключом: обходит RLS. Живёт только на сервере. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Кто вызывает функцию — по его токену (проверяется сервером Auth, не на доверии). */
export async function callerId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const { data, error } = await adminClient().auth.getUser(authHeader.slice(7));
  return error || !data.user ? null : data.user.id;
}
