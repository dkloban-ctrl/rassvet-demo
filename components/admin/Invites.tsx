"use client";

import { useState } from "react";
import { InviteLink } from "@/components/InviteLink";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, SectionTitle, Select } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { humanError, supabase } from "@/lib/supabase";
import { ROLE_LABEL, type Invite, type Profile, type Role } from "@/lib/types";
import { must, useLoad } from "@/lib/useLoad";

export function Invites() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [i, p] = await Promise.all([
      supabase.from("invites").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, display_name, role"),
    ]);
    return { invites: must(i) as Invite[], people: must(p) as Pick<Profile, "id" | "display_name" | "role">[] };
  }, []);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;
  const name = (id: string | null) => data.people.find((p) => p.id === id)?.display_name ?? "—";
  const now = new Date();
  const requests = data.invites.filter((i) => !i.approved_by && !i.used_at && new Date(i.expires_at) > now);
  const active = data.invites.filter((i) => i.approved_by && !i.used_at && new Date(i.expires_at) > now);
  const done = data.invites.filter((i) => i.used_at || new Date(i.expires_at) <= now);

  return (
    <div>
      <NewInvite parents={data.people.filter((p) => p.role === "parent")} onCreated={reload} />

      {requests.length > 0 && (
        <>
          <SectionTitle>Запросы родителей</SectionTitle>
          <div className="space-y-2">
            {requests.map((i) => <RequestRow key={i.id} invite={i} parentName={name(i.parent_id)} onChange={reload} />)}
          </div>
        </>
      )}

      <SectionTitle>Действующие</SectionTitle>
      {active.length === 0 ? <Empty>Нет действующих приглашений.</Empty> : (
        <div className="space-y-2">
          {active.map((i) => (
            <Card key={i.id}>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone="dusk">{ROLE_LABEL[i.role]}</Badge>
                <span className="text-sm text-night">{i.email ?? (i.parent_id ? `ребёнок → ${name(i.parent_id)}` : "")}</span>
                <span className="ml-auto text-xs text-muted">до {fmtDate(i.expires_at)}</span>
              </div>
              <InviteLink code={i.code} />
            </Card>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <>
          <SectionTitle>Использованные и истёкшие</SectionTitle>
          <Card className="p-0 divide-y divide-line">
            {done.map((i) => (
              <div key={i.id} className="px-4 py-2.5 text-sm flex items-center gap-2">
                <Badge>{ROLE_LABEL[i.role]}</Badge>
                <span>{i.used_at ? `использовано: ${name(i.used_by)} · ${fmtDate(i.used_at)}` : `истекло ${fmtDate(i.expires_at)}`}</span>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function RequestRow({ invite, parentName, onChange }: { invite: Invite; parentName: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(approve: boolean) {
    setBusy(true);
    const { error } = approve
      ? await supabase.rpc("approve_invite", { p_invite: invite.id })
      : await supabase.from("invites").delete().eq("id", invite.id);
    setBusy(false);
    if (error) return setError(humanError(error));
    onChange();
  }
  return (
    <Card>
      <p className="text-sm"><b>{parentName}</b> просит приглашение для ребёнка · {fmtDate(invite.created_at)}</p>
      <div className="flex gap-2 mt-2">
        <Button size="sm" onClick={() => act(true)} loading={busy}>Одобрить</Button>
        <Button size="sm" variant="ghost" onClick={() => act(false)} disabled={busy}>Отклонить</Button>
      </div>
      <ErrorBox>{error}</ErrorBox>
    </Card>
  );
}

function NewInvite({ parents, onCreated }: { parents: Pick<Profile, "id" | "display_name">[]; onCreated: () => void }) {
  const [role, setRole] = useState<Role>("teen");
  const [email, setEmail] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Invite | null>(null);
  const needsParent = role === "teen" || role === "helper";
  const needsEmail = role !== "teen";

  async function create() {
    setError(null);
    if (needsParent && !parentId) return setError("Выберите родителя: без него не будет согласия");
    if (needsEmail && !/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Укажите e-mail");
    setBusy(true);
    const { data, error } = await supabase.from("invites")
      .insert({ role, email: needsEmail ? email.trim().toLowerCase() : null, parent_id: needsParent ? parentId : null })
      .select("*").single();
    setBusy(false);
    if (error) return setError(humanError(error));
    setCreated(data as Invite);
    setEmail("");
    onCreated();
  }

  return (
    <Card>
      <p className="font-semibold text-night mb-3">Новое приглашение</p>
      <Field label="Кого приглашаем">
        <Select value={role} onChange={(e) => { setRole(e.target.value as Role); setCreated(null); }}>
          <option value="teen">Подростка (вход по логину)</option>
          <option value="parent">Родителя</option>
          <option value="helper">Помощника (до 18)</option>
          <option value="admin">Лидера</option>
        </Select>
      </Field>
      {needsParent && (
        <Field label="Родитель" hint="Ребёнок будет привязан к нему, согласие подпишет он. Нет родителя в списке — сначала пригласите его.">
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Выберите…</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </Select>
        </Field>
      )}
      {needsEmail && (
        <Field label="E-mail" hint="Зарегистрироваться по ссылке можно только с этим адресом">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      )}
      <ErrorBox>{error}</ErrorBox>
      <Button onClick={create} loading={busy}>Создать ссылку</Button>
      {created && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm font-semibold text-emerald-800">Готово. Ссылка действует 7 дней и сработает один раз.</p>
          <InviteLink code={created.code} />
        </div>
      )}
    </Card>
  );
}
