package ru.politempire.politeshop.client.screen;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/** Преобразует строковый id предмета ("minecraft:diamond") в ItemStack для иконок. */
public final class ItemIcons {
    private ItemIcons() {}

    public static ItemStack of(String id) {
        if (id == null || id.isBlank()) return new ItemStack(Items.CHEST);
        try {
            ResourceLocation rl = ResourceLocation.parse(id.trim());
            Item item = BuiltInRegistries.ITEM.getOptional(rl).orElse(Items.CHEST);
            return new ItemStack(item);
        } catch (Exception e) {
            return new ItemStack(Items.CHEST);
        }
    }
}
