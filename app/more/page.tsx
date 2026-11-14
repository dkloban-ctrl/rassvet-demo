"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/app/providers";
import { AppShell } from "@/components/AppShell";
import { NotificationSettings } from "@/components/Notifications";
import { Badge, Button, Card, Notice, PageTitle, SectionTitle } from "@/components/ui";
import { emailToLogin } from "@/lib/supabase";
import { ROLE_LABEL } from "@/lib/types";
import { CHURCH, VERSE } from "@/lib/verse";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function MorePage() {
  return (
    <AppShell>
      <More />
    </AppShell>
  );
}

function More() {
  const { profile, session, signOut } = useAuth();
  const [installEvt, setInstallEvt] = useState<BIPEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const h = (e: Event) => { e.preventDefault(); setInstallEvt(e as BIPEvent); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  if (!profile) return null;
  const login = emailToLogin(session?.user.email);
  const role = profile.role;

  return (
    <div>
      <PageTitle>Ещё</PageTitle>
      <Card>
        <p className="text-lg font-bold text-night">{profile.display_name}</p>
        <div className="flex gap-2 mt-1 items-center">
          <Badge tone="dusk">{ROLE_LABEL[role]}</Badge>
          <span className="text-sm text-muted">{login ? `логин: ${login}` : session?.user.email}</span>
        </div>
      </Card>

      <SectionTitle>Установить на телефон</SectionTitle>
      <Card>
        {standalone ? (
          <p className="text-sm">Приложение уже установлено на экран — отлично!</p>
        ) : (
          <>
            <p className="text-sm text-muted mb-3">Установите «Рассвет» на экран «Домой» — откроется как обычное приложение. На iPhone уведомления работают только после установки.</p>
            {installEvt && (
              <Button className="mb-3" onClick={async () => { await installEvt.prompt(); setInstallEvt(null); }}>Установить</Button>
            )}
            <div className="text-sm space-y-3">
              <div className={ios ? "" : "opacity-80"}>
                <p className="font-semibold text-night">iPhone (Safari)</p>
                <ol className="list-decimal pl-5 mt-1 space-y-0.5">
                  <li>Откройте эту страницу именно в Safari.</li>
                  <li>Нажмите «Поделиться» (квадрат со стрелкой вверх).</li>
                  <li>Выберите «На экран “Домой”» → «Добавить».</li>
                </ol>
              </div>
              <div className={ios ? "opacity-80" : ""}>
                <p className="font-semibold text-night">Android (Chrome)</p>
                <ol className="list-decimal pl-5 mt-1 space-y-0.5">
                  <li>Нажмите ⋮ в правом верхнем углу.</li>
                  <li>Выберите «Установить приложение» или «Добавить на главный экран».</li>
                </ol>
              </div>
            </div>
          </>
        )}
      </Card>

      <SectionTitle>Уведомления</SectionTitle>
      <NotificationSettings />

      <SectionTitle>Кто видит мои данные</SectionTitle>
      <Card className="text-sm space-y-1.5">
        <p>• В приложении хранится только имя (без фамилии) и роль.</p>
        {(role === "teen" || role === "helper") && (
          <>
            <p>• Ответ на вопрос недели «анонимно для ребят»: ребята и помощники не видят имя, <b>лидеры видят</b>. Родители ответов не видят.</p>
            <p>• Сообщения лидерам видят все лидеры. Родитель — только если лидер откроет доступ; ты это увидишь в разделе «Лидерам».</p>
            <p>• Личной переписки со взрослыми в приложении нет.</p>
          </>
        )}
        {role === "parent" && (
          <>
            <p>• Ваши сообщения лидерам видят все лидеры.</p>
            <p>• Вы видите своих детей и лидеров. Других родителей и чужих детей — нет.</p>
          </>
        )}
        {role === "admin" && <p>• Все важные действия лидеров записываются в журнал, который видят все лидеры.</p>}
      </Card>

      <Notice>Это демо-версия с вымышленными людьми. Данные могут быть сброшены.</Notice>

      <Button variant="secondary" className="w-full mt-2" onClick={signOut}>Выйти</Button>

      <p className="text-center text-xs text-muted mt-8 font-serif italic px-6">«{VERSE.text}» — {VERSE.ref}</p>
      <p className="text-center text-[11px] text-muted mt-2 uppercase tracking-widest">{CHURCH}</p>
    </div>
  );
}
