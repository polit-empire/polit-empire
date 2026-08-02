import { getSetting, setSetting } from "@/lib/donate"

/**
 * Режим технических работ. Хранится в БД (site_settings):
 *   maintenance_enabled  = 1 | 0  — техработы на сайте (заглушка посетителям)
 *   maintenance_launcher = 1 | 0  — техработы в лаунчере (запуск только админам)
 *   maintenance_message  = текст, показывается на сайте и в лаунчере
 */
export interface MaintenanceState {
  /** Техработы на сайте: посетителям показывается заглушка. */
  enabled: boolean
  /** Техработы в лаунчере: запуск игры только администраторам. */
  launcher: boolean
  message: string
}

function isOn(v: string): boolean {
  return ["1", "true", "on"].includes(v.trim().toLowerCase())
}

export async function getMaintenanceState(): Promise<MaintenanceState> {
  const enabled = isOn(await getSetting("maintenance_enabled"))
  const message = await getSetting("maintenance_message")
  // Если отдельный флаг лаунчера ещё не задан — по умолчанию повторяем сайт
  // (обратная совместимость со старым общим переключателем).
  const launcherRaw = (await getSetting("maintenance_launcher")).trim().toLowerCase()
  const launcher = launcherRaw === "" ? enabled : isOn(launcherRaw)
  return { enabled, launcher, message }
}

export async function setMaintenanceState(state: MaintenanceState): Promise<void> {
  await setSetting("maintenance_enabled", state.enabled ? "1" : "0")
  await setSetting("maintenance_launcher", state.launcher ? "1" : "0")
  await setSetting("maintenance_message", state.message)
}
