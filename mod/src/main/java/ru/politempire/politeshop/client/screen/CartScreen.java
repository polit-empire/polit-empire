package ru.politempire.politeshop.client.screen;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import ru.politempire.politeshop.net.ApiClient;
import ru.politempire.politeshop.net.Dtos;

import java.util.ArrayList;
import java.util.List;

/**
 * Корзина: оплаченные, но не выданные заказы. Кнопка «Забрать» выполняет
 * выдачу на сервере (RCON) и убирает элемент из корзины.
 */
public class CartScreen extends Screen {
    private static final int PANEL_W = 360;
    private static final int PANEL_H = 280;
    private static final int PER_PAGE = 4;
    private static final int CARD_H = 40;
    private static final int CARD_GAP = 6;

    private final Screen parent;
    private List<Dtos.CartItem> items = new ArrayList<>();
    private boolean loading = true;
    private String status = "";
    private int statusColor = 0xFFCCCCCC;
    private int page = 0;
    private int panelLeft, panelTop;

    public CartScreen(Screen parent) {
        super(Component.literal("Корзина"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        panelLeft = (this.width - PANEL_W) / 2;
        panelTop = (this.height - PANEL_H) / 2;
        if (loading && items.isEmpty()) fetch();
        rebuild();
    }

    private int cardX() { return panelLeft + 10; }
    private int cardW() { return PANEL_W - 20; }
    private int cardsTop() { return panelTop + 50; }

    private void fetch() {
        loading = true;
        status = "Загрузка...";
        ApiClient.fetchCart()
                .thenAccept(resp -> this.minecraft.execute(() -> {
                    this.items = resp.items != null ? resp.items : new ArrayList<>();
                    loading = false;
                    status = this.items.isEmpty() ? "Корзина пуста" : "";
                    if (page > 0 && page * PER_PAGE >= items.size()) page = 0;
                    rebuild();
                }))
                .exceptionally(t -> {
                    this.minecraft.execute(() -> {
                        loading = false;
                        setStatus("Ошибка: " + rootMsg(t), 0xFFFF6B6B);
                        rebuild();
                    });
                    return null;
                });
    }

    private int totalPages() {
        return Math.max(1, (int) Math.ceil(items.size() / (double) PER_PAGE));
    }

    private void rebuild() {
        this.clearWidgets();

        addRenderableWidget(StyledButton.neutral(panelLeft + 8, panelTop + 7, 84, 18,
                Component.literal("← Магазин"), () -> this.minecraft.setScreen(parent)));
        addRenderableWidget(StyledButton.neutral(panelLeft + PANEL_W - 96, panelTop + 7, 62, 18,
                Component.literal("Обновить"), this::fetch));
        addRenderableWidget(StyledButton.neutral(panelLeft + PANEL_W - 28, panelTop + 7, 20, 18,
                Component.literal("✕"), this::onClose));

        if (loading) return;

        int start = page * PER_PAGE;
        int btnW = 90;
        for (int i = 0; i < PER_PAGE; i++) {
            int idx = start + i;
            if (idx >= items.size()) break;
            Dtos.CartItem it = items.get(idx);
            int y = cardsTop() + i * (CARD_H + CARD_GAP);
            int bx = cardX() + cardW() - btnW - 6;
            int by = y + (CARD_H - 20) / 2;
            addRenderableWidget(StyledButton.primary(bx, by, btnW, 20,
                    Component.literal("Забрать"), () -> claim(it)));
        }

        int pages = totalPages();
        StyledButton prev = StyledButton.neutral(panelLeft + PANEL_W / 2 - 62, panelTop + PANEL_H - 26, 26, 18,
                Component.literal("‹"), () -> { if (page > 0) { page--; rebuild(); } });
        prev.active = page > 0;
        StyledButton next = StyledButton.neutral(panelLeft + PANEL_W / 2 + 36, panelTop + PANEL_H - 26, 26, 18,
                Component.literal("›"), () -> { if (page < pages - 1) { page++; rebuild(); } });
        next.active = page < pages - 1;
        addRenderableWidget(prev);
        addRenderableWidget(next);
    }

    private void claim(Dtos.CartItem it) {
        setStatus("Выдача...", 0xFFCCCCCC);
        ApiClient.claim(it.orderId).thenAccept(r -> this.minecraft.execute(() -> {
            if (r.ok) {
                items.removeIf(x -> x.orderId == it.orderId);
                setStatus(r.message != null ? r.message : "Выдано!", 0xFF7BE38B);
                if (items.isEmpty()) status = "Корзина пуста";
                rebuild();
            } else {
                setStatus(r.error != null ? r.error : "Не удалось забрать", 0xFFFF6B6B);
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

        if (loading) {
            gfx.drawCenteredString(this.font, "Загрузка…", this.width / 2, panelTop + PANEL_H / 2, 0xFFCCCCCC);
        } else if (items.isEmpty()) {
            gfx.drawCenteredString(this.font, "Корзина пуста", this.width / 2, panelTop + PANEL_H / 2, 0xFF9AA4B2);
        } else {
            renderCards(gfx, mouseX, mouseY);
        }

        super.render(gfx, mouseX, mouseY, partial);

        if (!status.isEmpty() && !items.isEmpty()) {
            gfx.drawCenteredString(this.font, status, this.width / 2, panelTop + PANEL_H - 42, statusColor);
        }
    }

    private void renderCards(GuiGraphics gfx, int mouseX, int mouseY) {
        int start = page * PER_PAGE;
        int btnW = 90;
        int textMaxRight = cardX() + cardW() - btnW - 14;
        for (int i = 0; i < PER_PAGE; i++) {
            int idx = start + i;
            if (idx >= items.size()) break;
            Dtos.CartItem it = items.get(idx);
            int y = cardsTop() + i * (CARD_H + CARD_GAP);

            boolean hover = mouseX >= cardX() && mouseX <= cardX() + cardW() && mouseY >= y && mouseY <= y + CARD_H;
            gfx.fill(cardX(), y, cardX() + cardW(), y + CARD_H, hover ? 0xFF212838 : 0xFF1B212C);
            gfx.renderOutline(cardX(), y, cardW(), CARD_H, 0xFF2E3547);
            gfx.fill(cardX(), y, cardX() + 2, y + CARD_H, 0xFF7BE38B);

            gfx.renderItem(ItemIcons.of(it.icon), cardX() + 10, y + (CARD_H - 16) / 2);

            int textX = cardX() + 34;
            String title = trim(it.title, textMaxRight - textX);
            gfx.drawString(this.font, title, textX, y + 8, 0xFFFFFFFF, false);
            String kindLabel = "privilege".equals(it.kind) ? "Привилегия"
                    : "item".equals(it.kind) ? "Предмет" : "Товар";
            gfx.drawString(this.font, kindLabel, textX, y + 22, 0xFF9AA4B2, false);
        }

        gfx.drawCenteredString(this.font, (page + 1) + " / " + totalPages(),
                this.width / 2, panelTop + PANEL_H - 22, 0xFFCCCCCC);
    }

    private String trim(String s, int maxWidth) {
        if (this.font.width(s) <= maxWidth) return s;
        while (s.length() > 1 && this.font.width(s + "…") > maxWidth) {
            s = s.substring(0, s.length() - 1);
        }
        return s + "…";
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
