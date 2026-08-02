import { getSetting, setSetting } from "@/lib/donate"

/**
 * Режим технических работ. Хранится в БД (site_settings):
 *   maintenance_enabled  = 1 | 0
 *   maintenance_message  = текст, показывается на сайте и в лаунчере
 */
export async function getMaintenanceState(): Promise<{ enabled: boolean; message: string }> {
  const enabled = ["1", "true", "on"].includes((await getSetting("maintenance_enabled")).trim().toLowerCase())
  const message = await getSetting("maintenance_message")
  return { enabled, message }
}

export async function setMaintenanceState(enabled: boolean, message: string): Promise<void> {
  await setSetting("maintenance_enabled", enabled ? "1" : "0")
  await setSetting("maintenance_message", message)
}