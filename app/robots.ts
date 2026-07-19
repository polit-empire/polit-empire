import type { MetadataRoute } from "next"

// Публичный адрес сайта. Можно переопределить переменной окружения SITE_URL.
const SITE_URL = (process.env.SITE_URL || process.env.PUBLIC_BASE_URL || "https://politempire.ru").replace(/\/+$/, "")

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Служебные разделы прячем от поисковых систем.
        disallow: ["/admin", "/account", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
