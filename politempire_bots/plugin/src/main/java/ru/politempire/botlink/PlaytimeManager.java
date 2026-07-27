package ru.politempire.botlink;

import org.bukkit.entity.Player;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.List;
import java.util.ArrayList;
import java.util.Collections;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.logging.Logger;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;

/**
 * Учёт наигранного времени через bot API (бот хранит в MySQL, не локально).
 *
 * Поток данных:
 * 1. Игрок входит → PlaytimeManager记录ает время старта сессии (в памяти).
 * 2. Каждые 30 сек → фоновый тик добавляет накопленное время через
 *    POST /api/player/quit+join (close+reopen session в боте).
 * 3. При запросе плейсхолдера/API → берёт из кэша (обновляется фоновым тиком).
 * 4. Игрок выходит → POST /api/player/quit закрывает сессию, бот фиксирует время.
 *
 * Хранение: только в БД (через bot API). На диске сервера НИЧЕГО не сохраняется.
 *
 * Публичный API для других плагинов:
 *   PlaytimeManager.get(plugin).getPlaytimeSeconds(player)  — int, из кэша
 *   PlaytimeManager.get(plugin).getPlaytimeFormatted(player) — "1ч 23м"
 *   PlaytimeManager.get(plugin).fetchPlaytimeAsync(player)   — CompletableFuture<Integer>
 */
public final class PlaytimeManager {

    private static PlaytimeManager instance;

    private final BotLinkPlugin plugin;
    private final ApiClient api;
    private final HttpClient http;
    private final Logger log;
    private final String baseUrl;
    private final String secret;

    /** Локальное время старта сессии по UUID (для расчёта времени до первой успешной синхронизации). */
    private final Map<UUID, Long> sessionStart = new ConcurrentHashMap<>();

    /** Время последнего успешного ответа от bot API (System.currentTimeMillis()). */
    private final Map<String, Long> lastFetchTime = new ConcurrentHashMap<>();

    /** Кэш наигранного времени (секунды) по нику игрока. */
    private final Map<String, Integer> playtimeCache = new ConcurrentHashMap<>();

    /** Кэш топа по времени. Обновляется раз в минуту. */
    private final List<TopEntry> topPlaytime = new CopyOnWriteArrayList<>();
    private long lastTopFetchTime = 0L;

    /** Кэш DC-баланса по нику игрока. */
    private final Map<String, Integer> dcCache = new ConcurrentHashMap<>();

    public static class TopEntry {
        public final String username;
        public final int seconds;
        public TopEntry(String username, int seconds) {
            this.username = username;
            this.seconds = seconds;
        }
    }

