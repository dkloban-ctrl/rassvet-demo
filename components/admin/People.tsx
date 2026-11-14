"use client";

import { useState } from "react";
import { useAuth } from "@/app/providers";
import { PasswordReset } from "@/components/PasswordReset";
import { Badge, Button, Card, ErrorBox, Loading, Notice, SectionTitle, Select, cx } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { humanError, supabase } from "@/lib/supabase";
import { ROLE_LABEL, STATUS_LABEL, type Consent, type InboxAccess, type Profile, type Role } from "@/lib/types";
import { must, useLoad } from "@/lib/useLoad";

type Link = { parent_id: string; teen_id: string };

export function People() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [p, l, c, a, d] = await Promise.all([
      supabase.from("profiles").select("*").order("display_name"),
      supabase.from("family_links").select("parent_id, teen_id"),
      supabase.from("consents").select("*").is("revoked_at", null),
      supabase.from("parent_inbox_access").select("*").is("revoked_at", null),
      supabase.from("consent_documents").select("version").eq("is_current", true),
    ]);
    const current = (must(d) as { version: string }[])[0]?.version;
    return {
      people: must(p) as Profile[],
      links: must(l) as Link[],
      consents: (must(c) as Consent[]).filter((x) => x.version === current),
      access: must(a) as InboxAccess[],
    };
  }, []);
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;

  const groups: { role: Role; title: string }[] = [
    { role: "teen", title: "Подростки" },
    { role: "helper", title: "Помощники" },
    { role: "parent", title: "Родители" },
    { role: "admin", title: "Лидеры" },
  ];
  const pendingCount = data.people.filter((p) => p.status === "pending").length;

  return (
    <div>
      {pendingCount > 0 && <Notice>Ждут активации: {pendingCount}. Подростка можно активировать только после согласия родителя.</Notice>}
      {groups.map((g) => {
        const list = data.people.filter((p) => p.role === g.role);
        if (!list.length) return null;
        return (
          <div key={g.role}>
            <SectionTitle>{g.title} · {list.length}</SectionTitle>
            <Card className="p-0 divide-y divide-line">
              {list.map((p) => (
                <PersonRow key={p.id} p={p} data={data} open={openId === p.id}
                  onToggle={() => setOpenId(openId === p.id ? null : p.id)} onChange={reload} />
              ))}
            </Card>
          </div>
        );
      })}
    </div>
  );
}

function PersonRow({ p, data, open, onToggle, onChange }: {
  p: Profile;
  data: { people: Profile[]; links: Link[]; consents: Consent[]; access: InboxAccess[] };
  open: boolean; onToggle: () => void; onChange: () => void;
}) {
  const { profile: me } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newParent, setNewParent] = useState("");

  const name = (id: string) => data.people.find((x) => x.id === id)?.display_name ?? "—";
  const parents = data.links.filter((l) => l.teen_id === p.id).map((l) => l.parent_id);
  const kids = data.links.filter((l) => l.parent_id === p.id).map((l) => l.teen_id);
  const consent = data.consents.find((c) => c.teen_id === p.id);

  async function run(key: string, fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(key);
    setError(null);
    const { error } = await fn();
    setBusy(null);
    if (error) return setError(humanError(error));
    onChange();
  }
  const setStatus = (status: string) => run(status, () => supabase.rpc("admin_update_profile", { p_user: p.id, p_status: status }));

  return (
    <div>
      <button onClick={onToggle} className="w-full text-left px-4 py-3 flex items-center gap-2 hover:bg-cream">
        <span className="font-medium text-night">{p.display_name}</span>
        {p.is_minor && p.role !== "teen" && <Badge>до 18</Badge>}
        <span className="ml-auto">
          <Badge tone={p.status === "active" ? "green" : p.status === "pending" ? "gold" : "red"}>{STATUS_LABEL[p.status]}</Badge>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 text-sm">
          <p className="text-muted">Роль: {ROLE_LABEL[p.role]} · с {fmtDate(p.created_at)}</p>

          {p.is_minor && (
            <div>
              <p><b>Родители:</b> {parents.length ? parents.map(name).join(", ") : "не привязаны"}</p>
              <p className={cx(!consent && "text-orange-800")}>
                <b>Согласие:</b> {consent ? `подписано ${fmtDate(consent.signed_at)} (${name(consent.parent_id)})` : "нет"}
              </p>
            </div>
          )}
          {p.role === "parent" && <p><b>Дети:</b> {kids.length ? kids.map(name).join(", ") : "—"}</p>}

          <div className="flex flex-wrap gap-2">
            {p.status !== "active" && (
              <Button size="sm" onClick={() => setStatus("active")} loading={busy === "active"} disabled={p.is_minor && !consent}>
                {p.status === "blocked" ? "Вернуть доступ" : "Активировать"}
              </Button>
            )}
            {p.status === "active" && p.id !== me?.id && (
              <Button size="sm" variant="danger" onClick={() => setStatus("blocked")} loading={busy === "blocked"}>Приостановить</Button>
            )}
          </div>
          {p.is_minor && !consent && p.status !== "active" && (
            <p className="text-xs text-muted">Активировать можно после того, как родитель подпишет согласие в своём аккаунте.</p>
          )}

          {p.is_minor && (
            <>
              <div className="border-t border-line pt-3">
                <p className="font-semibold text-night mb-1">Доступ родителей к обращениям</p>
                {parents.length === 0 && <p className="text-muted">Сначала привяжите родителя.</p>}
                {parents.map((pid) => {
                  const acc = data.access.find((a) => a.parent_id === pid && a.teen_id === p.id);
                  return (
                    <div key={pid} className="flex items-center gap-2 py-1">
                      <span>{name(pid)}:</span>
                      {acc ? (
                        <>
                          <Badge tone="dusk">открыт с {fmtDate(acc.granted_at)}</Badge>
                          <Button size="sm" variant="ghost" loading={busy === `r${pid}`}
                            onClick={() => run(`r${pid}`, () => supabase.rpc("revoke_parent_inbox_access", { p_access: acc.id }))}>
                            Закрыть
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="secondary" loading={busy === `g${pid}`}
                          onClick={() => run(`g${pid}`, () => supabase.rpc("grant_parent_inbox_access", { p_parent: pid, p_teen: p.id }))}>
                          Открыть чтение
                        </Button>
                      )}
                    </div>
                  );
                })}
                <p className="text-xs text-muted mt-1">Родитель увидит только сообщения после открытия. {p.display_name} видит, кто читает.</p>
              </div>

              <div className="border-t border-line pt-3 flex gap-2 items-end">
                <div className="flex-1">
                  <p className="font-semibold text-night mb-1">Привязать родителя</p>
                  <Select value={newParent} onChange={(e) => setNewParent(e.target.value)}>
                    <option value="">Выберите…</option>
                    {data.people.filter((x) => x.role === "parent" && !parents.includes(x.id)).map((x) => (
                      <option key={x.id} value={x.id}>{x.display_name}</option>
                    ))}
                  </Select>
                </div>
                <Button size="sm" variant="secondary" disabled={!newParent} loading={busy === "link"}
                  onClick={() => run("link", () => supabase.from("family_links").insert({ parent_id: newParent, teen_id: p.id }))}>
                  Привязать
                </Button>
              </div>

              <div className="border-t border-line pt-3">
                <p className="font-semibold text-night mb-1">Пароль</p>
                <PasswordReset teenId={p.id} name={p.display_name} />
              </div>
            </>
          )}
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}
    </div>
  );
}
