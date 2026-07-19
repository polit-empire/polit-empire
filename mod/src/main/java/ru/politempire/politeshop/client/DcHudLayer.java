package ru.politempire.politeshop.client;

import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.LayeredDraw;
import net.minecraft.network.chat.Component;

/**
 * HUD-оверлей: показывает текущий баланс DC в правом верхнем углу.
 * Скрывается, когда открыт какой-либо экран или карта/спектатор.
 */
public class DcHudLayer implements LayeredDraw.Layer {
    private static final int GOLD = 0xFFFFD54A;
    private static final int SHADOW_BG = 0x88000000;

    @Override
    public void render(GuiGraphics gfx, DeltaTracker delta) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.options.hideGui) return;
        if (mc.screen != null) return;

        // Периодически обновляем баланс в фоне.
        ClientState.refreshThrottled();

        int bal = ClientState.balance();
        String text = bal < 0 ? "DC: ..." : ("DC: " + bal);

        Font font = mc.font;
        int screenW = gfx.guiWidth();
        int textW = font.width(text);
        int padding = 4;
        int boxW = textW + padding * 2;
        int x = screenW - boxW - 6;
        int y = 6;

        // Фон-плашка + текст.
        gfx.fill(x, y, x + boxW, y + font.lineHeight + padding * 2 - 4, SHADOW_BG);
        gfx.drawString(font, Component.literal(text), x + padding, y + padding, GOLD, true);
    }
}
