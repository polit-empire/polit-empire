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

        String key = params.toLowerCase();
        
        // Топ игроков (например, %botlink_top_playtime_name_1% или %botlink_top_playtime_formatted_1%)
        if (key.startsWith("top_playtime_")) {
            String suffix = key.substring("top_playtime_".length()); // "name_1", "formatted_1", "hours_1"
            int lastUnderscore = suffix.lastIndexOf('_');
            if (lastUnderscore > 0) {
                String field = suffix.substring(0, lastUnderscore); // "name", "formatted", "hours", "seconds"
                try {
                    int rank = Integer.parseInt(suffix.substring(lastUnderscore + 1));
                    if (rank >= 1 && rank <= 50) {
                        PlaytimeManager.TopEntry entry = pm.getTopPlaytime(rank - 1);
                        if (entry == null) return field.equals("name") ? "---" : "0";
                        
                        return switch (field) {
                            case "name" -> entry.username;
                            case "formatted" -> PlaytimeManager.formatTime(entry.seconds);
                            case "seconds" -> String.valueOf(entry.seconds);
                            case "hours" -> String.valueOf(entry.seconds / 3600);
                            case "minutes" -> String.valueOf((entry.seconds % 3600) / 60);
                            default -> "";
                        };
                    }
                } catch (NumberFormatException ignored) {}
            }
        }

        // Убираем префикс "playtime_" если есть, чтобы switch работал и для
        // %botlink_playtime_hours% (params="playtime_hours") и для %botlink_hours% (params="hours")
        if (key.startsWith("playtime_")) {
            key = key.substring("playtime_".length()); // "hours", "seconds", "minutes", ...
        }

        int seconds = pm.getPlaytimeSeconds(player);

        return switch (key) {
            case "playtime", "formatted", "" -> pm.getPlaytimeFormatted(player);
            case "seconds"       -> String.valueOf(seconds);
            case "hours"         -> String.valueOf(seconds / 3600);
            case "minutes"         -> String.valueOf((seconds % 3600) / 60);
            case "total_minutes" -> String.valueOf(seconds / 60);
            default              -> "";
        };
    }
}
