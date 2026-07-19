package ru.politempire.politeshop.client.screen;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.network.chat.Component;

/**
 * Плоская стилизованная кнопка вместо ванильной: сплошной фон, обводка,
 * подсветка при наведении, аккуратный disabled-стейт. Цвет акцента
 * настраивается (для основной кнопки покупки/выдачи).
 */
public class StyledButton extends AbstractButton {
    private final Runnable onPress;
    private final int accent;      // базовый цвет фона (ARGB)
    private final int accentHover; // фон при наведении

    public StyledButton(int x, int y, int w, int h, Component label, int accent, int accentHover, Runnable onPress) {
        super(x, y, w, h, label);
        this.accent = accent;
        this.accentHover = accentHover;
        this.onPress = onPress;
    }

    /** Нейтральная (серая) кнопка — для навигации/вторичных действий. */
    public static StyledButton neutral(int x, int y, int w, int h, Component label, Runnable onPress) {
        return new StyledButton(x, y, w, h, label, 0xFF2A303C, 0xFF39414F, onPress);
    }

    /** Акцентная (зелёная) кнопка — основное действие. */
    public static StyledButton primary(int x, int y, int w, int h, Component label, Runnable onPress) {
        return new StyledButton(x, y, w, h, label, 0xFF1F7A4D, 0xFF25995F, onPress);
    }

    /** Золотая кнопка — оплата/сайт. */
    public static StyledButton gold(int x, int y, int w, int h, Component label, Runnable onPress) {
        return new StyledButton(x, y, w, h, label, 0xFF9A7415, 0xFFBE8F1B, onPress);
    }

    @Override
    public void onPress() {
        if (onPress != null) onPress.run();
    }

    @Override
    protected void renderWidget(GuiGraphics gfx, int mouseX, int mouseY, float partial) {
        int x0 = getX(), y0 = getY(), x1 = x0 + width, y1 = y0 + height;
        boolean hovered = this.isHoveredOrFocused();

        int bg = !this.active ? 0xFF23262E : (hovered ? accentHover : accent);
        int border = !this.active ? 0xFF33373F : (hovered ? 0xFFFFFFFF & 0x66FFFFFF | 0x66000000 : 0xFF000000 | (accentHover & 0xFFFFFF));

        // Фон + верхний блик для лёгкого объёма.
        gfx.fill(x0, y0, x1, y1, bg);
        gfx.fill(x0, y0, x1, y0 + 1, hovered ? 0x40FFFFFF : 0x22FFFFFF);
        gfx.renderOutline(x0, y0, width, height, border);

        int textColor = !this.active ? 0xFF6B7280 : 0xFFFFFFFF;
        gfx.drawCenteredString(Minecraft.getInstance().font, this.getMessage(),
                x0 + width / 2, y0 + (height - 8) / 2, textColor);
    }

    @Override
    protected void updateWidgetNarration(NarrationElementOutput out) {
        this.defaultButtonNarrationText(out);
    }
}