    private PlaytimeManager(BotLinkPlugin plugin, ApiClient api) {
        this.plugin = plugin;
        this.api = api;
        this.log = plugin.getLogger();
        String url = plugin.getConfig().getString("api-url", "http://127.0.0.1:8180");
        this.baseUrl = url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
        this.secret = plugin.getConfig().getString("api-secret", "");
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    /** Инициализация синглтона. Вызывается из BotLinkPlugin.onEnable(). */
    static void init(BotLinkPlugin plugin, ApiClient api) {
        instance = new PlaytimeManager(plugin, api);
    }

    /**
     * Получить экземпляр PlaytimeManager для использования из других плагинов.
     * @return синглтон, или null если BotLink не загружен.
     */
    public static PlaytimeManager get() {
        return instance;
    }

    // ---- Управление сессиями ----

    /** Вызывается при входе игрока (из PlayerListener). */
    void onJoin(Player player) {
        sessionStart.put(player.getUniqueId(), System.currentTimeMillis());
        // Сразу тянем актуальный плейтайм и DC с бота
        fetchPlaytimeAsync(player.getName()).thenAccept(secs -> {
            if (secs >= 0) {
                plugin.getServer().getScheduler().runTask(plugin, () -> {
                    playtimeCache.put(player.getName(), secs);
                    lastFetchTime.put(player.getName(), System.currentTimeMillis());
                });
            }
        });
        fetchBalanceAsync(player.getName()).thenAccept(dc -> {
            if (dc >= 0) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                        dcCache.put(player.getName(), dc));
            }
        });
    }

    /** Вызывается при выходе игрока (из PlayerListener). */
    void onQuit(Player player) {
        sessionStart.remove(player.getUniqueId());
        playtimeCache.remove(player.getName());
        lastFetchTime.remove(player.getName());
        dcCache.remove(player.getName());
    }

    /** Фоновый тик: каждые 30 сек обновляет кэш для онлайн-игроков. */
    void tick() {
        for (Player p : plugin.getServer().getOnlinePlayers()) {
            fetchPlaytimeAsync(p.getName()).thenAccept(secs -> {
                if (secs >= 0) {
                    plugin.getServer().getScheduler().runTask(plugin, () -> {
                        playtimeCache.put(p.getName(), secs);
                        lastFetchTime.put(p.getName(), System.currentTimeMillis());
                    });
                }
            });
            fetchBalanceAsync(p.getName()).thenAccept(dc -> {
                if (dc >= 0) {
                    plugin.getServer().getScheduler().runTask(plugin, () ->
                            dcCache.put(p.getName(), dc));
                }
            });
        }
        
        // Обновляем топ раз в минуту
        if (System.currentTimeMillis() - lastTopFetchTime > 60_000L) {
            lastTopFetchTime = System.currentTimeMillis();
            fetchTopPlaytimeAsync(10).thenAccept(top -> {
                if (top != null) {
                    plugin.getServer().getScheduler().runTask(plugin, () -> {
                        topPlaytime.clear();
                        topPlaytime.addAll(top);
                    });
                }
            });
        }
    }

    // ---- Публичный API для других плагинов ----

    /**
     * Наигранное время игрока в секундах (из кэша, мгновенно).
     * Если игрок онлайн — включает время текущей сессии с момента последней синхронизации.
     * @return секунд, или 0 если данных нет.
     */
    public int getPlaytimeSeconds(Player player) {
        int cached = playtimeCache.getOrDefault(player.getName(), 0);
        long fetchMs = lastFetchTime.getOrDefault(player.getName(), 0L);
        if (fetchMs > 0) {
            long elapsedSecs = (System.currentTimeMillis() - fetchMs) / 1000;
            if (elapsedSecs > 0) {
                cached += (int) elapsedSecs;
            }
        } else {
            long sessionMs = sessionStart.getOrDefault(player.getUniqueId(), 0L);
            if (sessionMs > 0) {
                cached += (int) ((System.currentTimeMillis() - sessionMs) / 1000);
            }
        }
        return cached;
    }

    /**
     * Наигранное время игрока в секундах по нику (из кэша).
     * Не включает время текущей сессии (только сохранённое в БД).
     */
    public int getPlaytimeSeconds(String username) {
        return playtimeCache.getOrDefault(username, 0);
    }

    /**
     * Наигранное время в формате "1ч 23м" или "45м" или "30с".
     */
    public String getPlaytimeFormatted(Player player) {
        return formatTime(getPlaytimeSeconds(player));
    }

    public String getPlaytimeFormatted(String username) {
        return formatTime(getPlaytimeSeconds(username));
    }

    /**
     * Асинхронный запрос плейтайма к bot API.
     * @return CompletableFuture<Integer> — секунды (-1 при ошибке).
     */
    public CompletableFuture<Integer> fetchPlaytimeAsync(String username) {
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/api/player/playtime?username=" + urlEncode(username)))
                .timeout(Duration.ofSeconds(5))
                .header("X-Api-Secret", secret)
                .header("Accept", "application/json")
                .GET()
                .build();
        return http.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .handle((resp, err) -> {
                    if (err != null || resp == null || resp.statusCode() != 200) {
                        return -1;
                    }
                    return parsePlaytime(resp.body());
                });
    }

    /**
     * Асинхронный запрос топа плейтайма к bot API.
     * @return CompletableFuture<List<TopEntry>>
     */
    public CompletableFuture<List<TopEntry>> fetchTopPlaytimeAsync(int limit) {
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/api/player/playtime/top?limit=" + limit))
                .timeout(Duration.ofSeconds(5))
                .header("X-Api-Secret", secret)
                .header("Accept", "application/json")
                .GET()
                .build();
        return http.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .handle((resp, err) -> {
                    if (err != null || resp == null || resp.statusCode() != 200) {
                        return null;
                    }
                    return parseTopPlaytime(resp.body());
                });
    }

    /**
     * Получить топ игрока по индексу (от 0).
     * @return TopEntry или null, если такого места нет.
     */
    public TopEntry getTopPlaytime(int index) {
        if (index >= 0 && index < topPlaytime.size()) {
            return topPlaytime.get(index);
        }
        return null;
    }

    // ---- DC-баланс ----

    /**
     * DC-баланс игрока (из кэша, мгновенно).
     * @return баланс DC, или 0 если данных нет.
     */
    public int getDcBalance(Player player) {
        return dcCache.getOrDefault(player.getName(), 0);
    }

    public int getDcBalance(String username) {
        return dcCache.getOrDefault(username, 0);
    }

    /**
     * Асинхронный запрос DC-баланса к bot API.
     * @return CompletableFuture<Integer> — баланс (-1 при ошибке).
     */
    public CompletableFuture<Integer> fetchBalanceAsync(String username) {
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/api/player/balance?username=" + urlEncode(username)))
                .timeout(Duration.ofSeconds(5))
                .header("X-Api-Secret", secret)
                .header("Accept", "application/json")
                .GET()
                .build();
        return http.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .handle((resp, err) -> {
                    if (err != null || resp == null || resp.statusCode() != 200) {
                        return -1;
                    }
                    return parseBalance(resp.body());
                });
    }

    // ---- Утилиты ----

    /** Форматирует секунды в "1ч 23м", "45м", "30с". */
    public static String formatTime(int totalSeconds) {
        if (totalSeconds < 60) return totalSeconds + "с";
        int hours = totalSeconds / 3600;
        int minutes = (totalSeconds % 3600) / 60;
        if (hours > 0) return hours + "ч " + minutes + "м";
        return minutes + "м";
    }

    private static int parsePlaytime(String json) {
        var m = java.util.regex.Pattern
                .compile("\"playtime_seconds\"\\s*:\\s*(\\d+)")
                .matcher(json);
        return m.find() ? Integer.parseInt(m.group(1)) : 0;
    }

    private static List<TopEntry> parseTopPlaytime(String jsonString) {
        try {
            JsonObject json = JsonParser.parseString(jsonString).getAsJsonObject();
            if (json.has("top") && json.get("top").isJsonArray()) {
                JsonArray arr = json.getAsJsonArray("top");
                List<TopEntry> list = new ArrayList<>();
                for (JsonElement e : arr) {
                    JsonObject obj = e.getAsJsonObject();
                    String username = obj.has("username") ? obj.get("username").getAsString() : "Unknown";
                    int secs = obj.has("playtime_seconds") ? obj.get("playtime_seconds").getAsInt() : 0;
                    list.add(new TopEntry(username, secs));
                }
                return list;
            }
        } catch (Exception ignored) { }
        return null;
    }

    private static int parseBalance(String json) {
        var m = java.util.regex.Pattern
                .compile("\"balance\"\\s*:\\s*(-?\\d+)")
                .matcher(json);
        return m.find() ? Integer.parseInt(m.group(1)) : 0;
    }

    private static String urlEncode(String s) {
        return java.net.URLEncoder.encode(s, java.nio.charset.StandardCharsets.UTF_8);
    }
}
