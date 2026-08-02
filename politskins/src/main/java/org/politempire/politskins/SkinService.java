package org.politempire.politskins;

import com.destroystokyo.paper.profile.PlayerProfile;
import com.destroystokyo.paper.profile.ProfileProperty;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Level;

/**
 * Скачивает PNG скина с сайта, подписывает его через MineSkin и отдаёт готовое
 * свойство textures для профиля игрока.
 *
 * ГЛАВНОЕ ОТЛИЧИЕ ОТ ВЕРСИИ 1.0
 *
 * Раньше плагин лез в сеть на каждый вход каждого игрока. Сейчас на сервере
 * работает authlib-injector: он забирает скины прямо из GML, уже подписанные.
 * Поэтому в штатной ситуации плагину делать нечего, и он не делает ничего —
 * ни одного HTTP-запроса. Он вмешивается только когда authlib текстуру не
 * проставил (см. fallback-only в config.yml).
 *
 * КЭШ
 *
 * Дорогая операция здесь — подпись в MineSkin (секунды, лимиты, 429), а не
 * скачивание PNG со своего же сайта (десяток килобайт). Поэтому кэшируется
 * именно подпись, а ключ кэша — SHA-256 самого PNG. Поменял игрок скин —
 * поменялся хэш, кэш промахнулся сам собой, инвалидировать вручную не нужно.
 *
 * ПОТОКИ
 *
 * Все методы вызываются из AsyncPlayerPreLoginEvent, то есть уже вне основного
 * потока и параллельно для разных игроков. Общее состояние — только
 * ConcurrentHashMap и счётчики.
 */
public final class SkinService {

    /** Публичный эндпоинт подписи текстур. */
    private static final String MINESKIN_ENDPOINT = "https://api.mineskin.org/generate/upload";

    /** Граница multipart-тела. Фиксированная: тело мы собираем сами. */
    private static final String BOUNDARY = "----PolitSkinsBoundary7d91f2";

    private final PolitSkinsPlugin plugin;

    /** Подписи в памяти: hash PNG -> текстура. Переживает только рестарт JVM. */
    private final Map<String, Texture> memoryCache = new ConcurrentHashMap<>();

    // Счётчики для /politskins status — по ним видно, работает ли фолбэк-режим
    // так, как задумано (skipped должен быть на порядки больше applied).
    private final AtomicLong skipped = new AtomicLong();
    private final AtomicLong applied = new AtomicLong();
    private final AtomicLong cacheHits = new AtomicLong();
    private final AtomicLong mineskinCalls = new AtomicLong();
    private final AtomicLong failures = new AtomicLong();

    private HttpClient http;
    private Path cacheDir;

    private String skinUrl;
    private boolean fallbackOnly;
    private String mineskinKey;
    private long cacheMillis;
    private Duration timeout;
    private boolean alwaysRefresh;

    public SkinService(PolitSkinsPlugin plugin) {
        this.plugin = plugin;
    }

    /** Подписанная текстура: то, что уходит в профиль игрока. */
    public record Texture(String value, String signature) {}

    /**
     * Перечитывает config.yml. Вызывается при старте и по /politskins reload.
     * HttpClient пересоздаётся, потому что таймаут задаётся при сборке клиента.
     */
    public void reload() {
        plugin.reloadConfig();
        var cfg = plugin.getConfig();

        this.skinUrl = cfg.getString("skin-url", "https://politempire.ru/api/skins/{userName}.png");
        this.fallbackOnly = cfg.getBoolean("fallback-only", true);
        this.mineskinKey = cfg.getString("mineskin.api-key", "").trim();
        this.alwaysRefresh = cfg.getBoolean("always-refresh-on-join", false);

        long days = Math.max(1, cfg.getLong("cache-days", 30));
        this.cacheMillis = days * 24L * 60L * 60L * 1000L;

        long seconds = Math.max(3, cfg.getLong("http-timeout-seconds", 10));
        this.timeout = Duration.ofSeconds(seconds);

        this.http = HttpClient.newBuilder()
                .connectTimeout(timeout)
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();

        this.cacheDir = plugin.getDataFolder().toPath().resolve("cache");
        try {
            Files.createDirectories(cacheDir);
        } catch (IOException e) {
            plugin.getLogger().log(Level.WARNING, "Не удалось создать каталог кэша " + cacheDir, e);
        }

        if (mineskinKey.isEmpty()) {
            plugin.getLogger().info("MineSkin работает без ключа: подпись идёт по публичному лимиту "
                    + "и иногда отбивается 429. В фолбэк-режиме обращений мало, но ключ лучше завести.");
        }
    }

    public boolean isFallbackOnly() {
        return fallbackOnly;
    }

