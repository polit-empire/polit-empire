package ru.politempire.politeshopdc;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Кэш DC-балансов и обращение к сайту. Запросы идут в асинхронном потоке
 * (через планировщик Bukkit), а плейсхолдер читает готовое значение из кэша,
 * чтобы не блокировать основной поток сервера.
 */
public final class BalanceService {
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private final Map<String, Long> balances = new ConcurrentHashMap<>();

    private volatile String siteUrl;
    private volatile String adminKey;

    public BalanceService(String siteUrl, String adminKey) {
        update(siteUrl, adminKey);
    }

    public void update(String siteUrl, String adminKey) {
        this.siteUrl = siteUrl == null ? "" : siteUrl.replaceAll("/+$", "");
        this.adminKey = adminKey == null ? "" : adminKey;
    }

    public boolean isConfigured() {
        return !siteUrl.isEmpty() && !adminKey.isEmpty();
    }

    /** Баланс из кэша или -1, если ещё не загружен. */
    public long getCached(String nick) {
        Long v = balances.get(nick.toLowerCase());
        return v == null ? -1 : v;
    }

    public void forget(String nick) {
        balances.remove(nick.toLowerCase());
    }

    /**
     * Синхронный запрос баланса с сайта. Должен вызываться ТОЛЬКО из
     * асинхронного потока. Результат кладётся в кэш.
     */
    public void refresh(String nick) {
        if (!isConfigured()) return;
        try {
            String body = "{\"action\":\"get\",\"nick\":\"" + escape(nick) + "\"}";
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(siteUrl + "/api/mod/admin/dc"))
                    .timeout(Duration.ofSeconds(8))
                    .header("Content-Type", "application/json")
                    .header("X-Mod-Key", adminKey)
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() != 200) return;
            JsonObject json = JsonParser.parseString(res.body()).getAsJsonObject();
            if (json.has("ok") && json.get("ok").getAsBoolean() && json.has("balance")) {
                balances.put(nick.toLowerCase(), json.get("balance").getAsLong());
            }
        } catch (Exception ignored) {
            // Сеть недоступна — оставляем прежнее значение из кэша.
        }
    }

    private static String escape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
