// Тексты уведомлений. Чистые функции без сети — проверяются отдельно.
//
// Правило приватности: экран блокировки видят другие люди (родители, одноклассники),
// поэтому в пуше нет имён и текстов из ящика лидеров — только «есть новое».

export type Kind = "leaflet" | "question" | "announcement" | "inbox_new" | "inbox_reply";
export type Item = { title?: string; body?: string; verse_ref?: string | null; verse_text?: string | null };
export type PushMessage = { title: string; body: string; url: string; tag: string };

/** Обрезать по слову, без разрыва посреди слова. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:—-]+$/, "") + "…";
}

/** Markdown → простой текст (для превью и писем). */
export function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/(\*\*|__|\*|_|`)/g, "");
}

// url — относительно корня приложения (service worker достраивает до полного адреса).
export function buildMessage(kind: Kind, item: Item): PushMessage {
  switch (kind) {
    case "leaflet":
      return { title: "Новый листок недели", body: clip(item.title ?? "", 100), url: "leaflet/", tag: "leaflet" };
    case "question":
      return { title: "Вопрос недели", body: clip(plain(item.body ?? ""), 120), url: "question/", tag: "question" };
    case "announcement":
      return { title: clip(item.title ?? "Объявление", 60), body: clip(plain(item.body ?? ""), 120), url: "schedule/", tag: "announcement" };
    case "inbox_new":
      return { title: "Ящик лидеров", body: "Новое сообщение", url: "admin/", tag: "inbox" };
    case "inbox_reply":
      return { title: "Лидеры ответили", body: "Откройте «Лидерам», чтобы прочитать", url: "inbox/", tag: "inbox-reply" };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Письмо родителю о новом листке: заголовок, стих, начало текста, ссылка. */
export function leafletEmail(item: Item, parentName: string, appUrl: string) {
  const title = item.title ?? "Листок недели";
  const excerpt = clip(plain(item.body ?? ""), 400);
  const url = `${appUrl}leaflet/`;
  const settings = `${appUrl}more/`;
  const verse = item.verse_text ? `«${item.verse_text.trim()}»${item.verse_ref ? ` — ${item.verse_ref}` : ""}` : "";
  const subject = `Листок недели: ${clip(title, 80)}`;
  const text = [
    `Здравствуйте, ${parentName}!`,
    "",
    `В «Рассвете» новый листок недели — «${title}».`,
    verse && `\n${verse}`,
    excerpt && `\n${excerpt}`,
    "",
    `Прочитать: ${url}`,
    "",
    "Хороший повод поговорить с ребёнком о теме недели.",
    "",
    "—",
    "Подростковое служение церкви «Вифания»",
    `Отключить такие письма: «Ещё» → «Уведомления» в приложении (${settings}).`,
  ].filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");

  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f6f1ea;font-family:Georgia,'Times New Roman',serif;color:#1d2340">
<div style="max-width:560px;margin:0 auto;padding:28px 22px">
<p style="font-family:Arial,sans-serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8a7f73;margin:0 0 18px">Рассвет · листок недели</p>
<p style="font-family:Arial,sans-serif;font-size:15px;margin:0 0 14px">Здравствуйте, ${esc(parentName)}!</p>
<h1 style="font-size:24px;line-height:1.25;margin:0 0 14px">${esc(title)}</h1>
${verse ? `<p style="font-style:italic;font-size:16px;line-height:1.5;border-left:3px solid #d9a441;padding-left:12px;margin:0 0 16px">${esc(verse)}</p>` : ""}
${excerpt ? `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;margin:0 0 20px">${esc(excerpt)}</p>` : ""}
<p style="margin:0 0 24px"><a href="${esc(url)}" style="display:inline-block;background:#1d2340;color:#fff;text-decoration:none;font-family:Arial,sans-serif;font-size:15px;padding:12px 20px;border-radius:10px">Прочитать листок</a></p>
<p style="font-family:Arial,sans-serif;font-size:14px;color:#4a4f66;margin:0 0 28px">Хороший повод поговорить с ребёнком о теме недели.</p>
<p style="font-family:Arial,sans-serif;font-size:12px;color:#8a7f73;line-height:1.5;margin:0">Подростковое служение церкви «Вифания».<br>Отключить такие письма: «Ещё» → «Уведомления» <a href="${esc(settings)}" style="color:#8a7f73">в приложении</a>.</p>
</div></body></html>`;
  return { subject, text, html };
}
