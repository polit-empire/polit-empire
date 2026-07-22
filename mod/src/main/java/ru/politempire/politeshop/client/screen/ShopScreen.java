package ru.politempire.politeshop.client.screen;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.Util;
import ru.politempire.politeshop.client.ClientState;
import ru.politempire.politeshop.net.ApiClient;
import ru.politempire.politeshop.net.ShopProduct;

import java.util.ArrayList;
import java.util.List;

/**
 * Донат-магазин. Тянет товары с сайта, показывает карточки с иконкой, ценой
 * и стилизованной кнопкой покупки. Привилегии/предметы покупаются за DC
 * (попадают в корзину), пакеты DC открывают сайт для оплаты.
 */
public class ShopScreen extends Screen {
    private static final int PANEL_W = 360;
    private static final int PANEL_H = 280;
    private static final int PER_PAGE = 4;
    private static final int CARD_H = 40;
    private static final int CARD_GAP = 6;

    private List<ShopProduct> products = new ArrayList<>();
    private boolean loading = true;
    private String status = "";
    private int statusColor = 0xFFCCCCCC;
    private int page = 0;
    private int selectedCategory = 0; // 0=Все, 1=Привилегии, 2=Предметы, 3=DC, 4=Другое
    private int panelLeft, panelTop;

    public ShopScreen() {
        super(Component.literal("Донат-магазин"));
    }

    @Override
    protected void init() {
        panelLeft = (this.width - PANEL_W) / 2;
        panelTop = (this.height - PANEL_H) / 2;
        if (loading && products.isEmpty()) fetch();
        rebuild();
    }

    private int cardX() { return panelLeft + 10; }
    private int cardW() { return PANEL_W - 20; }
    private int cardsTop() { return panelTop + 52; }

    private List<ShopProduct> getFilteredProducts() {
        if (selectedCategory == 0) return products;
        List<ShopProduct> filtered = new ArrayList<>();
        for (ShopProduct p : products) {
            if (selectedCategory == 1 && p.isPrivilege()) filtered.add(p);
            else if (selectedCategory == 2 && p.isItem()) filtered.add(p);
            else if (selectedCategory == 3 && p.isDcPackage()) filtered.add(p);
            else if (selectedCategory == 4 && p.isOther()) filtered.add(p);
        }
        return filtered;
    }

