package ru.politempire.politeshop.server;

import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.scores.Objective;
import net.minecraft.world.scores.Scoreboard;
import net.minecraft.world.scores.ScoreAccess;
import net.minecraft.world.scores.criteria.ObjectiveCriteria;
import net.minecraft.network.chat.Component;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import ru.politempire.politeshop.PoliteShopMod;
import ru.politempire.politeshop.net.AdminApi;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Кэш DC-балансов онлайн-игроков на сервере. Используется плейсхолдером
 * %donatecoin% (через scoreboard-objective "donatecoin") и командой /dc.
 * Обновляется при входе игрока и раз в ~10 секунд через admin-API сайта.
 * Требует mod_admin_key в конфиге сервера.
 */
@EventBusSubscriber(modid = PoliteShopMod.MODID)
public final class DcCache {
    private static final Map<String, Integer> BALANCES = new ConcurrentHashMap<>();
    /** Имя scoreboard-цели, которую можно показывать в табе/сайдбаре как %donatecoin%. */
    public static final String OBJECTIVE = "donatecoin";
    private static int tickCounter = 0;

    private DcCache() {}

    /** Текущий баланс из кэша (или -1, если ещё не загружен). */
    public static int get(String nick) {
        return BALANCES.getOrDefault(nick.toLowerCase(), -1);
    }

    public static void put(String nick, int balance) {
        BALANCES.put(nick.toLowerCase(), balance);
    }

    /** Гарантирует наличие scoreboard-цели "donatecoin" на сервере. */
    private static Objective ensureObjective(MinecraftServer server) {
        Scoreboard sb = server.getScoreboard();
        Objective obj = sb.getObjective(OBJECTIVE);
        if (obj == null) {
            obj = sb.addObjective(
                    OBJECTIVE,
                    ObjectiveCriteria.DUMMY,
                    Component.literal("DC"),
                    ObjectiveCriteria.RenderType.INTEGER,
                    true,
                    null);
        }
        return obj;
    }

    /**
     * Выставляет игроку score в scoreboard-цели "donatecoin".
     * Публичный — вызывается из NetworkHandler при получении баланса от клиента.
     */
    public static void syncScoreboardFor(ServerPlayer sp, int balance) {
        syncScoreboard(sp, balance);
    }

    private static void syncScoreboard(ServerPlayer sp, int balance) {
        MinecraftServer server = sp.getServer();
        if (server == null) return;
        Objective obj = ensureObjective(server);
        ScoreAccess score = server.getScoreboard().getOrCreatePlayerScore(sp, obj);
        // balance = -1 (не загружен) → показываем 0, а не пустоту/"..."
        score.set(Math.max(0, balance));
    }

    private static void refresh(ServerPlayer sp) {
        String nick = sp.getGameProfile().getName();
        AdminApi.dc("get", nick, 0, null).thenAccept(r -> {
            if (r.ok && sp.getServer() != null) {
                sp.getServer().execute(() -> {
                    put(nick, r.balance);
                    syncScoreboard(sp, r.balance);
                });
            }
        });
    }

    @SubscribeEvent
    public static void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.getEntity() instanceof ServerPlayer sp) {
            // Сразу выставляем 0, чтобы скорборд не показывал пустоту/"..."
            // до того, как придёт реальный баланс от клиента.
            syncScoreboard(sp, 0);
            refresh(sp);
        }
    }

    @SubscribeEvent
    public static void onLogout(PlayerEvent.PlayerLoggedOutEvent event) {
        if (event.getEntity() instanceof ServerPlayer sp) {
            BALANCES.remove(sp.getGameProfile().getName().toLowerCase());
        }
    }

    @SubscribeEvent
    public static void onServerTick(ServerTickEvent.Post event) {
        // Раз в 200 тиков (~10 сек) обновляем балансы всех онлайн-игроков.
        if (++tickCounter < 200) return;
        tickCounter = 0;
        MinecraftServer server = event.getServer();
        if (server == null) return;
        for (ServerPlayer sp : server.getPlayerList().getPlayers()) {
            refresh(sp);
        }
    }
}
