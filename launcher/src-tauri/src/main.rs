// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod antitamper;
mod auth;
mod config;
mod discord_rpc;
mod inject;
mod integrity;
mod launcher;
mod news;
mod obf;
mod security;
mod skins;
mod stats;
mod telemetry;
mod update;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// Показывает главное окно лаунчера (из трея).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Защита лаунчера от отладки/подмены: фоновый сторож ловит
            // подключение отладчика к лаунчеру и запуск инжекторов во время игры.
            antitamper::spawn_guard();

            // Фоновый heartbeat: сообщает сайту, что лаунчер запущен, и статус
            // (idle/playing). Работает после авторизации, ошибки игнорируются.
            telemetry::spawn_heartbeat();

            // Выбор хоста сайта: сначала прямой politempire.ru, при неудаче —
            // резервный politempire.org (Cloudflare). Результат запоминается на
            // сессию и используется всеми запросами через api_base().
            tauri::async_runtime::spawn(config::resolve_api_host());

            // Discord Rich Presence. Если Discord закрыт или IPC недоступен,
            // ошибка полностью игнорируется и не влияет на работу лаунчера.
            discord_rpc::set_launcher();

            // Иконка в трее: во время игры лаунчер сворачивается в трей,
            // отсюда его можно развернуть обратно или полностью закрыть.
            let open_item = MenuItem::with_id(app, "open", "Открыть лаунчер", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().expect("no default icon").clone())
                .tooltip("Polit Empire Launcher")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => {
                        let _ = launcher::kill_game();
                        discord_rpc::shutdown();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Клик левой кнопкой по иконке — развернуть лаунчер
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::login,
            auth::verify_session,
            auth::logout,
            config::get_settings,
            config::save_settings,
            config::open_in_explorer,
            config::pick_java_file,
            config::pick_folder,
            launcher::sync_and_launch,
            launcher::get_sync_progress,
            launcher::cancel_sync,
            launcher::get_optional_mods,
            launcher::set_optional_mods,
            launcher::kill_game,
            launcher::is_game_running,
            news::get_news,
            update::check_launcher_update,
            update::apply_launcher_update,
            update::get_update_progress,
            skins::upload_skin,
            skins::delete_skin,
            skins::get_skin_url,
            stats::get_playtime_stats,
            stats::get_player_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Polit Empire Launcher");
}
