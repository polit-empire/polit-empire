package ru.politempire.botlink;

import me.clip.placeholderapi.PlaceholderAPI;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * PolitEmpireBotLink - связывает Paper-сервер с ботом PolitEmpire:
 * - при входе игрока вызывает /api/player/join (2FA + учёт времени)
 * - блокирует игрока до подтверждения кода командой /2fa
 * - при выходе вызывает /api/player/quit (закрытие игровой сессии)
 * - наигранное время хранится в БД (через bot API), не локально
 * - плейсхолдер %botlink_playtime% для PlaceholderAPI
 * - публичный API PlaytimeManager.get() для других плагинов
 */
public final class BotLinkPlugin extends JavaPlugin {

    private static final LegacyComponentSerializer LEGACY =
            LegacyComponentSerializer.legacyAmpersand();
    private static final int PLAYTIME_TICK_INTERVAL = 600; // 30 сек (20 тиков/сек)

    private ApiClient api;
    private FreezeManager freeze;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        String url = getConfig().getString("api-url", "http://127.0.0.1:8180");
        String secret = getConfig().getString("api-secret", "");
        int timeout = getConfig().getInt("http-timeout-seconds", 5);

        if (secret == null || secret.isEmpty() || secret.equals("CHANGE_ME")) {
            getLogger().severe("api-secret не настроен в config.yml! Плагин отключён.");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        this.api = new ApiClient(url, secret, timeout, getLogger());
        this.freeze = new FreezeManager();

        // Инициализация менеджера наигранного времени (публичный API для других плагинов)
        PlaytimeManager.init(this, api);

        var listener = new PlayerListener(this, api, freeze);
        getServer().getPluginManager().registerEvents(listener, this);

        var cmd2fa = getCommand("2fa");
        if (cmd2fa != null) {
            cmd2fa.setExecutor(new TwoFaCommand(this, api, freeze));
        }

        var cmdPlaytime = getCommand("playtime");
        if (cmdPlaytime != null) {
            cmdPlaytime.setExecutor(new PlaytimeCommand(this));
            cmdPlaytime.setTabCompleter(new PlaytimeCommand(this));
        }

        // Фоновый тик: обновляем кэш плейтайма каждые 30 сек
        getServer().getScheduler().runTaskTimer(this, () -> {
            PlaytimeManager pm = PlaytimeManager.get();
            if (pm != null) pm.tick();
        }, 0L, PLAYTIME_TICK_INTERVAL);

        // Регистрация плейсхолдера PlaceholderAPI (если установлен)
        if (Bukkit.getPluginManager().getPlugin("PlaceholderAPI") != null) {
            new PlaytimePlaceholder().register();
            getLogger().info("PlaceholderAPI найден, плейсхолдер %botlink_playtime% зарегистрирован.");
        } else {
            getLogger().info("PlaceholderAPI не установлен — плейсхолдер %botlink_playtime% недоступен. " +
                    "Поставьте PlaceholderAPI для использования в скорборде/табе.");
        }

        getLogger().info("PolitEmpireBotLink включён. API: " + url);
    }

    @Override
    public void onDisable() {
        // Закрываем сессии всех онлайн-игроков, чтобы бот корректно учёл время
        if (api != null) {
            getServer().getOnlinePlayers().forEach(p -> {
                PlaytimeManager pm = PlaytimeManager.get();
                if (pm != null) pm.onQuit(p);
                api.playerQuit(p.getName());
            });
        }
        getLogger().info("PolitEmpireBotLink выключен.");
    }

    /** Сообщение из config.yml с префиксом и &-цветами. */
    public Component msg(String key, String... replacements) {
        String prefix = getConfig().getString("messages.prefix", "");
        String text = getConfig().getString("messages." + key, key);
        for (int i = 0; i + 1 < replacements.length; i += 2) {
            text = text.replace(replacements[i], replacements[i + 1]);
        }
        return LEGACY.deserialize(prefix + text);
    }
}