    private void fetch() {
        loading = true;
        status = "Загрузка...";
        ApiClient.fetchShop()
                .thenAccept(resp -> this.minecraft.execute(() -> {
                    this.products = resp.products != null ? resp.products : new ArrayList<>();
                    ClientState.setBalance(resp.balance);
                    loading = false;
                    status = "";
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

    private void rebuild() {
        this.clearWidgets();

        // Верхняя панель.
        addRenderableWidget(StyledButton.neutral(panelLeft + 8, panelTop + 7, 74, 18,
                Component.literal("Корзина"), () -> this.minecraft.setScreen(new CartScreen(this))));
        addRenderableWidget(StyledButton.neutral(panelLeft + PANEL_W - 96, panelTop + 7, 62, 18,
                Component.literal("Обновить"), this::fetch));
        addRenderableWidget(StyledButton.neutral(panelLeft + PANEL_W - 28, panelTop + 7, 20, 18,
                Component.literal("✕"), this::onClose));

        if (loading) return;

        // Переключатели категорий под шапкой
        String[] catLabels = {"Все", "Прив.", "Предметы", "DC", "Другое"};
        int tabW = 64;
        int tabGap = 4;
        int startX = panelLeft + (PANEL_W - (5 * tabW + 4 * tabGap)) / 2;
        for (int i = 0; i < 5; i++) {
            final int catIndex = i;
            StyledButton btn = StyledButton.neutral(
                    startX + i * (tabW + tabGap), panelTop + 30, tabW, 16,
                    Component.literal(catLabels[i]),
                    () -> {
                        if (selectedCategory != catIndex) {
                            selectedCategory = catIndex;
                            page = 0;
                            rebuild();
                        }
                    }
            );
            if (selectedCategory == catIndex) {
                btn.active = false;
            }
            addRenderableWidget(btn);
        }

        List<ShopProduct> list = getFilteredProducts();

        // Кнопка «Оплатить» только для пакетов DC — они оплачиваются на сайте
        int start = page * PER_PAGE;
        int btnW = 108;
        for (int i = 0; i < PER_PAGE; i++) {
            int idx = start + i;
            if (idx >= list.size()) break;
            ShopProduct p = list.get(idx);
            if (!p.isDcPackage()) continue;
            int y = cardsTop() + i * (CARD_H + CARD_GAP);
            int bx = cardX() + cardW() - btnW - 6;
            int by = y + (CARD_H - 20) / 2;
            addRenderableWidget(StyledButton.gold(bx, by, btnW, 20,
                    Component.literal("Оплатить · " + p.priceMoney + "₽"), () -> buy(p)));
        }

        // Пагинация.
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

    private int totalPages() {
        return Math.max(1, (int) Math.ceil(getFilteredProducts().size() / (double) PER_PAGE));
    }

    private void buy(ShopProduct p) {
        if (p.isDcPackage()) {
            ApiClient.purchase(p.id).thenAccept(r -> this.minecraft.execute(() -> {
                if (r.webUrl != null) Util.getPlatform().openUri(r.webUrl);
                setStatus(r.error != null ? r.error : "Открой сайт для оплаты", 0xFFFFD54A);
            })).exceptionally(t -> null);
            return;
        }
        setStatus("Покупка...", 0xFFCCCCCC);
        ApiClient.purchase(p.id).thenAccept(r -> this.minecraft.execute(() -> {
            if (r.ok) {
                if (r.balance != null) ClientState.setBalance(r.balance);
                setStatus(r.message != null ? r.message : "Куплено! Забери в корзине", 0xFF7BE38B);
                rebuild();
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
        // Лёгкое затемнение без ванильного размытия (мир остаётся видимым).
        gfx.fillGradient(0, 0, this.width, this.height, 0x40060708, 0x66060708);
    }

    @Override
    public void render(GuiGraphics gfx, int mouseX, int mouseY, float partial) {
        this.renderBackground(gfx, mouseX, mouseY, partial);

        // Панель со скруглённой шапкой.
        gfx.fill(panelLeft, panelTop, panelLeft + PANEL_W, panelTop + PANEL_H, 0xF2141821);
        gfx.fill(panelLeft, panelTop, panelLeft + PANEL_W, panelTop + 28, 0xFF1B2130);
        gfx.renderOutline(panelLeft, panelTop, PANEL_W, PANEL_H, 0xFF2E3547);
        // Разделитель под шапкой.
        gfx.fill(panelLeft + 1, panelTop + 28, panelLeft + PANEL_W - 1, panelTop + 29, 0xFF2E3547);

        // Заголовок и баланс.
        gfx.drawCenteredString(this.font, this.title, this.width / 2, panelTop + 10, 0xFFFFFFFF);
        String bal = (ClientState.balance() < 0 ? "…" : ClientState.balance()) + " DC";
        gfx.drawString(this.font, bal, panelLeft + 84, panelTop + 11, 0xFFFFD54A, false);

        List<ShopProduct> list = getFilteredProducts();

        // Карточки рисуем ДО виджетов, чтобы кнопки были поверх.
        if (loading) {
            gfx.drawCenteredString(this.font, "Загрузка магазина…", this.width / 2, panelTop + PANEL_H / 2, 0xFFCCCCCC);
        } else if (list.isEmpty()) {
            gfx.drawCenteredString(this.font, "Товары не найдены", this.width / 2, panelTop + PANEL_H / 2, 0xFFCCCCCC);
        } else {
            renderCards(gfx, mouseX, mouseY, list);
        }

        super.render(gfx, mouseX, mouseY, partial);

        // Статус в нижней полосе (над пагинацией), не наезжает на карточки.
        if (!status.isEmpty()) {
            gfx.drawCenteredString(this.font, status, this.width / 2, panelTop + PANEL_H - 42, statusColor);
        }
    }

    private void renderCards(GuiGraphics gfx, int mouseX, int mouseY, List<ShopProduct> list) {
        int start = page * PER_PAGE;
        int btnW = 108;
        for (int i = 0; i < PER_PAGE; i++) {
            int idx = start + i;
            if (idx >= list.size()) break;
            ShopProduct p = list.get(idx);
            int y = cardsTop() + i * (CARD_H + CARD_GAP);

            int textMaxRight = p.isDcPackage()
                    ? cardX() + cardW() - btnW - 14
                    : cardX() + cardW() - 14;

            boolean hover = mouseX >= cardX() && mouseX <= cardX() + cardW() && mouseY >= y && mouseY <= y + CARD_H;
            gfx.fill(cardX(), y, cardX() + cardW(), y + CARD_H, hover ? 0xFF212838 : 0xFF1B212C);
            gfx.renderOutline(cardX(), y, cardW(), CARD_H, 0xFF2E3547);
            
            // Цветная акцентная полоска слева в зависимости от категории
            int stripeColor = p.isPrivilege() ? 0xFFFFD700 : p.isItem() ? 0xFF3B82F6 : p.isDcPackage() ? 0xFF10B981 : 0xFFA855F7;
            gfx.fill(cardX(), y, cardX() + 2, y + CARD_H, stripeColor);

            gfx.renderItem(ItemIcons.of(p.icon), cardX() + 10, y + (CARD_H - 16) / 2);

            int textX = cardX() + 34;
            String name = trim(p.name, textMaxRight - textX);
            gfx.drawString(this.font, name, textX, y + 8, 0xFFFFFFFF, false);

            String sub;
            int subColor;
            if (p.isDcPackage()) {
                sub = "Пакет DC · +" + p.dcAmount + " DC";
                subColor = 0xFFFFD54A;
            } else {
                sub = (p.isPrivilege() ? "Привилегия" : p.isItem() ? "Предмет" : "Товар") + " · " + p.priceDc + " DC";
                subColor = 0xFF9AA4B2;
            }
            sub = trim(sub, textMaxRight - textX);
            gfx.drawString(this.font, sub, textX, y + 22, subColor, false);
        }

        gfx.drawCenteredString(this.font, (page + 1) + " / " + totalPages(),
                this.width / 2, panelTop + PANEL_H - 22, 0xFFCCCCCC);
    }

    /** Обрезает строку по ширине в пикселях с многоточием. */
    private String trim(String s, int maxWidth) {
        if (this.font.width(s) <= maxWidth) return s;
        while (s.length() > 1 && this.font.width(s + "…") > maxWidth) {
            s = s.substring(0, s.length() - 1);
        }
        return s + "…";
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (super.mouseClicked(mouseX, mouseY, button)) return true;
        List<ShopProduct> list = getFilteredProducts();
        if (button != 0 || loading || list.isEmpty()) return false;

        int start = page * PER_PAGE;
        for (int i = 0; i < PER_PAGE; i++) {
            int idx = start + i;
            if (idx >= list.size()) break;
            ShopProduct p = list.get(idx);
            if (p.isDcPackage()) continue;
            int y = cardsTop() + i * (CARD_H + CARD_GAP);
            if (mouseX >= cardX() && mouseX <= cardX() + cardW()
                    && mouseY >= y && mouseY <= y + CARD_H) {
                this.minecraft.setScreen(new ProductDetailScreen(this, p));
                return true;
            }
        }
        return false;
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
