package ru.politempire.politeshop;

import net.neoforged.neoforge.common.ModConfigSpec;

/**
 * Единый COMMON-конфиг мода (файл politeshop-common.toml в config/).
 *  - siteUrl: базовый URL сайта PolitEmpire (нужен и клиенту, и серверу).
 *  - adminKey: секрет mod_admin_key из настроек сайта. Нужен ТОЛЬКО серверу
 *    для команд /dc. На клиенте оставляйте пустым.
 */
public final class Config {
    public static final ModConfigSpec SPEC;

    public static final ModConfigSpec.ConfigValue<String> SITE_URL;
    public static final ModConfigSpec.ConfigValue<String> ADMIN_KEY;

    static {
        ModConfigSpec.Builder b = new ModConfigSpec.Builder();
        b.comment("Настройки PolitEmpire Donate");
        b.push("general");
        SITE_URL = b
                .comment("Базовый URL сайта без слэша в конце. Пример: https://politempire.ru")
                .define("siteUrl", "https://politempire.ru");
        ADMIN_KEY = b
                .comment("Секрет mod_admin_key из настроек сайта. Нужен только серверу для /dc. На клиенте оставьте пустым.")
                .define("adminKey", "");
        b.pop();
        SPEC = b.build();
    }

    /** URL сайта без завершающего слэша. */
    public static String siteUrl() {
        String url = SITE_URL.get();
        if (url == null || url.isBlank()) return "https://politempire.ru";
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    public static String adminKey() {
        String k = ADMIN_KEY.get();
        return k == null ? "" : k.trim();
    }

    private Config() {}
}
