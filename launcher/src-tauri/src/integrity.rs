use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use sha2::Sha256;
use std::fs;
use std::path::Path;

/// SHA-256 собственного исполняемого файла лаунчера.
///
/// Хешируется файл, на который указывает `current_exe()` — тот самый .exe,
/// что установлен игроку. Любое изменение файла (хоть на байт) меняет хеш.
/// Возвращает None, если путь/чтение недоступны (тогда проверка fail-open).
pub fn self_sha256() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let data = fs::read(&exe).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Some(hex::encode(hasher.finalize()))
}

/// Серверная сверка целостности лаунчера (self-integrity).
///
/// Лаунчер считает SHA-256 своего .exe и отправляет его на
/// `POST {api_base}/api/launcher/verify` вместе со своей версией и токеном
/// сессии. Решение принимает СЕРВЕР по белому списку официальных сборок — это
/// главный смысл схемы: даже если локальные проверки вырезаны, модифицированный
/// лаунчер не получит подтверждения запуска.
///
/// Политика (совпадает с остальным лаунчером — fail-open на инфраструктуру):
///  • dev-сборка (`tauri dev` / debug) → Ok(()) — самопроверку НЕ применяем,
///    иначе локальная разработка блокируется: обфускация и goldberg дают
///    невоспроизводимый бинарник, чей хеш не совпадёт с белым списком;
///  • сеть недоступна / нет токена / не удалось посчитать хеш → Ok(()) (пускаем);
///  • сервер явно ответил `ok:false` → Err(reason) (блокируем запуск);
///  • сервер `ok:true` (в т.ч. когда белый список пуст) → Ok(()).
pub async fn verify_self_integrity() -> Result<(), String> {
    // Debug-сборки (запуск через `tauri dev` или `cargo build` без --release)
    // не проверяем: каждый локальный билд уникален и не попадает в белый список.
    // На релизных сборках (debug_assertions выключены) проверка работает штатно.
    if cfg!(debug_assertions) {
        return Ok(());
    }

    crate::obf_flow! {{
        // Нет сохранённого токена — не с чем идти на сервер, пропускаем
        // (вход/бан-проверки закрывают этот случай отдельно).
        // Используем match вместо let-else: proc-macro обфускации управляющего
        // потока (goldberg) не парсит синтаксис let-else.
        let settings = crate::config::load_settings();
        let token = match settings.session_token {
            Some(t) => t,
            None => return Ok(()),
        };

        // Не смогли прочитать свой файл — не блокируем игрока из-за этого.
        let sha = match self_sha256() {
            Some(s) => s,
            None => return Ok(()),
        };

        let client = reqwest::Client::new();
        let res = client
            .post(format!("{}/api/launcher/verify", crate::config::api_base()))
            .header("User-Agent", crate::auth::launcher_user_agent())
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "sha256": sha,
            }))
            .send()
            .await;

        match res {
            Ok(r) => {
                // Любой не-2xx (кроме явного отказа ниже) трактуем как сбой
                // сервера → fail-open.
                let body: serde_json::Value = r.json().await.unwrap_or_default();
                let ok = body["ok"].as_bool().unwrap_or(true);
                // Сразу берём owned String, чтобы не держать borrow от `body`:
                // proc-macro обфускации (goldberg) переставляет statements, и
                // заимствование временного значения роняет сборку (E0716).
                let reason: String = body["reason"]
                    .as_str()
                    .unwrap_or(
                        "Файл лаунчера изменён и не совпадает с официальной сборкой. Переустановите лаунчер с сайта.",
                    )
                    .to_string();
                if ok {
                    Ok(())
                } else {
                    Err(reason)
                }
            }
            // Сеть недоступна — не блокируем (как verify_session/HWID-проверка).
            Err(_) => Ok(()),
        }
    }}
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestFile {
    /// Относительный путь файла внутри каталога установки,
    /// например "clients/PolitEmpire/mods/create.jar"
    pub path: String,
    /// SHA-1 файла (алгоритм хеширования GML)
    pub hash: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub build_version: String,
    pub files: Vec<ManifestFile>,
    /// Каталоги, которые лаунчер контролирует полностью (лишние файлы удаляются)
    pub managed_dirs: Vec<String>,
}

/// Считает SHA-1 файла (совместимо с хешами Gml.Web.Api).
pub fn hash_file(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| format!("Не удалось прочитать {}: {e}", path.display()))?;
    let mut hasher = Sha1::new();
    hasher.update(&data);
    Ok(hex::encode(hasher.finalize()))
}

/// Сравнивает локальные файлы с манифестом.
/// Возвращает список файлов, которые нужно скачать заново.
pub fn diff_manifest(game_dir: &Path, manifest: &Manifest) -> Vec<ManifestFile> {
    let mut to_download = Vec::new();
    for entry in &manifest.files {
        let local = game_dir.join(&entry.path);
        let needs = match fs::metadata(&local) {
            Err(_) => true, // файла нет
            Ok(meta) => {
                if entry.path.ends_with("version_manifest_v2.json") {
                    false // Файл от Mojang постоянно обновляется, его хеш и размер меняются
                } else if meta.len() != entry.size {
                    true
                } else {
                    match hash_file(&local) {
                        Ok(h) => !h.eq_ignore_ascii_case(&entry.hash),
                        Err(_) => true,
                    }
                }
            }
        };
        if needs {
            to_download.push(entry.clone());
        }
    }
    to_download
}

/// Результат зачистки контролируемых каталогов.
#[derive(Debug, Default)]
pub struct UnmanagedSweep {
    /// Успешно удалённые посторонние файлы (пути относительно каталога игры).
    pub removed: Vec<String>,
    /// Посторонние файлы, которые удалить НЕ удалось. Раньше такие ошибки
    /// молча проглатывались — файл оставался на диске, и игра его загружала.
    /// Неудаляемый файл в mods/ почти всегда означает, что он занят процессом
    /// игры (Windows блокирует загруженные jar) или защищён специально, поэтому
    /// вызывающий код обязан реагировать, а не игнорировать.
    pub locked: Vec<String>,
}

/// Удаляет посторонние файлы из контролируемых каталогов (например, читы в mods/).
pub fn remove_unmanaged_files(game_dir: &Path, manifest: &Manifest) -> UnmanagedSweep {
    // Разрешённые пути в нижнем регистре: файловая система Windows
    // регистронезависима, поэтому сравнение тоже должно быть без учёта
    // регистра — иначе managed-файл с иным регистром ошибочно считался бы
    // лишним (или наоборот).
    let allowed: std::collections::HashSet<String> = manifest
        .files
        .iter()
        .map(|f| f.path.replace('\\', "/").to_lowercase())
        .collect();
    let mut sweep = UnmanagedSweep::default();

    for dir in &manifest.managed_dirs {
        let abs_dir = game_dir.join(dir);
        if !abs_dir.exists() {
            continue;
        }
        walk_files(&abs_dir, &mut |file_path| {
            if let Ok(rel) = file_path.strip_prefix(game_dir) {
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                if !allowed.contains(&rel_str.to_lowercase()) {
                    if fs::remove_file(file_path).is_ok() {
                        sweep.removed.push(rel_str);
                    } else {
                        sweep.locked.push(rel_str);
                    }
                }
            }
        });
    }
    sweep
}

fn walk_files(dir: &Path, cb: &mut dyn FnMut(&Path)) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk_files(&path, cb);
            } else {
                cb(&path);
            }
        }
    }
}
