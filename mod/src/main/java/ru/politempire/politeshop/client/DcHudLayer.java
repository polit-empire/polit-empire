package ru.politempire.politeshop.client;

import net.minecraft.client.DeltaTracker;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.LayeredDraw;

/**
 * HUD-оверлей: показывает текущий баланс DC в правом верхнем углу.
 * Оставлен пустым, так как меню справа сверху удалено по запросу.
 */
public class DcHudLayer implements LayeredDraw.Layer {
    @Override
    public void render(GuiGraphics gfx, DeltaTracker delta) {
        // Меню отключено (DC баланс отображается только в плейсхолдерах и внутри магазина)
    }
}
