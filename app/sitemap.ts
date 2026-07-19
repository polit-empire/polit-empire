import type { MetadataRoute } from "next"

// Публичный адрес сайта. Можно переопределить переменной окружения SITE_URL.
const SITE_URL = (process.env.SITE_URL || process.env.PUBLIC_BASE_URL || "https://politempire.ru").replace(/\/+$/, "")

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  // Только публичные страницы (админку и кабинет исключаем).
  const routes: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] =
    [
      { path: "/", priority: 1, changeFrequency: "daily" },
      { path: "/donate", priority: 0.8, changeFrequency: "weekly" },
      { path: "/rules", priority: 0.5, changeFrequency: "monthly" },
    ]

  return routes.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }))
}
