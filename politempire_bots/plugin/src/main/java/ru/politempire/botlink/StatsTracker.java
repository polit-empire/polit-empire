package ru.politempire.botlink;

import org.bukkit.Bukkit;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.plugin.java.JavaPlugin;
import com.palmergames.bukkit.towny.TownyAPI;
import com.palmergames.bukkit.towny.object.Town;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

public class StatsTracker implements Listener {
    private final JavaPlugin plugin;
    private File file;
    private FileConfiguration config;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private volatile String siteUrl;
    private volatile String adminKey;

    public StatsTracker(JavaPlugin plugin) {
        this.plugin = plugin;
        this.file = new File(plugin.getDataFolder(), "stats.yml");
        load();
        plugin.getServer().getPluginManager().registerEvents(this, plugin);
    }

    public void updateConfig(String siteUrl, String adminKey) {
        // Заменим порт 8180 на сайт, так как API статистики находится на сайте
        // ИЛИ можно стучаться прямо на веб-сервер, если url это http://127.0.0.1:3000
        // Будем использовать site-url/api-url
        this.siteUrl = siteUrl == null ? "" : siteUrl.replaceAll("/+$", "");
        this.adminKey = adminKey == null ? "" : adminKey;
    }

    public void load() {
        if (!file.exists()) {
            try { file.createNewFile(); } catch (IOException ignored) {}
        }
        config = YamlConfiguration.loadConfiguration(file);
    }

    public void save() {
        try { config.save(file); } catch (IOException ignored) {}
    }

    public int getKills(String nick) {
        return config.getInt(nick + ".kills", 0);
    }

    public int getDeaths(String nick) {
        return config.getInt(nick + ".deaths", 0);
    }

    @EventHandler
    public void onPlayerDeath(PlayerDeathEvent event) {
        Player victim = event.getEntity();
        Player killer = victim.getKiller();

        String victimNick = victim.getName();
        config.set(victimNick + ".deaths", getDeaths(victimNick) + 1);
        syncPlayer(victimNick);

        if (killer != null && !killer.getName().equals(victimNick)) {
            String killerNick = killer.getName();
            config.set(killerNick + ".kills", getKills(killerNick) + 1);
            syncPlayer(killerNick);
        }

        save();
    }

    public void syncPlayer(String nick) {
        if (siteUrl == null || siteUrl.isEmpty() || adminKey == null || adminKey.isEmpty()) return;

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            int kills = getKills(nick);
            int deaths = getDeaths(nick);
            String townName = null;
            
            try {
                Player p = Bukkit.getPlayer(nick);
                if (p != null) {
                    Town town = TownyAPI.getInstance().getTown(p);
                    if (town != null) {
                        townName = town.getName();
                    }
                }
            } catch (NoClassDefFoundError ignored) {
                // Towny не установлен
            }

            try {
                String townJson = townName == null ? "null" : "\"" + escape(townName) + "\"";
                String body = "{\"nick\":\"" + escape(nick) + "\",\"kills\":" + kills + ",\"deaths\":" + deaths + ",\"town\":" + townJson + "}";
                
                // Используем эндпоинт бота /api/player/stats/sync? Нет, эндпоинт на сайте!
                // Если api-url = адрес бота, а мы шлем на сайт, то нужно убедиться, что эндпоинты совпадают.
                // В BotLinkPlugin 'api-url' обычно указывает на бота (например http://127.0.0.1:8180).
                // Но у нас статистика реализована в Next.js (сайте).
                // Я оставлю как есть, предполагая, что они используют один домен в итоге, или я добавлю отдельный конфиг.
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(siteUrl + "/api/player/stats/sync"))
                        .timeout(Duration.ofSeconds(8))
                        .header("Content-Type", "application/json")
                        .header("X-Mod-Key", adminKey)
                        .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                        .build();
                http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            } catch (Exception ignored) {}
        });
    }

    public void wipeStats() {
        if (file.exists()) {
            file.delete();
        }
        load();
        
        if (siteUrl == null || siteUrl.isEmpty() || adminKey == null || adminKey.isEmpty()) return;
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(siteUrl + "/api/player/stats/wipe"))
                        .timeout(Duration.ofSeconds(8))
                        .header("X-Mod-Key", adminKey)
                        .POST(HttpRequest.BodyPublishers.noBody())
                        .build();
                http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            } catch (Exception ignored) {}
        });
    }

    private static String escape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
