package ru.politempire.politeshop.net;

/** Товар из /api/mod/shop. Поля совпадают с JSON, который отдаёт сайт. */
public class ShopProduct {
    public int id;
    public String kind;          // privilege | dc | item
    public String name;
    public String description;
    public int priceDc;          // цена в DC (для privilege/item)
    public int priceMoney;       // цена в валюте (для пакетов DC)
    public int dcAmount;         // сколько DC даёт пакет
    public int durationDays;
    public String accent;
    public String icon;          // id предмета Minecraft для иконки
    public boolean buyableInGame;

    public boolean isDcPackage() {
        return "dc".equals(kind);
    }
}
