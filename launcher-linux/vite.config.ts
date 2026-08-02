import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import obfuscator from "vite-plugin-javascript-obfuscator"

// Конфигурация Vite для Tauri.
//
// Фронтенд лаунчера (React/TS) собирается в обычный JS-бандл, который лежит в
// установленном приложении практически в открытом виде — его можно прочитать и
// понять логику авторизации/запуска. Поэтому на ПРОД-сборке (`vite build`)
// прогоняем весь бандл через javascript-obfuscator в режиме "средний":
// переименование идентификаторов, вынос строк в зашифрованный string-array
// (base64), разбиение строк, control-flow flattening. На dev-сервере обфускация
// отключена (apply: "build"), чтобы не мешать разработке и HMR.
export default defineConfig({
  plugins: [
    react(),
    obfuscator({
      // Только прод-сборка: dev/HMR остаются читаемыми и быстрыми.
      apply: "build",
      // Не трогаем сам движок obfuscator и любые внешние зависимости —
      // обфусцируем только собранные чанки приложения.
      exclude: [/node_modules/],
      options: {
        // Базовый «средний» пресет: хороший баланс защиты и скорости.
        optionsPreset: "medium-obfuscation",
        // debugProtection способен подвесить WebView2 — принудительно off.
        debugProtection: false,
        debugProtectionInterval: 0,
        // Не переименовываем глобальные имена: у Tauri есть свои
        // (`__TAURI__`, `__TAURI_INTERNALS__`), их переименование ломает IPC.
        renameGlobals: false,
        // Строки прячем в зашифрованный массив с base64-кодировкой.
        stringArray: true,
        stringArrayEncoding: ["base64"],
        stringArrayThreshold: 0.75,
        // Совместимость рантайма obfuscator с окружением WebView (browser).
        target: "browser",
      },
    }),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "chrome105",
    outDir: "dist",
  },
})
