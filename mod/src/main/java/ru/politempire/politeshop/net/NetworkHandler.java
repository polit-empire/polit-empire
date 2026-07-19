package ru.politempire.politeshop.net;

import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.handling.IPayloadContext;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;
import ru.politempire.politeshop.PoliteShopMod;
import ru.politempire.politeshop.server.DcCache;
import ru.politempire.politeshop.server.DcPlaceholder;

/**
 * Регистрация кастомных сетевых пакетов мода.
 * DcBalancePayload — клиент → сервер: баланс DC от лаунчера.
 */
@EventBusSubscriber(modid = PoliteShopMod.MODID, bus = EventBusSubscriber.Bus.MOD)
public final class NetworkHandler {

    private NetworkHandler() {}

    @SubscribeEvent
    public static void onRegisterPayload(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar reg = event.registrar("1");
        reg.playToServer(DcBalancePayload.TYPE, DcBalancePayload.STREAM_CODEC, NetworkHandler::handleDcBalance);
    }

    private static void handleDcBalance(DcBalancePayload payload, IPayloadContext ctx) {
        ctx.enqueueWork(() -> {
            if (!(ctx.player() instanceof ServerPlayer sp)) return;
            String nick = sp.getGameProfile().getName();
            // Сохраняем баланс в кэш и обновляем скорборд.
            DcCache.put(nick, payload.balance());
            DcCache.syncScoreboardFor(sp, payload.balance());
            // Показываем баланс в таб-листе (header/footer), если там есть %donatecoin%.
            DcPlaceholder.refreshFor(sp);
        }).exceptionally(t -> {
            ctx.disconnect(Component.literal("Ошибка обработки DC-баланса"));
            return null;
        });
    }
}
