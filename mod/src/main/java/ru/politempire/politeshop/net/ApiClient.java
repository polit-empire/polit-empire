package ru.politempire.politeshop.net;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.Minecraft;
import ru.politempire.politeshop.Config;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;

/**
 * Асинхронный HTTP-клиент мода. Все запросы к сайту идут с заголовком
 * Authorization: Bearer <accessToken> — это токен, который выдал лаунчер
 * (GML) при входе. Сайт проверяет его и определяет игрока. Никакой ручной
 * ввод логина/токена не нужен.
 *
 * ВАЖНО: методы возвращают CompletableFuture и выполняются в фоне. Результат
 * нужно применять в основном потоке игры (Minecraft.getInstance().execute()).
 */
public final class ApiClient {
    private static final Gson GSON = new Gson();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private ApiClient() {}

    /** Токен доступа текущего игрока из лаунчера. */
    private static String accessToken() {
        try {
            return Minecraft.getInstance().getUser().getAccessToken();
        } catch (Throwable t) {
            return "";
        }
    }

    private static HttpRequest.Builder base(String path) {
        return HttpRequest.newBuilder()
                .uri(URI.create(Config.siteUrl() + path))
                .timeout(Duration.ofSeconds(15))
                .header("Authorization", "Bearer " + accessToken())
                .header("Accept", "application/json")
                .header("User-Agent", "PoliteShopMod");
    }

    /** Исключение с человекочитаемым текстом из поля error ответа. */
    public static class ApiException extends RuntimeException {
        public ApiException(String message) { super(message); }
    }

    private static <T> T handle(HttpResponse<String> resp, Class<T> type) {
        String body = resp.body();
        if (resp.statusCode() >= 200 && resp.statusCode() < 300) {
            return GSON.fromJson(body, type);
        }
        // Пытаемся достать поле error из тела.
        String msg = "Ошибка " + resp.statusCode();
        try {
            JsonObject o = JsonParser.parseString(body).getAsJsonObject();
            if (o.has("error")) msg = o.get("error").getAsString();
        } catch (Exception ignored) {}
        throw new ApiException(msg);
    }

    public static CompletableFuture<Dtos.ShopResponse> fetchShop() {
        HttpRequest req = base("/api/mod/shop").GET().build();
        return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .thenApply(r -> handle(r, Dtos.ShopResponse.class));
    }

    public static CompletableFuture<Dtos.BalanceResponse> fetchBalance() {
        HttpRequest req = base("/api/mod/balance").GET().build();
        return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .thenApply(r -> handle(r, Dtos.BalanceResponse.class));
    }

    public static CompletableFuture<Dtos.CartResponse> fetchCart() {
        HttpRequest req = base("/api/mod/cart").GET().build();
        return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .thenApply(r -> handle(r, Dtos.CartResponse.class));
    }

    public static CompletableFuture<Dtos.PurchaseResponse> purchase(int productId) {
        String json = "{\"productId\":" + productId + "}";
        HttpRequest req = base("/api/mod/purchase")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                .build();
        return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .thenApply(r -> {
                    // purchase может вернуть 400 с полем error и balance — но также
                    // легитимный ok:false (requiresPayment). Разбираем вручную.
                    String body = r.body();
                    if (r.statusCode() >= 500) {
                        throw new ApiException("Сервер недоступен (" + r.statusCode() + ")");
                    }
                    Dtos.PurchaseResponse pr = GSON.fromJson(body, Dtos.PurchaseResponse.class);
                    if (pr == null) throw new ApiException("Пустой ответ сервера");
                    return pr;
                });
    }

    public static CompletableFuture<Dtos.ClaimResponse> claim(int orderId) {
        String json = "{\"orderId\":" + orderId + "}";
        HttpRequest req = base("/api/mod/claim")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                .build();
        return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .thenApply(r -> {
                    String body = r.body();
                    if (r.statusCode() >= 500) {
                        Dtos.ClaimResponse cr = GSON.fromJson(body, Dtos.ClaimResponse.class);
                        if (cr != null && cr.error != null) throw new ApiException(cr.error);
                        throw new ApiException("Не удалось выдать (" + r.statusCode() + ")");
                    }
                    Dtos.ClaimResponse cr = GSON.fromJson(body, Dtos.ClaimResponse.class);
                    if (cr == null) throw new ApiException("Пустой ответ сервера");
                    return cr;
                });
    }
}
