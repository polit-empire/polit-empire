package ru.politempire.politeshop.net;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import ru.politempire.politeshop.Config;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;

/**
 * Серверный клиент для команд /dc. Дергает /api/mod/admin/dc с заголовком
 * X-Mod-Key (секрет mod_admin_key из настроек сайта). Меняет DC-баланс в
 * общем журнале, который использует и сайт.
 */
public final class AdminApi {
    private static final Gson GSON = new Gson();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private AdminApi() {}

    /** Результат операции: итоговый баланс или ошибка. */
    public static class Result {
        public final boolean ok;
        public final int balance;
        public final String error;
        Result(boolean ok, int balance, String error) {
            this.ok = ok; this.balance = balance; this.error = error;
        }
    }

    /**
     * Выполнить действие над балансом.
     * @param action give | take | set | get
     * @param nick   ник игрока
     * @param amount количество (для get игнорируется)
     */
    public static CompletableFuture<Result> dc(String action, String nick, long amount, String reason) {
        JsonObject body = new JsonObject();
        body.addProperty("action", action);
        body.addProperty("nick", nick);
        if (!"get".equals(action)) body.addProperty("amount", amount);
        if (reason != null && !reason.isBlank()) body.addProperty("reason", reason);

        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(Config.siteUrl() + "/api/mod/admin/dc"))
                .timeout(Duration.ofSeconds(15))
                .header("Content-Type", "application/json")
                .header("X-Mod-Key", Config.adminKey())
                .header("Accept", "application/json")
                .header("User-Agent", "PoliteShopMod")
                .POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(body), StandardCharsets.UTF_8))
                .build();

        return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .thenApply(r -> {
                    try {
                        JsonObject o = JsonParser.parseString(r.body()).getAsJsonObject();
                        if (r.statusCode() >= 200 && r.statusCode() < 300 && o.has("ok")) {
                            return new Result(true, o.has("balance") ? o.get("balance").getAsInt() : 0, null);
                        }
                        String err = o.has("error") ? o.get("error").getAsString() : ("Ошибка " + r.statusCode());
                        return new Result(false, 0, err);
                    } catch (Exception e) {
                        return new Result(false, 0, "Некорректный ответ сайта");
                    }
                })
                .exceptionally(t -> new Result(false, 0, "Сайт недоступен: " + t.getMessage()));
    }
}
