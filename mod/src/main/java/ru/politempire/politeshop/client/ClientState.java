package ru.politempire.politeshop.client;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import ru.politempire.politeshop.net.ApiClient;
import ru.politempire.politeshop.net.DcBalancePayload;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Клиентское состояние: текущий баланс DC для HUD. Обновляется по запросу
 * (при открытии магазина/корзины и периодически из HUD).
 *
 * ВАЖНО: при каждом обновлении баланс отправляется на сервер через
 * DcBalancePayload — сервер использует его для scoreboard-цели "donatecoin"
 * и текстового плейсхолдера %donatecoin%. Без этого сервер не знает баланс
 * игрока (если не настроен mod_admin_key) и скорборд показывает "...".
 */
public final class ClientState {
    private static volatile int balance = -1;
    private static volatile long lastFetch = 0;

    private ClientState() {}

    public static int balance() {
        return balance;
    }

    public static void setBalance(int b) {
        balance = b;
        // Отправляем баланс на сервер — для скорборда и %donatecoin%.
        sendBalanceToServer(b);
    }

    /** Асинхронно обновляет баланс не чаще раза в 5 секунд. */
    public static void refreshThrottled() {
        long now = System.currentTimeMillis();
        if (now - lastFetch < 5000) return;
        lastFetch = now;
        refreshNow();
    }

    public static void refreshNow() {
        ApiClient.fetchBalance()
                .thenAccept(r -> Minecraft.getInstance().execute(() -> {
                    balance = r.balance;
                    sendBalanceToServer(r.balance);
                }))
                .exceptionally(t -> null);
    }

    /**
     * Отправляет баланс на сервер через кастомный NeoForge-пакет.
     * Безопасно вызывается только из клиентского потока (Minecraft.getInstance().execute).
     */
    private static void sendBalanceToServer(int bal) {
        try {
            ClientPacketListener conn = Minecraft.getInstance().getConnection();
            if (conn != null) {
                PacketDistributor.sendToServer(new DcBalancePayload(bal));
            }
        } catch (Throwable ignored) {
            // Сервер может быть ванильным (без нашего мода) — пакет просто не отправится.
        }
    }
}

