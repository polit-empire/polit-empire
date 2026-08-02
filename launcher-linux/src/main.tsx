import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import SeasonalOverlay from "./SeasonalOverlay"
import { applyActiveTheme } from "./lib/theme"
import "./styles.css"

// Применяем тему синхронно ДО первого рендера, чтобы не было вспышки
// дефолтной палитры при выбранной пользователем теме (или в праздник).
applyActiveTheme()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Праздничные частицы поверх интерфейса (снег, тыквы и т.п.).
        Монтируется рядом с App, чтобы работать на всех экранах. */}
    <SeasonalOverlay />
    <App />
  </React.StrictMode>,
)
