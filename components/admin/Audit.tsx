"use client";

import { Card, Empty, ErrorBox, Loading } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { STATUS_LABEL, ROLE_LABEL, type Status, type Role } from "@/lib/types";
import { must, useLoad } from "@/lib/useLoad";

type Row = { id: number; at: string; actor_id: string | null; action: string; table_name: string | null; row_id: string | null;
  old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null };

const TABLE: Record<string, string> = {
  profiles: "профиль", family_links: "связь «родитель — ребёнок»", consents: "согласие", invites: "приглашение",
  parent_inbox_access: "доступ родителя к обращениям", answers: "ответ на вопрос", leaflets: "листок", questions: "вопрос",
};

function describe(r: Row, name: (id?: unknown) => string): string {
  const o = r.old_data ?? {}, n = r.new_data ?? {};
  if (r.action === "parent_read_inbox") return `прочитал(а) обращения ребёнка: ${name(r.row_id)}`;
  if (r.action === "password_reset") return `сбросил(а) пароль: ${name(r.row_id)}`;
  const t = r.table_name ?? "";
  if (t === "profiles" && r.action === "update") {
    const parts: string[] = [];
    if (o.status !== n.status) parts.push(`статус ${STATUS_LABEL[o.status as Status]} → ${STATUS_LABEL[n.status as Status]}`);
    if (o.role !== n.role) parts.push(`роль ${ROLE_LABEL[o.role as Role]} → ${ROLE_LABEL[n.role as Role]}`);
    if (o.display_name !== n.display_name) parts.push(`имя «${o.display_name}» → «${n.display_name}»`);
    if (o.is_minor !== n.is_minor) parts.push(n.is_minor ? "отмечен(а) как несовершеннолетний" : "отмечен(а) как совершеннолетний");
    return `${name(n.id)}: ${parts.join(", ") || "изменение профиля"}`;
  }
  if (t === "parent_inbox_access") {
    if (r.action === "insert") return `открыл(а) ${name(n.parent_id)} чтение обращений ${name(n.teen_id)}`;
    if (r.action === "update" && n.revoked_at) return `закрыл(а) ${name(n.parent_id)} чтение обращений ${name(n.teen_id)}`;
  }
  if (t === "consents") {
    if (r.action === "insert") return `${name(n.parent_id)} подписал(а) согласие за ${name(n.teen_id)}`;
    if (r.action === "update" && n.revoked_at) return `согласие за ${name(n.teen_id)} отозвано`;
  }
  if (t === "family_links" && r.action === "insert") return `${name(n.parent_id)} привязан(а) к ${name(n.teen_id)}`;
  if (t === "invites") {
    if (r.action === "insert") return `создано приглашение (${ROLE_LABEL[n.role as Role]})`;
    if (r.action === "update" && n.used_at && !o.used_at) return `по приглашению зарегистрирован(а) ${name(n.used_by)}`;
    if (r.action === "update" && n.approved_by && !o.approved_by) return "приглашение одобрено";
  }
  if (t === "answers" && r.action === "update" && n.hidden_at !== o.hidden_at) return n.hidden_at ? "скрыт ответ на вопрос" : "ответ снова показан";
  const verb = r.action === "insert" ? "создано" : r.action === "delete" ? "удалено" : "изменено";
  return `${TABLE[t] ?? t}: ${verb}`;
}

export function Audit() {
  const { data, error, loading } = useLoad(async () => {
    const [a, p] = await Promise.all([
      supabase.from("audit_log").select("*").order("at", { ascending: false }).limit(150),
      supabase.from("profiles").select("id, display_name"),
    ]);
    return { rows: must(a) as Row[], people: must(p) as { id: string; display_name: string }[] };
  }, []);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;
  const name = (id?: unknown) => data.people.find((p) => p.id === id)?.display_name ?? (id ? "удалённый аккаунт" : "система");
  return (
    <div>
      <p className="text-sm text-muted px-1 mb-3">Смены ролей и статусов, согласия, приглашения, доступы родителей, сбросы паролей, скрытые и удалённые записи. Журнал виден только лидерам и не редактируется.</p>
      {data.rows.length === 0 ? <Empty>Журнал пуст.</Empty> : (
        <Card className="p-0 divide-y divide-line">
          {data.rows.map((r) => (
            <div key={r.id} className="px-4 py-2.5">
              <p className="text-sm text-night">{describe(r, name)}</p>
              <p className="text-xs text-muted">{fmtDateTime(r.at)} · {name(r.actor_id)}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