    public String stats() {
        return "пропущено (текстура уже была): " + skipped.get()
                + ", проставлено: " + applied.get()
                + ", попаданий в кэш: " + cacheHits.get()
                + ", запросов в MineSkin: " + mineskinCalls.get()
                + ", ошибок: " + failures.get();
    }

    /**
     * Основная точка входа. Вызывается из AsyncPlayerPreLoginEvent — то есть до
     * того, как игрок вошёл, поэтому профиль можно менять обычным API, без NMS
     * и без пересылки пакетов респавна.
     *
     * @return true, если текстура была проставлена этим плагином
     */
    public boolean applyToProfile(PlayerProfile profile, String userName) {
        // Быстрый выход: authlib уже всё сделал. Ни одного запроса в сеть.
        if (fallbackOnly && profile.hasProperty("textures")) {
            skipped.incrementAndGet();
            return false;
        }

        try {
            byte[] png = downloadSkin(userName);
            if (png == null) {
                return false;
            }

            String hash = sha256(png);
            Texture texture = alwaysRefresh ? null : lookupCache(hash);

            if (texture != null) {
                cacheHits.incrementAndGet();
            } else {
                texture = signViaMineSkin(png, userName);
                if (texture == null) {
                    failures.incrementAndGet();
                    return false;
                }
                storeCache(hash, texture);
            }

            // Старое свойство снимаем явно: если fallback-only выключен, оно
            // может быть на месте, а два textures в профиле клиент не поймёт.
            profile.removeProperty("textures");
            profile.setProperty(new ProfileProperty("textures", texture.value(), texture.signature()));
            applied.incrementAndGet();
            return true;

        } catch (Exception e) {
            // Вход игрока важнее скина: любую ошибку гасим здесь, чтобы
            // AsyncPlayerPreLoginEvent не отвалился и игрока не выкинуло.
            failures.incrementAndGet();
            plugin.getLogger().log(Level.WARNING, "Не удалось проставить скин игроку " + userName, e);
            return false;
        }
    }

    /**
     * Готовит подпись заранее, в обход кэша: /politskins refresh.
     *
     * Переодеть уже вошедшего игрока без NMS нельзя, поэтому смысл команды —
     * не «сменить скин прямо сейчас», а «положить свежую подпись в кэш», чтобы
     * следующий вход сработал мгновенно и с новым скином.
     *
     * Вызывается из асинхронного планировщика, не из основного потока.
     */
    public boolean prewarm(String userName) {
        try {
            byte[] png = downloadSkin(userName);
            if (png == null) {
                return false;
            }
            Texture texture = signViaMineSkin(png, userName);
            if (texture == null) {
                failures.incrementAndGet();
                return false;
            }
            storeCache(sha256(png), texture);
            return true;
        } catch (Exception e) {
            failures.incrementAndGet();
            plugin.getLogger().log(Level.WARNING, "Не удалось обновить скин игрока " + userName, e);
            return false;
        }
    }

    /** Скачивает PNG скина с сайта. null — скина нет либо сайт недоступен. */
    private byte[] downloadSkin(String userName) throws IOException, InterruptedException {
        String url = skinUrl.replace("{userName}", userName);

        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(timeout)
                .header("User-Agent", "PolitSkins/" + plugin.getPluginMeta().getVersion())
                .GET()
                .build();

        HttpResponse<byte[]> response = http.send(request, HttpResponse.BodyHandlers.ofByteArray());
        int code = response.statusCode();

        // 204 — «скина нет», штатный ответ нашего API, а не сбой.
        if (code == 204 || code == 404) {
            return null;
        }
        if (code != 200) {
            plugin.getLogger().warning("Скин " + userName + ": сайт ответил HTTP " + code);
            return null;
        }

        byte[] body = response.body();
        // PNG начинается с \x89PNG. Проверяем сигнатуру: если Cloudflare или
        // nginx подсунули HTML-страницу, MineSkin вернёт невнятную ошибку, а
        // так причина будет видна сразу.
        if (body.length < 8 || body[0] != (byte) 0x89 || body[1] != 'P' || body[2] != 'N' || body[3] != 'G') {
            plugin.getLogger().warning("Скин " + userName + ": вместо PNG пришло "
                    + body.length + " байт не-PNG (проверь skin-url и Cloudflare)");
            return null;
        }
        return body;
    }

    /** Подписывает PNG в MineSkin. null — не получилось. */
    private Texture signViaMineSkin(byte[] png, String userName) throws IOException, InterruptedException {
        mineskinCalls.incrementAndGet();

        byte[] body = buildMultipart(png, userName);

        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(MINESKIN_ENDPOINT))
                .timeout(timeout)
                .header("Content-Type", "multipart/form-data; boundary=" + BOUNDARY)
                .header("User-Agent", "PolitSkins/" + plugin.getPluginMeta().getVersion())
                .POST(HttpRequest.BodyPublishers.ofByteArray(body));

