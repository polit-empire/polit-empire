package ru.politempire.politeshopdc;

import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import org.bukkit.OfflinePlayer;
import org.jetbrains.annotations.NotNull;

/**
 * Расширение PlaceholderAPI. Регистрирует плейсхолдеры:
 *   %donatecoin%        — баланс DC игрока (число), например 1250
 *   %donatecoin_raw%    — то же самое (алиас)
 * Значение берётся из кэша {@link BalanceService}, наполняемого асинхронно.
 */
public final class DcExpansion extends PlaceholderExpansion {
    private final PoliteShopPlugin plugin;
    private final BalanceService service;

    public DcExpansion(PoliteShopPlugin plugin, BalanceService service) {
        this.plugin = plugin;
        this.service = service;
    }

    @Override
    public @NotNull String getIdentifier() {
        return "donatecoin";
    }

    @Override
    public @NotNull String getAuthor() {
        return "PolitEmpire";
    }

    @Override
    public @NotNull String getVersion() {
        return plugin.getDescription().getVersion();
    }

    /** Оставаться зарегистрированным при /papi reload. */
    @Override
    public boolean persist() {
        return true;
    }

    @Override
    public String onRequest(OfflinePlayer player, @NotNull String params) {
        if (player == null || player.getName() == null) return "";
        long balance = service.getCached(player.getName());
        if (balance < 0) {
            // Баланс ещё не подгрузился — просим сервис обновить в фоне.
            plugin.requestRefresh(player.getName());
            return plugin.getLoadingText();
        }
        return String.valueOf(balance);
    }
}
