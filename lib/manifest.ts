import fs from "fs"
import path from "path"
import crypto from "crypto"

/**
 * Build manifest management.
 * Files live under STORAGE_DIR/builds/current (extracted ZIP contents).
 * Manifest history is persisted in the `builds` MySQL table.
 */

export interface ManifestFile {
  path: string // relative path inside the game dir, e.g. "mods/jei.jar"
  sha256: string
  size: number
}

export interface BuildManifest {
  buildId: number | null
  createdAt: string
  totalSize: number
  fileCount: number
  files: ManifestFile[]
}

export function getStorageDir(): string {
  return process.env.STORAGE_DIR || path.join(process.cwd(), "storage")
}

export function getCurrentBuildDir(): string {
  return path.join(getStorageDir(), "builds", "current")
}

export function getLauncherDir(): string {
  return path.join(getStorageDir(), "launcher")
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash("sha256")
  hash.update(fs.readFileSync(filePath))
  return hash.digest("hex")
}

function walkDir(dir: string, base: string, out: ManifestFile[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkDir(full, base, out)
    } else if (entry.isFile()) {
      const rel = path.relative(base, full).split(path.sep).join("/")
      const stat = fs.statSync(full)
      out.push({ path: rel, sha256: hashFile(full), size: stat.size })
    }
  }
}

/** Scan the current build directory and compute a fresh manifest. */
export function computeManifest(): BuildManifest {
  const dir = getCurrentBuildDir()
  const files: ManifestFile[] = []
  if (fs.existsSync(dir)) {
    walkDir(dir, dir, files)
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return {
    buildId: null,
    createdAt: new Date().toISOString(),
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    fileCount: files.length,
    files,
  }
}

/**
 * Resolve a manifest-relative file path safely (prevents path traversal).
 * Returns the absolute path or null if invalid.
 */
export function resolveBuildFile(relativePath: string): string | null {
  const dir = getCurrentBuildDir()
  const resolved = path.resolve(dir, relativePath)
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) return null
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null
  return resolved
}
