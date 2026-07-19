export interface Settings {
  memory_mb: number
  game_dir: string
  session_token: string | null
  nickname: string | null
  user_uuid: string | null
  hwid: string | null
  java_path: string
}

export interface LoginResponse {
  token: string | null
  nickname: string | null
  error: string | null
  banned: boolean
}

export interface VerifyResponse {
  valid: boolean
  nickname: string | null
  banned: boolean
}

export interface NewsItem {
  id: string
  author: string
  content: string
  imageUrl: string | null
  postedAt: string
  link: string | null
}

export interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion: string
  changelog: string
}

export interface UpdateProgress {
  stage: "downloading" | "installing" | "error"
  bytes_done: number
  bytes_total: number
  error: string | null
}

export interface SyncProgress {
  stage: "manifest" | "checking" | "downloading" | "cleaning" | "launching" | "done" | "error"
  current_file: string
  files_done: number
  files_total: number
  bytes_done: number
  bytes_total: number
  error: string | null
}
