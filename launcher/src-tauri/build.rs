use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    // Встраиваем античит-DLL прямо в бинарник лаунчера (include_bytes! в
    // inject.rs читает OUT_DIR/pe_anticheat.dll). Так отдельного файла в
    // папке установки нет — DLL распаковывается в скрытый каталог только
    // на время игры. Здесь просто копируем собранную DLL в OUT_DIR, а если
    // её нет (Linux/CI/dev без сборки) — кладём пустой плейсхолдер, чтобы
    // include_bytes! всегда компилировался.
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let dst = out_dir.join("pe_anticheat.dll");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let candidates = [
        manifest_dir.join("anticheat").join("pe_anticheat.dll"),
        manifest_dir
            .join("anticheat-dll")
            .join("target")
            .join("release")
            .join("pe_anticheat.dll"),
    ];

    let src = candidates.iter().find(|p| p.exists());
    match src {
        Some(path) => {
            // Вместо простого копирования, читаем DLL и шифруем её (XOR),
            // чтобы в бинарнике лаунчера не было MZ/PE заголовков и её
            // нельзя было вытащить простым сканированием памяти или бинарника.
            if let Ok(mut data) = fs::read(path) {
                for (i, byte) in data.iter_mut().enumerate() {
                    *byte ^= (0x42_u8).wrapping_add(i as u8); // Простой XOR с плавающим ключом
                }
                fs::write(&dst, &data).expect("failed to write encrypted anticheat dll");
            }
            println!("cargo:rerun-if-changed={}", path.display());
        }
        None => {
            // Плейсхолдер: пустой файл => в рантайме defense пропускается.
            fs::write(&dst, []).expect("failed to write placeholder anticheat dll");
        }
    }
    println!("cargo:rerun-if-changed=anticheat/pe_anticheat.dll");

    // Встраиваем authlib-injector.jar в бинарник (include_bytes! в launcher.rs
    // читает OUT_DIR/authlib-injector.jar). GML не всегда кладёт этот агент в
    // аргументы/файлы клиента, из-за чего игра шла на настоящий Mojang и
    // получала «недействительная сессия». Теперь лаунчер сам распаковывает jar
    // и добавляет -javaagent при запуске.
    let authlib_dst = out_dir.join("authlib-injector.jar");
    let authlib_src = manifest_dir.join("authlib-injector.jar");
    if authlib_src.exists() {
        fs::copy(&authlib_src, &authlib_dst)
            .expect("failed to copy authlib-injector.jar into OUT_DIR");
        println!("cargo:rerun-if-changed={}", authlib_src.display());
    } else {
        // Плейсхолдер: пустой файл => в рантайме javaagent не добавляется.
        fs::write(&authlib_dst, []).expect("failed to write placeholder authlib-injector.jar");
    }
    println!("cargo:rerun-if-changed=authlib-injector.jar");

    tauri_build::build()
}
