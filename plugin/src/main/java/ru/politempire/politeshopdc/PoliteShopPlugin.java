package ru.politempire.politeshopdc;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * PoliteShopDC — маленький плагин-мост между сайтом донат-магазина и
 * PlaceholderAPI. Даёт плейсхолдер %donatecoin% с балансом DC игрока.
 *
 * Работает на гибридных серверах (Mohist/Arclight/Banner и т.п.) рядом с
 * NeoForge-модом магазина, а также на чистом Paper/Spigot.
 */
public final class PoliteShopPlugin extends JavaPlugin {
    private BalanceService service;
    private String loadingText = "...";

    @Override
    public void onEnable() {
        saveDefaultConfig();
        reloadFromConfig();

        if (Bukkit.getPluginManager().getPlugin("PlaceholderAPI") == null) {
            getLogger().severe("PlaceholderAPI не найден — плагин бесполезен, отключаюсь.");
            Bukkit.getPluginManager().disablePlugin(this);
            return;
        }

        new DcExpansion(this, service).register();

        if (!service.isConfigured()) {
            getLogger().warning("Не заданы site-url и/или mod-admin-key в config.yml — "
                    + "%donatecoin% будет показывать '" + loadingText + "'. Заполни конфиг и /papi reload.");
        }

        int period = Math.max(5, getConfig().getInt("refresh-seconds", 15)) * 20;
        // Периодически обновляем балансы всех онлайн-игроков (в асинхронном потоке).
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, () -> {
            for (Player p : Bukkit.getOnlinePlayers()) {
                service.refresh(p.getName());
            }
        }, 40L, period);

        getLogger().info("PoliteShopDC включён. Плейсхолдер: %donatecoin%");
    }

    private void reloadFromConfig() {
        String site = getConfig().getString("site-url", "");
        String key = getConfig().getString("mod-admin-key", "");
        this.loadingText = getConfig().getString("placeholder-loading", "...");
        if (service == null) {
            service = new BalanceService(site, key);
        } else {
            service.update(site, key);
        }
    }

    /** Запрос на фоновое обновление баланса конкретного игрока. */
    public void requestRefresh(String nick) {
        if (service == null || !service.isConfigured()) return;
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> service.refresh(nick));
    }

    public String getLoadingText() {
        return loadingText;
    }
}
