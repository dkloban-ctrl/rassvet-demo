// Простые линейные иконки (24×24, stroke = currentColor).
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const IconSun = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" {...P}><path d="M3 18h18M6.3 18a5.7 5.7 0 0 1 11.4 0" /><path d="M12 5v3M4.9 8.9l2 2M19.1 8.9l-2 2M2.5 14H5M19 14h2.5" /></svg>
);
export const IconQuestion = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" {...P}><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12Z" /><path d="M9.8 9.5a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 1.9-2.2 3.3M12 16.6h.01" /></svg>
);
export const IconCalendar = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" {...P}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
);
export const IconMail = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" {...P}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
);
export const IconUsers = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" {...P}><circle cx="9" cy="8" r="3.2" /><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.6c2.3.3 3.9 1.9 4.5 4.4" /></svg>
);
export const IconShield = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" {...P}><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg>
);
export const IconMore = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" {...P}><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></svg>
);
export const IconEye = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" {...P}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></svg>
);
export const IconBack = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...P}><path d="m15 5-7 7 7 7" /></svg>
);
export const IconLock = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" {...P}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
);
