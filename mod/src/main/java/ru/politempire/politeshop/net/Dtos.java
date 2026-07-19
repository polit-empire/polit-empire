package ru.politempire.politeshop.net;

import java.util.List;

/** Простые DTO для десериализации ответов сайта через Gson. */
public final class Dtos {
    private Dtos() {}

    /** Ответ /api/mod/shop. */
    public static class ShopResponse {
        public String nick;
        public int balance;
        public DcBonus dcBonus;
        public List<ShopProduct> products;
    }

    public static class DcBonus {
        public int threshold;
        public int percent;
    }

    /** Ответ /api/mod/balance. */
    public static class BalanceResponse {
        public String nick;
        public int balance;
    }

    /** Элемент корзины /api/mod/cart. */
    public static class CartItem {
        public int orderId;
        public String kind;
        public String title;
        public String icon;
        public String createdAt;
    }

    /** Ответ /api/mod/cart. */
    public static class CartResponse {
        public List<CartItem> items;
    }

    /** Ответ покупки /api/mod/purchase. */
    public static class PurchaseResponse {
        public boolean ok;
        public Integer orderId;
        public Integer balance;
        public String message;
        public String error;
        public Boolean requiresPayment;
        public String webUrl;
    }

    /** Ответ выдачи /api/mod/claim. */
    public static class ClaimResponse {
        public boolean ok;
        public Boolean delivered;
        public Boolean alreadyDelivered;
        public String message;
        public String error;
    }
}
