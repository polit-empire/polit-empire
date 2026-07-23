import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import SeasonalOverlay from "./SeasonalOverlay"
import "./styles.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Праздничное оформление: сезонная палитра + падающие частицы.
        Монтируется рядом с App, чтобы тема действовала на всех экранах. */}
    <SeasonalOverlay />
    <App />
  </React.StrictMode>,
)
