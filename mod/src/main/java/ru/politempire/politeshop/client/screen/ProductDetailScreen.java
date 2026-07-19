package ru.politempire.politeshop.client.screen;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;
import ru.politempire.politeshop.client.ClientState;
import ru.politempire.politeshop.net.ApiClient;
import ru.politempire.politeshop.net.ShopProduct;

import java.util.List;

/**
 * Экран подробного описания товара. Открывается по клику на карточку в
 * ShopScreen (для всех товаров, кроме пакетов DC — у них своя кнопка
 * «Оплатить» прямо в списке, ведущая на сайт). Показывает иконку, название,
 * тип, длительность (для привилегий), полное описание и кнопку «Купить»
 * (или «Только на сайте», если товар нельзя купить из игры).
 */
public class ProductDetailScreen extends Screen {
    private static final int PANEL_W = 360;
    private static final int PANEL_H = 280;
    private static final int MAX_DESC_LINES = 13;

    private final Screen parent;
    private final ShopProduct product;
    private String status = "";
    private int statusColor = 0xFFCCCCCC;
    private int panelLeft, panelTop;
    private List<FormattedCharSequence> descriptionLines;

    public ProductDetailScreen(Screen parent, ShopProduct product) {
        super(Component.literal(product.name != null ? product.name : "Товар"));
        this.parent = parent;
        this.product = product;
    }

    @Override
    protected void init() {
        panelLeft = (this.width - PANEL_W) / 2;
        panelTop = (this.height - PANEL_H) / 2;
        // Разбиваем описание на строки по ширине панели (с отступами по бокам).
        String desc = product.description != null && !product.description.isBlank()
                ? product.description
                : ("privilege".equals(product.kind)
                        ? ("Привилегия на " + product.durationDays + " дн.")
                        : "Описание отсутствует");
        descriptionLines = this.font.split(Component.literal(desc), PANEL_W - 40);
        rebuild();
    }

    private void rebuild() {
        this.clearWidgets();

        addRenderableWidget(StyledButton.neutral(panelLeft + 8, panelTop + 7, 84, 18,
                Component.literal("← Назад"), () -> this.minecraft.setScreen(parent)));
        addRenderableWidget(StyledButton.neutral(panelLeft + PANEL_W - 28, panelTop + 7, 20, 18,
                Component.literal("✕"), this::onClose));

        // Кнопка покупки внизу панели.
        int btnW = 160;
        int bx = panelLeft + (PANEL_W - btnW) / 2;
        int by = panelTop + PANEL_H - 28;
        if (product.buyableInGame) {
            boolean can = ClientState.balance() < 0 || ClientState.balance() >= product.priceDc;
            StyledButton buy = StyledButton.primary(bx, by, btnW, 20,
                    Component.literal("Купить · " + product.priceDc + " DC"), this::buy);
            buy.active = can;
            addRenderableWidget(buy);
        } else {
            StyledButton site = StyledButton.neutral(bx, by, btnW, 20,
                    Component.literal("Только на сайте"), () -> {});
            site.active = false;
            addRenderableWidget(site);
        }
    }

    private void buy() {
        setStatus("Покупка...", 0xFFCCCCCC);
        ApiClient.purchase(product.id).thenAccept(r -> this.minecraft.execute(() -> {
            if (r.ok) {
                if (r.balance != null) ClientState.setBalance(r.balance);
                setStatus(r.message != null ? r.message : "Куплено! Забери в корзине", 0xFF7BE38B);
            } else {
                setStatus(r.error != null ? r.error : "Не удалось купить", 0xFFFF6B6B);
            }
        })).exceptionally(t -> {
            this.minecraft.execute(() -> setStatus("Ошибка: " + rootMsg(t), 0xFFFF6B6B));
            return null;
        });
    }

    private void setStatus(String s, int color) {
        this.status = s;
        this.statusColor = color;
    }

    private static String rootMsg(Throwable t) {
        Throwable c = t;
        while (c.getCause() != null) c = c.getCause();
        return c.getMessage() == null ? c.getClass().getSimpleName() : c.getMessage();
    }

    @Override
    public void renderBackground(GuiGraphics gfx, int mouseX, int mouseY, float partial) {
        gfx.fillGradient(0, 0, this.width, this.height, 0x40060708, 0x66060708);
    }

    @Override
    public void render(GuiGraphics gfx, int mouseX, int mouseY, float partial) {
        this.renderBackground(gfx, mouseX, mouseY, partial);

        gfx.fill(panelLeft, panelTop, panelLeft + PANEL_W, panelTop + PANEL_H, 0xF2141821);
        gfx.fill(panelLeft, panelTop, panelLeft + PANEL_W, panelTop + 30, 0xFF1B2130);
        gfx.renderOutline(panelLeft, panelTop, PANEL_W, PANEL_H, 0xFF2E3547);
        gfx.fill(panelLeft + 1, panelTop + 30, panelLeft + PANEL_W - 1, panelTop + 31, 0xFF2E3547);

        gfx.drawCenteredString(this.font, this.title, this.width / 2, panelTop + 11, 0xFFFFFFFF);

        int contentLeft = panelLeft + 20;
        int contentTop = panelTop + 44;

        // Крупная иконка (2x масштаб через pose-стек).
        gfx.pose().pushPose();
        gfx.pose().translate(contentLeft, contentTop, 0);
        gfx.pose().scale(2.0f, 2.0f, 1.0f);
        gfx.renderItem(ItemIcons.of(product.icon), 0, 0);
        gfx.pose().popPose();

        // Название и подзаголовок справа от иконки.
        int textX = contentLeft + 40;
        gfx.drawString(this.font, product.name, textX, contentTop + 2, 0xFFFFFFFF, false);
        String sub = "privilege".equals(product.kind)
                ? "Привилегия · " + product.durationDays + " дн."
                : "item".equals(product.kind) ? "Предмет" : "Товар";
        gfx.drawString(this.font, sub, textX, contentTop + 16, 0xFF9AA4B2, false);

        // Цена.
        gfx.drawString(this.font, "Цена: " + product.priceDc + " DC",
                contentLeft, contentTop + 38, 0xFFFFD54A, false);

        // Описание (перенос по строкам, с ограничением по высоте).
        int descY = contentTop + 56;
        int lineIdx = 0;
        for (FormattedCharSequence line : descriptionLines) {
            if (lineIdx >= MAX_DESC_LINES) break;
            gfx.drawString(this.font, line, contentLeft, descY, 0xFFCCCCCC, false);
            descY += 10;
            lineIdx++;
        }

        super.render(gfx, mouseX, mouseY, partial);

        if (!status.isEmpty()) {
            gfx.drawCenteredString(this.font, status, this.width / 2, panelTop + PANEL_H - 40, statusColor);
        }
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
