package ru.politempire.politeshop.client;

import net.minecraft.client.Minecraft;
import ru.politempire.politeshop.net.ApiClient;

/**
 * Клиентское состояние: текущий баланс DC для HUD. Обновляется по запросу
 * (при открытии магазина/корзины и периодически из HUD).
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
                .thenAccept(r -> Minecraft.getInstance().execute(() -> balance = r.balance))
                .exceptionally(t -> null);
    }
}
