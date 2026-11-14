"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100",
        size === "md" ? "px-4 py-2.5 text-[15px]" : "px-3 py-1.5 text-sm",
        variant === "primary" && "bg-night text-white shadow-sm hover:bg-dusk",
        variant === "secondary" && "bg-white text-night border border-line hover:bg-dawn",
        variant === "ghost" && "text-dusk hover:bg-dawn",
        variant === "danger" && "bg-white text-red-700 border border-red-200 hover:bg-red-50",
        className,
      )}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[15px] font-semibold transition active:scale-[0.98]",
        variant === "primary" ? "bg-night text-white hover:bg-dusk" : "bg-white text-night border border-line hover:bg-dawn",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl bg-white border border-line shadow-[0_1px_2px_rgba(28,35,64,0.04)] p-4", className)}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-6 mb-2 px-1">
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-medium text-ink mb-1">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted mt-1">{hint}</span>}
      {error && <span className="block text-xs text-red-700 mt-1">{error}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[16px] outline-none focus:border-dusk focus:ring-2 focus:ring-dusk/15 placeholder:text-muted/60";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, "min-h-24 leading-relaxed", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, "appearance-none", props.className)} />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "gold" | "green" | "red" | "dusk" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "neutral" && "bg-cream text-muted border border-line",
        tone === "gold" && "bg-dawn text-[#8a5a10]",
        tone === "green" && "bg-emerald-50 text-emerald-800",
        tone === "red" && "bg-red-50 text-red-800",
        tone === "dusk" && "bg-dusk/10 text-dusk",
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      aria-label="Загрузка"
      className={cx("inline-block animate-spin rounded-full border-2 border-current border-r-transparent", small ? "h-4 w-4" : "h-6 w-6")}
    />
  );
}

export function Loading() {
  return (
    <div className="flex justify-center py-16 text-dusk">
      <Spinner />
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div role="alert" className="rounded-xl bg-red-50 border border-red-100 text-red-800 text-sm px-3 py-2 my-3">{children}</div>;
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "success" | "warn" }) {
  return (
    <div
      className={cx(
        "rounded-xl text-sm px-3 py-2.5 my-3 border",
        tone === "info" && "bg-dawn border-[#f5dfb8] text-[#6e4a12]",
        tone === "success" && "bg-emerald-50 border-emerald-100 text-emerald-900",
        tone === "warn" && "bg-orange-50 border-orange-100 text-orange-900",
      )}
    >
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-center text-muted text-sm py-8">{children}</div>;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4 px-1">
      <h1 className="text-2xl font-bold text-night">{children}</h1>
      {sub && <p className="text-sm text-muted mt-1">{sub}</p>}
    </div>
  );
}

/** Подтверждение внутри страницы (window.confirm в PWA на iOS ведёт себя плохо). */
export function Confirm({
  open, title, text, confirmText = "Да", danger, onConfirm, onCancel, loading,
}: {
  open: boolean; title: string; text?: ReactNode; confirmText?: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-night/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-night">{title}</h3>
        {text && <div className="text-sm text-muted mt-2">{text}</div>}
        <div className="flex gap-2 mt-5 justify-end">
          <Button variant="secondary" onClick={onCancel}>Отмена</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>{confirmText}</Button>
        </div>
      </div>
    </div>
  );
}

export { cx };