        if (!mineskinKey.isEmpty()) {
            builder.header("Authorization", "Bearer " + mineskinKey);
        }

        HttpResponse<String> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() == 429) {
            plugin.getLogger().warning("MineSkin: лимит запросов (429). Заведи ключ в config.yml -> mineskin.api-key");
            return null;
        }
        if (response.statusCode() != 200) {
            plugin.getLogger().warning("MineSkin ответил HTTP " + response.statusCode()
                    + ": " + truncate(response.body()));
            return null;
        }

        JsonObject json = JsonParser.parseString(response.body()).getAsJsonObject();
        if (!json.has("data")) {
            plugin.getLogger().warning("MineSkin: в ответе нет data: " + truncate(response.body()));
            return null;
        }
        JsonObject texture = json.getAsJsonObject("data").getAsJsonObject("texture");
        String value = texture.get("value").getAsString();
        String signature = texture.get("signature").getAsString();
        return new Texture(value, signature);
    }

    /**
     * Собирает multipart-тело руками: в java.net.http своего билдера нет, а
     * тащить ради одного запроса ещё одну библиотеку незачем.
     */
    private byte[] buildMultipart(byte[] png, String userName) throws IOException {
        var out = new ByteArrayOutputStream();
        String dash = "--" + BOUNDARY + "\r\n";

        out.write(dash.getBytes(StandardCharsets.UTF_8));
        out.write(("Content-Disposition: form-data; name=\"file\"; filename=\"skin.png\"\r\n"
                + "Content-Type: image/png\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(png);
        out.write("\r\n".getBytes(StandardCharsets.UTF_8));

        out.write(dash.getBytes(StandardCharsets.UTF_8));
        out.write(("Content-Disposition: form-data; name=\"name\"\r\n\r\n"
                + truncateName(userName) + "\r\n").getBytes(StandardCharsets.UTF_8));

        out.write(dash.getBytes(StandardCharsets.UTF_8));
        out.write(("Content-Disposition: form-data; name=\"visibility\"\r\n\r\n1\r\n")
                .getBytes(StandardCharsets.UTF_8));

        out.write(("--" + BOUNDARY + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return out.toByteArray();
    }

    // ---- кэш -------------------------------------------------------------

    private Texture lookupCache(String hash) {
        Texture inMemory = memoryCache.get(hash);
        if (inMemory != null) {
            return inMemory;
        }

        Path file = cacheDir.resolve(hash + ".json");
        if (!Files.isRegularFile(file)) {
            return null;
        }

        try {
            JsonObject json = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
            long savedAt = json.get("savedAt").getAsLong();
            if (System.currentTimeMillis() - savedAt > cacheMillis) {
                Files.deleteIfExists(file);
                return null;
            }
            Texture texture = new Texture(json.get("value").getAsString(), json.get("signature").getAsString());
            memoryCache.put(hash, texture);
            return texture;
        } catch (Exception e) {
            // Битый файл кэша — не повод ронять вход: удаляем и подпишем заново.
            try {
                Files.deleteIfExists(file);
            } catch (IOException ignored) {
                // удалить не вышло — перезапишется при следующей подписи
            }
            return null;
        }
    }

    private void storeCache(String hash, Texture texture) {
        memoryCache.put(hash, texture);

        JsonObject json = new JsonObject();
        json.addProperty("value", texture.value());
        json.addProperty("signature", texture.signature());
        json.addProperty("savedAt", System.currentTimeMillis());

        try {
            Files.writeString(cacheDir.resolve(hash + ".json"), json.toString());
        } catch (IOException e) {
            plugin.getLogger().log(Level.WARNING, "Не удалось записать кэш " + hash, e);
        }
    }

    /** Чистит кэш целиком. @return сколько файлов удалено */
    public int clearCache() {
        memoryCache.clear();
        int removed = 0;
        try (var files = Files.list(cacheDir)) {
            for (Path file : files.toList()) {
                if (Files.deleteIfExists(file)) {
                    removed++;
                }
            }
        } catch (IOException e) {
            plugin.getLogger().log(Level.WARNING, "Не удалось очистить кэш", e);
        }
        return removed;
    }

    // ---- мелочь ----------------------------------------------------------

    private static String sha256(byte[] data) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
    }

    /** MineSkin отбивает имена длиннее 24 символов. */
    private static String truncateName(String name) {
        return name.length() <= 24 ? name : name.substring(0, 24);
    }

    private static String truncate(String text) {
        if (text == null) {
            return "";
        }
        return text.length() <= 200 ? text : text.substring(0, 200) + "...";
    }
}
