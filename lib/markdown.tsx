import { Fragment, type ReactNode } from "react";

// Мини-markdown для листков: заголовки ##, списки -, **жирный**, *курсив*, абзацы.
// Рендерим React-элементами (без innerHTML) — никакого HTML из базы в странице.

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(
      t.startsWith("**")
        ? <strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>
        : <em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>,
    );
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="prose-rassvet">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (!lines.length) return null;
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ""), `${bi}-${li}`)}</li>)}
            </ul>
          );
        }
        if (lines.length === 1 && /^#{1,3}\s/.test(lines[0])) {
          return <h3 key={bi}>{inline(lines[0].replace(/^#{1,3}\s+/, ""), `${bi}`)}</h3>;
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
