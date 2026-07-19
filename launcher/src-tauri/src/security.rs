use std::path::Path;
use std::sync::OnceLock;

use crate::integrity::{diff_manifest, Manifest};
use crate::obf::{dec_all, enc};

/// Известные инструменты инжекта/отладки/читов, XOR-обфусцированные на этапе
/// компиляции (см. `obf.rs`). В бинарнике эти строки НЕ видны открытым текстом,
/// поэтому их нельзя найти через `strings` и обойти простым переименованием.
/// Проверяются имена запущенных процессов (без учёта регистра).
static BLOCKED_PROCESSES_ENC: &[&[u8]] = &[
    // Инжекторы и мемори-редакторы
    &enc(b"cheatengine"),
    &enc(b"cheat engine"),
    &enc(b"extremeinjector"),
    &enc(b"extreme injector"),
    &enc(b"xenos"),
    &enc(b"xenos64"),
    &enc(b"processhacker"),
    &enc(b"process hacker"),
    &enc(b"artmoney"),
    &enc(b"squalr"),
    &enc(b"winject"),
    &enc(b"gh injector"),
    &enc(b"reclass"),
    &enc(b"reclass.net"),
    &enc(b"scylla"),
    &enc(b"megadumper"),
    &enc(b"megadumper.exe"),
    // Отладчики / реверс
    &enc(b"x64dbg"),
    &enc(b"x32dbg"),
    &enc(b"ollydbg"),
    &enc(b"ida.exe"),
    &enc(b"ida64"),
    &enc(b"ida32"),
    &enc(b"ghidra"),
    &enc(b"dnspy"),
    &enc(b"dnspyex"),
    &enc(b"de4dot"),
    &enc(b"cheat table"),
    &enc(b"hxd"),
    &enc(b"windbg"),
    &enc(b"immunity"),
    // Перехват трафика (кража токенов)
    &enc(b"httpdebugger"),
    &enc(b"fiddler"),
    &enc(b"charles"),
    &enc(b"mitmproxy"),
    &enc(b"burpsuite"),
    &enc(b"wireshark"),
    // Java-специфичные инструменты реверса модов/читов
    &enc(b"jd-gui"),
    &enc(b"recaf"),
    &enc(b"bytecode-viewer"),
    &enc(b"jbytemod"),
    &enc(b"threadtear"),
];

/// Расшифрованный список (кэшируется один раз при первом обращении).
fn blocked_processes() -> &'static [String] {
    static CACHE: OnceLock<Vec<String>> = OnceLock::new();
    CACHE.get_or_init(|| dec_all(BLOCKED_PROCESSES_ENC))
}

/// Возвращает имена всех запущенных процессов-читов/инжекторов/снифферов.
/// Замена старому scan_for_injectors: возвращает ВСЕ совпадения, а не первое.
pub fn scan_running_cheats() -> Vec<String> {
    let blocked = blocked_processes();
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let mut found = Vec::new();
    for process in sys.processes().values() {
        let name = process.name().to_string_lossy().to_lowercase();
        if let Some(hit) = blocked.iter().find(|b| name.contains(b.as_str())) {
            let label = format!("{name} ({hit})");
            if !found.contains(&label) {
                found.push(label);
            }
        }
    }
    found
}

/// Сканирует запущенные процессы. Возвращает имя первого найденного
/// запрещённого инструмента или None. (Используется как предзапусковая проверка.)
pub fn scan_for_injectors() -> Option<String> {
    scan_running_cheats().into_iter().next()
}

/// Финальная сверка целостности непосредственно перед запуском игры.
/// Если после очистки/скачивания какой-то файл сборки всё ещё не совпадает
/// с манифестом (например, его подменили во время загрузки) — запуск запрещается.
pub fn final_integrity_check(game_dir: &Path, manifest: &Manifest) -> Result<(), String> {
    crate::obf_flow! {{
        let mismatched = diff_manifest(game_dir, manifest);
        if let Some(first) = mismatched.first() {
            return Err(format!(
                "Проверка целостности не пройдена: файл {} изменён. Перезапустите синхронизацию.",
                first.path
            ));
        }
        Ok(())
    }}
}

/// Проверяет, что аргументы запуска, полученные от GML, не содержат
/// посторонних javaagent/подключений отладчика, добавленных вручную.
/// -javaagent разрешён только если указывает внутрь каталога установки
/// (GML использует authlib-injector из libraries/custom/).
pub fn validate_launch_args(args: &[String], game_dir: &Path) -> Result<(), String> {
    crate::obf_flow! {{
        let game_dir_norm = game_dir.to_string_lossy().replace('\\', "/").to_lowercase();
        for arg in args {
            let lower = arg.to_lowercase();
            if lower.starts_with("-javaagent:") {
                let path = arg["-javaagent:".len()..]
                    .split('=')
                    .next()
                    .unwrap_or_default()
                    .replace('\\', "/")
                    .to_lowercase();
                let ok = !path.contains("..") && path.starts_with(&game_dir_norm);
                if !ok {
                    return Err("Обнаружен посторонний -javaagent в аргументах запуска.".into());
                }
            }
            if lower.starts_with("-agentlib:")
                || lower.starts_with("-agentpath:")
                || lower.contains("xrunjdwp")
            {
                return Err("Запуск с отладчиком/agent запрещён.".into());
            }
        }
        Ok(())
    }}
}
