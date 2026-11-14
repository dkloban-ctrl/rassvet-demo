// Статический экспорт: приложение — набор файлов, вся безопасность в базе (RLS).
// NEXT_PUBLIC_BASE_PATH=/rassvet-demo для GitHub Pages; пусто — для своего домена / Vercel.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
export default {
  output: "export",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};
