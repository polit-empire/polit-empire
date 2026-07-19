package ru.politempire.politeshop.net;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import ru.politempire.politeshop.PoliteShopMod;

/**
 * Пакет «вот мой баланс DC» — клиент → сервер.
 * Клиент получает баланс через /api/mod/balance (с токеном лаунчера) и
 * отправляет его на сервер. Сервер использует его для scoreboard-цели
 * "donatecoin" и текстового плейсхолдера %donatecoin%. Это избавляет от
 * необходимости настраивать mod_admin_key на сервере — баланс идёт прямо
 * от клиента, который уже авторизован через лаунчер.
 */
public record DcBalancePayload(int balance) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<DcBalancePayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(PoliteShopMod.MODID, "dc_balance"));

    public static final StreamCodec<RegistryFriendlyByteBuf, DcBalancePayload> STREAM_CODEC =
            StreamCodec.of(DcBalancePayload::encode, DcBalancePayload::decode);

    private static void encode(RegistryFriendlyByteBuf buf, DcBalancePayload payload) {
        buf.writeVarInt(payload.balance);
    }

    private static DcBalancePayload decode(RegistryFriendlyByteBuf buf) {
        return new DcBalancePayload(buf.readVarInt());
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
