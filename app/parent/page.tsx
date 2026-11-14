"use client";

import { useState } from "react";
import { useAuth } from "@/app/providers";
import { AppShell } from "@/components/AppShell";
import { InviteLink } from "@/components/InviteLink";
import { PasswordReset } from "@/components/PasswordReset";
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Loading, Notice, PageTitle, SectionTitle } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { humanError, supabase } from "@/lib/supabase";
import type { Consent, InboxAccess, Invite, Profile } from "@/lib/types";
import { must, useLoad } from "@/lib/useLoad";

export default function ParentPage() {
  return (
    <AppShell allow={["parent"]}>
      <PageTitle sub="Согласие, пароль и доступы для ваших детей">Мои дети</PageTitle>
      <Children />
    </AppShell>
  );
}

type Doc = { version: string; title: string };

function Children() {
  const { profile } = useAuth();
  const { data, error, loading, reload } = useLoad(async () => {
    const links = must(await supabase.from("family_links").select("teen_id").eq("parent_id", profile!.id)) as { teen_id: string }[];
    const ids = links.map((l) => l.teen_id);
    const [kids, consents, docs, access, invites] = await Promise.all([
      ids.length ? supabase.from("profiles").select("*").in("id", ids) : Promise.resolve({ data: [], error: null }),
      supabase.from("consents").select("*").eq("parent_id", profile!.id),
      supabase.from("consent_documents").select("version, title").eq("is_current", true),
      supabase.from("parent_inbox_access").select("*").eq("parent_id", profile!.id).is("revoked_at", null),
      supabase.from("invites").select("*").eq("parent_id", profile!.id).order("created_at", { ascending: false }),
    ]);
    return {
      kids: must(kids) as Profile[],
      consents: must(consents) as Consent[],
      doc: ((must(docs) as Doc[])[0] ?? null) as Doc | null,
      access: must(access) as InboxAccess[],
      invites: must(invites) as Invite[],
    };
  }, [profile?.id]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;

  return (
    <div>
      {data.kids.length === 0 && <Empty>Дети пока не привязаны к вашему аккаунту.</Empty>}
      <div className="space-y-3">
        {data.kids.map((k) => (
          <ChildCard key={k.id} kid={k} doc={data.doc}
            consent={data.consents.find((c) => c.teen_id === k.id && !c.revoked_at && c.version === data.doc?.version) ?? null}
            access={data.access.find((a) => a.teen_id === k.id) ?? null} onChange={reload} />
        ))}
      </div>
      <InviteRequests invites={data.invites} onChange={reload} />
    </div>
  );
}

function ChildCard({ kid, doc, consent, access, onChange }: {
  kid: Profile; doc: Doc | null; consent: Consent | null; access: InboxAccess | null; onChange: () => void;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold text-night">{kid.display_name}</h2>
        {kid.status === "active" && <Badge tone="green">активен</Badge>}
        {kid.status === "pending" && <Badge tone="gold">{consent ? "ждёт подтверждения лидера" : "ждёт вашего согласия"}</Badge>}
        {kid.status === "blocked" && <Badge tone="red">приостановлен</Badge>}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <ConsentBlock kid={kid} doc={doc} consent={consent} onChange={onChange} />
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-sm font-semibold text-night mb-1.5">Пароль</p>
        <PasswordReset teenId={kid.id} name={kid.display_name} />
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <ChildInbox kid={kid} access={access} />
      </div>
    </Card>
  );
}

function ConsentBlock({ kid, doc, consent, onChange }: { kid: Profile; doc: Doc | null; consent: Consent | null; onChange: () => void }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const { profile } = useAuth();

  async function sign() {
    if (!doc) return;
    setBusy(true);
    const { error } = await supabase.from("consents").insert({ teen_id: kid.id, parent_id: profile!.id, version: doc.version });
    setBusy(false);
    if (error) return setError(humanError(error));
    onChange();
  }
  async function revoke() {
    if (!consent) return;
    setBusy(true);
    const { error } = await supabase.rpc("revoke_consent", { p_consent: consent.id });
    setBusy(false);
    setAsk(false);
    if (error) return setError(humanError(error));
    onChange();
  }

  if (consent) {
    return (
      <div>
        <p className="text-sm"><b className="text-night">Согласие подписано</b> {fmtDate(consent.signed_at)} (версия {consent.version})</p>
        <Button size="sm" variant="ghost" className="mt-1 -ml-3" onClick={() => setAsk(true)}>Отозвать согласие</Button>
        <ErrorBox>{error}</ErrorBox>
        <Confirm open={ask} title="Отозвать согласие?" danger confirmText="Отозвать" loading={busy}
          text={`${kid.display_name} сразу потеряет доступ к приложению. Вернуть можно, подписав согласие снова.`}
          onConfirm={revoke} onCancel={() => setAsk(false)} />
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-semibold text-night">Согласие родителя</p>
      <div className="text-sm text-ink/85 mt-1.5 space-y-1.5 bg-cream rounded-xl p-3 border border-line">
        <p><b>{doc?.title ?? "Согласие"}</b></p>
        <ul className="list-disc pl-4 space-y-1">
          <li>Храним только имя (без фамилии), роль и связь «родитель — ребёнок». Никаких дат рождения, адресов, школ, фото.</li>
          <li>Личных сообщений между взрослыми и подростками нет. Обращения к лидерам видят все лидеры сразу.</li>
          <li>Родителю могут открыть чтение обращений своего ребёнка — только по решению лидера, только новых сообщений, и ребёнок это видит.</li>
          <li>Ответы на вопрос недели родители не видят. Анонимный ответ скрыт от ребят, но лидеры видят автора — чтобы помочь, если подросток в беде.</li>
          <li>Согласие можно отозвать в любой момент; данные удаляются по запросу семьи.</li>
        </ul>
      </div>
      <label className="flex items-start gap-2 mt-3 text-sm">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-4 w-4 accent-[#1c2340]" />
        <span>Я законный представитель {kid.display_name} и согласен(на) на обработку данных на этих условиях.</span>
      </label>
      <ErrorBox>{error}</ErrorBox>
      <Button className="mt-3" disabled={!agree || !doc} loading={busy} onClick={sign}>Подписать согласие</Button>
      <p className="text-xs text-muted mt-2">После подписи лидер подтвердит аккаунт, и {kid.display_name} сможет пользоваться приложением.</p>
    </div>
  );
}

function ChildInbox({ kid, access }: { kid: Profile; access: InboxAccess | null }) {
  const [rows, setRows] = useState<{ message_id: string; author_name: string | null; body: string; created_at: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    const { data, error } = await supabase.rpc("child_inbox", { p_teen: kid.id });
    setBusy(false);
    if (error) return setError(humanError(error));
    setRows(data ?? []);
  }

  if (!access) {
    return (
      <div>
        <p className="text-sm font-semibold text-night">Обращения к лидерам</p>
        <p className="text-sm text-muted mt-1">
          Сообщения {kid.display_name} лидерам вам не видны. Доступ может открыть лидер по вашей просьбе — тогда {kid.display_name} увидит, что вы читаете, и только сообщения после открытия.
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-sm font-semibold text-night">Обращения к лидерам</p>
      <Notice>Лидер открыл вам чтение с {fmtDate(access.granted_at)}. {kid.display_name} видит это. Каждое чтение записывается в журнал.</Notice>
      {rows === null ? (
        <Button size="sm" variant="secondary" onClick={load} loading={busy}>Показать сообщения</Button>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">Новых сообщений после открытия доступа нет.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.message_id} className="rounded-xl bg-cream border border-line px-3 py-2">
              <p className="text-xs font-semibold text-dusk">{r.author_name ?? "—"} · {fmtDateTime(r.created_at)}</p>
              <p className="text-sm whitespace-pre-line mt-0.5">{r.body}</p>
            </div>
          ))}
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}

function InviteRequests({ invites, onChange }: { invites: Invite[]; onChange: () => void }) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = invites.filter((i) => !i.used_at && new Date(i.expires_at) > new Date());

  async function request() {
    setBusy(true);
    const { error } = await supabase.from("invites").insert({ role: "teen", parent_id: profile!.id, created_by: profile!.id });
    setBusy(false);
    if (error) return setError(humanError(error));
    onChange();
  }

  return (
    <>
      <SectionTitle>Пригласить ребёнка</SectionTitle>
      <Card>
        <p className="text-sm text-muted">Создайте приглашение — после одобрения лидера появится ссылка, по которой ребёнок сам придумает логин и пароль.</p>
        {active.map((i) => (
          <div key={i.id} className="mt-3 border-t border-line pt-3">
            {i.approved_by ? (
              <>
                <Badge tone="green">одобрено · действует до {fmtDate(i.expires_at)}</Badge>
                <InviteLink code={i.code} />
              </>
            ) : (
              <Badge tone="gold">ждёт одобрения лидера</Badge>
            )}
          </div>
        ))}
        <ErrorBox>{error}</ErrorBox>
        <Button variant="secondary" className="mt-3" onClick={request} loading={busy}>Запросить приглашение</Button>
      </Card>
    </>
  );
}
