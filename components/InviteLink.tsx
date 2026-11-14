"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Button } from "./ui";

export function inviteUrl(code: string) {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return `${location.origin}${base}/join/?code=${code}`;
}

/** Ссылка-приглашение: копировать + QR для живой встречи. */
export function InviteLink({ code }: { code: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const url = inviteUrl(code);

  useEffect(() => {
    if (showQr && !qr) QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: "#1c2340" } }).then(setQr);
  }, [showQr, qr, url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-2">
      <p className="text-xs text-muted break-all bg-cream rounded-lg px-2 py-1.5 border border-line select-all">{url}</p>
      <div className="flex gap-2 mt-2">
        <Button size="sm" variant="secondary" onClick={copy}>{copied ? "Скопировано ✓" : "Копировать ссылку"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setShowQr((v) => !v)}>{showQr ? "Скрыть QR" : "Показать QR"}</Button>
      </div>
      {showQr && qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR-код приглашения" className="mt-3 rounded-xl border border-line w-48 h-48" />
      )}
    </div>
  );
}
