"use client"

import { useEffect, useRef } from "react"

/**
 * Интерактивный фон героя — «паутинка»: сеть частиц, соединённых линиями.
 * Частицы медленно дрейфуют; рядом с курсором соединяются с ним и слегка
 * притягиваются, образуя живую паутину. Рендерится на <canvas> через
 * requestAnimationFrame, без ре-рендеров React. Учитывает DPR и
 * prefers-reduced-motion (тогда частицы статичны).
 */
export function HeroBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const context = canvasEl.getContext("2d")
    if (!context) return
    // Non-null локальные ссылки, чтобы сужение типа работало во вложенных функциях
    const canvas: HTMLCanvasElement = canvasEl
    const ctx: CanvasRenderingContext2D = context

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // Цвет частиц/линий берём из темы (primary), с запасным значением.
    const styles = getComputedStyle(document.documentElement)
    const primary = styles.getPropertyValue("--primary").trim() || "oklch(0.7 0.15 160)"

    let width = 0
    let height = 0
    let dpr = Math.min(window.devicePixelRatio || 1, 2)

    type Particle = { x: number; y: number; vx: number; vy: number }
    let particles: Particle[] = []
    const mouse = { x: -9999, y: -9999 }

    const LINK_DIST = 150 // макс. расстояние соединения частиц
    const MOUSE_DIST = 200 // радиус влияния курсора
    const BASE_SPEED = 0.5 // базовая скорость постоянного дрейфа

    // Держим скорость около BASE_SPEED, чтобы паутина всё время плавала сама.
    function keepDrifting(p: Particle) {
      const speed = Math.hypot(p.vx, p.vy)
      if (speed < BASE_SPEED * 0.6) {
        const factor = (BASE_SPEED * 0.6) / (speed || 1)
        p.vx *= factor
        p.vy *= factor
      }
    }

    function resize() {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Плотность частиц зависит от площади (гуще, чем раньше).
      const count = Math.min(170, Math.max(70, Math.floor((width * height) / 8000)))
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * BASE_SPEED * 2,
        vy: (Math.random() - 0.5) * BASE_SPEED * 2,
      }))
    }

    function draw() {
      ctx.clearRect(0, 0, width, height)

      for (const p of particles) {
        if (!reduce) {
          // Лёгкое притяжение к курсору
          const dxm = mouse.x - p.x
          const dym = mouse.y - p.y
          const dm = Math.hypot(dxm, dym)
          if (dm < MOUSE_DIST && dm > 0) {
            const force = (1 - dm / MOUSE_DIST) * 0.6
            p.vx += (dxm / dm) * force * 0.05
            p.vy += (dym / dm) * force * 0.05
          }

          p.x += p.vx
          p.y += p.vy
          // Лёгкое затухание, чтобы притяжение курсора не разгоняло частицы,
          // но паутина продолжала плавать сама.
          p.vx *= 0.99
          p.vy *= 0.99
          keepDrifting(p)

          // Отражение от краёв
          if (p.x < 0 || p.x > width) p.vx *= -1
          if (p.y < 0 || p.y > height) p.vy *= -1
          p.x = Math.max(0, Math.min(width, p.x))
          p.y = Math.max(0, Math.min(height, p.y))
        }

        // Сама частица
        ctx.beginPath()
        ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2)
        ctx.fillStyle = primary
        ctx.globalAlpha = 0.7
        ctx.fill()
      }

      // Линии между близкими частицами
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i]
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j]
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          if (d < LINK_DIST) {
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.strokeStyle = primary
            ctx.globalAlpha = (1 - d / LINK_DIST) * 0.35
            ctx.lineWidth = 1
            ctx.stroke()
          }
        }

        // Линии от частиц к курсору — «паутина» тянется за мышью
        const dxm = mouse.x - a.x
        const dym = mouse.y - a.y
        const dm = Math.hypot(dxm, dym)
        if (dm < MOUSE_DIST) {
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(mouse.x, mouse.y)
          ctx.strokeStyle = primary
          ctx.globalAlpha = (1 - dm / MOUSE_DIST) * 0.5
          ctx.lineWidth = 1
          ctx.stroke()
        }
      }

      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }

    let raf = 0
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.y = e.clientY - rect.top
    }
    const onLeave = () => {
      mouse.x = -9999
      mouse.y = -9999
    }

    resize()
    draw()
    window.addEventListener("resize", resize)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerleave", onLeave)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerleave", onLeave)
    }
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{
          maskImage: "radial-gradient(ellipse 90% 80% at 50% 45%, black, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 80% at 50% 45%, black, transparent 80%)",
        }}
      />
    </div>
  )
}
