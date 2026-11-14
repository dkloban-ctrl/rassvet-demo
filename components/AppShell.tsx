"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/app/providers";
import type { Role } from "@/lib/types";
import { VERSE } from "@/lib/verse";
import { Button, Card, Loading, cx } from "./ui";
import { IconCalendar, IconMail, IconMore, IconQuestion, IconShield, IconSun, IconUsers } from "./icons";

type NavItem = { href: string; label: string; icon: ReactNode };

function navFor(role: Role): NavItem[] {
  const week = { href: "/", label: "Неделя", icon: <IconSun /> };
  const question = { href: "/question/", label: "Вопрос", icon: <IconQuestion /> };
  const schedule = { href: "/schedule/", label: "Встречи", icon: <IconCalendar /> };
  const inbox = { href: "/inbox/", label: "Лидерам", icon: <IconMail /> };
  const more = { href: "/more/", label: "Ещё", icon: <IconMore /> };
  if (role === "admin") return [week, question, schedule, { href: "/admin/", label: "Админка", icon: <IconShield /> }, more];
  if (role === "parent") return [week, schedule, { href: "/parent/", label: "Дети", icon: <IconUsers /> }, inbox, more];
  return [week, question, schedule, inbox, more];
}

const norm = (p: string) => (p.endsWith("/") ? p : p + "/");

export function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="bg-sunrise text-white safe-top">
      <div className="mx-auto max-w-lg px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="text-lg font-bold tracking-wide">Рассвет</span>
        </Link>
        <button onClick={() => setOpen((v) => !v)} className="text-sm text-white/85 hover:text-white" aria-expanded={open}>
          {VERSE.ref}
        </button>
      </div>
      {open && (
        <div className="mx-auto max-w-lg px-4 pb-3 -mt-1">
          <p className="font-serif italic text-[15px] leading-snug text-white/95">«{VERSE.text}»</p>
        </div>
      )}
    </header>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0b552" />
          <stop offset="1" stopColor="#e3815f" />
        </linearGradient>
      </defs>
      <path d="M7 21a9 9 0 0 1 18 0Z" fill="url(#lg)" />
      <path d="M4 22.5h24" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 6.5v3M8.2 10l1.8 1.8M23.8 10 22 11.8" stroke="#f0b552" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BottomNav({ role }: { role: Role }) {
  const path = norm(usePathname() || "/");
  const items = navFor(role);
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-line safe-bottom">
      <div className="mx-auto max-w-lg grid grid-cols-5">
        {items.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cx("flex flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] font-medium", active ? "text-coral" : "text-muted")}
            >
              {it.icon}
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Каркас защищённой страницы: проверка входа, статуса, роли + шапка и нижнее меню. */
export function AppShell({ children, allow }: { children: ReactNode; allow?: Role[] }) {
  const { session, profile, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.replace("/login/");
  }, [loading, session, router]);

  if (loading || !session) return <Loading />;

  if (!profile) {
    return (
      <Frame>
        <Card>
          <p className="text-sm">Аккаунт не найден в приложении. Возможно, регистрация не завершилась. Обратитесь к лидеру.</p>
          <Button variant="secondary" className="mt-3" onClick={signOut}>Выйти</Button>
        </Card>
      </Frame>
    );
  }

  if (profile.status !== "active") return <StatusScreen />;

  if (allow && !allow.includes(profile.role)) {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-lg px-4 py-6 pb-28"><Card>Этот раздел вам недоступен.</Card></main>
        <BottomNav role={profile.role} />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-lg px-4 py-5 pb-28">{children}</main>
      <BottomNav role={profile.role} />
    </>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-lg px-4 py-6">{children}</main>
    </>
  );
}

function StatusScreen() {
  const { profile, signOut, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!profile) return null;
  const blocked = profile.status === "blocked";
  return (
    <Frame>
      <Card className="text-center py-8">
        <div className="mx-auto mb-3 w-fit"><Logo size={48} /></div>
        <h1 className="text-xl font-bold text-night">
          {blocked ? "Аккаунт приостановлен" : `${profile.display_name}, почти готово!`}
        </h1>
        <p className="text-sm text-muted mt-2 max-w-xs mx-auto">
          {blocked
            ? "Доступ к приложению временно закрыт. Если это ошибка — поговорите с лидером."
            : profile.is_minor
              ? "Аккаунт заработает, когда родитель подпишет согласие в своём аккаунте, а лидер подтвердит. Обычно это быстро."
              : "Аккаунт ждёт подтверждения лидера."}
        </p>
        <div className="flex gap-2 justify-center mt-5">
          <Button variant="secondary" loading={busy} onClick={async () => { setBusy(true); await refresh(); setBusy(false); }}>
            Проверить снова
          </Button>
          <Button variant="ghost" onClick={signOut}>Выйти</Button>
        </div>
      </Card>
    </Frame>
  );
}
