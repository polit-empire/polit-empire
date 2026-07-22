package ru.politempire.botlink;

import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;

/**
 * Экспансия PlaceholderAPI: %botlink_playtime% и %botlink_dc%
 *
 * Поддерживаемые плейсхолдеры:
 *   %botlink_playtime%             — "1ч 23м" (человеко-читаемый формат)
 *   %botlink_playtime_seconds%     — 5025 (секунды, для числовых операций)
 *   %botlink_playtime_formatted%   — синоним %botlink_playtime%
 *   %botlink_playtime_hours%       — 1 (только часы)
 *   %botlink_playtime_minutes%     — 23 (только минуты, без учёта часов)
 *   %botlink_playtime_total_minutes% — 83 (всего минут)
 *   %botlink_dc%                   — 100 (DC-баланс, число)
 *   %botlink_dc_formatted%         — "100 DC"
 *
 * Используется в скорборде, таб-листе, любых плейсхолдерах через PAPI.
 * Данные берутся из кэша PlaytimeManager (обновляется каждые 30 сек),
 * а не напрямую из БД — поэтому плейсхолдер работает мгновенно, без лагов.
 */
public final class PlaytimePlaceholder extends PlaceholderExpansion {

    @Override
    public @NotNull String getIdentifier() {
        return "botlink";
    }

    @Override
    public @NotNull String getAuthor() {
        return "PolitEmpire";
    }

    @Override
    public @NotNull String getVersion() {
        return "1.0.0";
    }

    /** Не нужно регистрировать заново при /papi reload — плагин сам управляет. */
    @Override
    public boolean persist() {
        return true;
    }

    @Override
    public String onPlaceholderRequest(Player player, @NotNull String params) {
        if (player == null) return "";
        PlaytimeManager pm = PlaytimeManager.get();
        if (pm == null) return "";

        // DC-баланс
        if (params.toLowerCase().startsWith("dc")) {
            int dc = pm.getDcBalance(player);
            String lower = params.toLowerCase();
            if (lower.equals("dc")) return String.valueOf(dc);
            if (lower.equals("dc_formatted")) return dc + " DC";
            return "";
        }

        // Наигранное время
        int seconds = pm.getPlaytimeSeconds(player);

        return switch (params.toLowerCase()) {
            case "", "formatted" -> pm.getPlaytimeFormatted(player);
            case "seconds"       -> String.valueOf(seconds);
            case "hours"         -> String.valueOf(seconds / 3600);
            case "minutes"       -> String.valueOf((seconds % 3600) / 60);
            case "total_minutes" -> String.valueOf(seconds / 60);
            default              -> "";
        };
    }
}
