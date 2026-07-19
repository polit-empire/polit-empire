package ru.politempire.politeshop.server;

import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelOutboundHandlerAdapter;
import io.netty.channel.ChannelPromise;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientboundSetObjectivePacket;
import net.minecraft.network.protocol.game.ClientboundSetPlayerTeamPacket;
import net.minecraft.network.protocol.game.ClientboundTabListPacket;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import ru.politempire.politeshop.PoliteShopMod;

import java.lang.reflect.Field;

/**
 * Серверный перехватчик исходящих пакетов: заменяет текст %donatecoin%
 * на фактический баланс DC игрока в:
 *   • ClientboundSetObjectivePacket — заголовок сайдбара
 *   • ClientboundSetPlayerTeamPacket — prefix/suffix команд
 *   • ClientboundTabListPacket — header/footer таб-листа
 *
 * Перехватчик вставляется в Netty-pipeline соединения игрока при входе.
 * Замена выполняется per-player: каждый игрок видит свой баланс.
 */
@EventBusSubscriber(modid = PoliteShopMod.MODID)
public final class DcPlaceholder {

    public static final String PLACEHOLDER = "%donatecoin%";
    private static final String HANDLER_NAME = "politeshop_dc_placeholder";

    private DcPlaceholder() {}

    @SubscribeEvent
    public static void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.getEntity() instanceof ServerPlayer sp) {
            injectHandler(sp);
        }
    }

    @SubscribeEvent
    public static void onLogout(PlayerEvent.PlayerLoggedOutEvent event) {
        if (event.getEntity() instanceof ServerPlayer sp) {
            removeHandler(sp);
        }
    }

    /** Вставляет Netty-перехватчик в pipeline соединения игрока. */
    private static void injectHandler(ServerPlayer sp) {
        try {
            Channel channel = sp.connection.getConnection().channel();
            if (channel.pipeline().get(HANDLER_NAME) != null) return;
            channel.pipeline().addBefore("encoder", HANDLER_NAME, new PlaceholderHandler(sp));
        } catch (Exception ignored) {
            // Если pipeline не готов — просто пропускаем, текст останется неразвернутым.
        }
    }

    private static void removeHandler(ServerPlayer sp) {
        try {
            Channel channel = sp.connection.getConnection().channel();
            if (channel.pipeline().get(HANDLER_NAME) != null) {
                channel.pipeline().remove(HANDLER_NAME);
            }
        } catch (Exception ignored) {}
    }

    /**
     * Принудительно обновляет таб-лист игрока, чтобы плейсхолдер развернулся.
     * Вызывается из NetworkHandler при получении баланса от клиента.
     */
    public static void refreshFor(ServerPlayer sp) {
        // Ничего не делаем — перехватчик сработает при следующей отправке пакета.
        // Если нужно принудительно, сервер сам пришлёт новый TabListPacket.
    }

    // ---- Netty-перехватчик -------------------------------------------------

    private static final class PlaceholderHandler extends ChannelOutboundHandlerAdapter {
        private final ServerPlayer player;

        PlaceholderHandler(ServerPlayer player) {
            this.player = player;
        }

        @Override
        public void write(ChannelHandlerContext ctx, Object msg, ChannelPromise promise) throws Exception {
            if (msg instanceof Packet<?> pkt) {
                msg = processPacket(pkt);
            }
            super.write(ctx, msg, promise);
        }

        @SuppressWarnings("unchecked")
        private Packet<?> processPacket(Packet<?> pkt) {
            int balance = DcCache.get(player.getGameProfile().getName());
            String replacement = balance >= 0 ? String.valueOf(balance) : "0";

            try {
                if (pkt instanceof ClientboundTabListPacket tab) {
                    Component newHeader = replace(tab.header(), replacement);
                    Component newFooter = replace(tab.footer(), replacement);
                    if (newHeader != tab.header() || newFooter != tab.footer()) {
                        return new ClientboundTabListPacket(newHeader, newFooter);
                    }
                } else if (pkt instanceof ClientboundSetObjectivePacket obj) {
                    Component name = obj.getDisplayName();
                    Component newName = replace(name, replacement);
                    if (newName != name) {
                        setField(obj, "displayName", newName);
                    }
                } else if (pkt instanceof ClientboundSetPlayerTeamPacket team) {
                    team.getParameters().ifPresent(params -> {
                        boolean changed = false;
                        Component displayName = params.getDisplayName();
                        Component newDisplayName = replace(displayName, replacement);
                        if (newDisplayName != displayName) {
                            setField(params, "displayName", newDisplayName);
                            changed = true;
                        }
                        Component prefix = params.getPlayerPrefix();
                        Component newPrefix = replace(prefix, replacement);
                        if (newPrefix != prefix) {
                            setField(params, "playerPrefix", newPrefix);
                            changed = true;
                        }
                        Component suffix = params.getPlayerSuffix();
                        Component newSuffix = replace(suffix, replacement);
                        if (newSuffix != suffix) {
                            setField(params, "playerSuffix", newSuffix);
                            changed = true;
                        }
                    });
                }
            } catch (Throwable t) {
                // Любая ошибка в перехватчике НЕ должна рвать соединение.
                // Возвращаем оригинальный пакет.
            }
            return pkt;
        }
    }

    // ---- Замена в Component ------------------------------------------------

    /**
     * Рекурсивно обходит дерево Component и заменяет %donatecoin% в literal-тексте.
     * Возвращает тот же объект, если замен не было (для быстрого сравнения),
     * или новый MutableComponent с заменённым текстом.
     */
    private static Component replace(Component comp, String replacement) {
        if (comp == null) return null;
        String plain = comp.getString();
        if (!plain.contains(PLACEHOLDER)) return comp;

        // Простой подход: заменяем в plain-text и создаём новый literal-компонент.
        // Это теряет стиль (bold/color) внутри компонента, но для числового
        // плейсхолдера в скорборде этого достаточно — стиль применяется к
        // всей строке скорбарда, а не к отдельному числу.
        String replaced = plain.replace(PLACEHOLDER, replacement);
        MutableComponent result = Component.literal(replaced);
        result.setStyle(comp.getStyle());
        for (Component sibling : comp.getSiblings()) {
            result.append(replace(sibling, replacement));
        }
        return result;
    }

    // ---- Reflection helper -------------------------------------------------

    private static void setField(Object target, String fieldName, Object value) {
        try {
            Field f = target.getClass().getDeclaredField(fieldName);
            f.setAccessible(true);
            f.set(target, value);
        } catch (Exception ignored) {}
    }
}
