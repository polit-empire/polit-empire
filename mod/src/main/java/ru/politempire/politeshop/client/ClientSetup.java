package ru.politempire.politeshop.client;

import com.mojang.brigadier.CommandDispatcher;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.client.event.RegisterClientCommandsEvent;
import net.neoforged.neoforge.client.event.RegisterGuiLayersEvent;
import net.neoforged.neoforge.client.event.ScreenEvent;
import net.neoforged.neoforge.common.NeoForge;
import ru.politempire.politeshop.PoliteShopMod;
import ru.politempire.politeshop.client.screen.ShopScreen;

import static net.minecraft.commands.Commands.literal;

/**
 * Клиентская инициализация: команда /donate для открытия магазина, HUD баланса
 * DC и кнопка «Донат» в инвентаре.
 */
public final class ClientSetup {

    private ClientSetup() {}

    public static void init(IEventBus modBus) {
        modBus.addListener(ClientSetup::onRegisterGuiLayers);

        NeoForge.EVENT_BUS.addListener(ClientSetup::onScreenInit);
        NeoForge.EVENT_BUS.addListener(ClientSetup::onRegisterClientCommands);
    }

    private static void onRegisterGuiLayers(RegisterGuiLayersEvent event) {
        event.registerAboveAll(
                ResourceLocation.fromNamespaceAndPath(PoliteShopMod.MODID, "dc_hud"),
                new DcHudLayer());
    }

    /** Регистрируем клиентскую команду /donate — открывает магазин. */
    private static void onRegisterClientCommands(RegisterClientCommandsEvent event) {
        CommandDispatcher<CommandSourceStack> d = event.getDispatcher();
        d.register(literal("donate").executes(ctx -> {
            // Экран нужно открывать в основном потоке клиента после закрытия чата.
            Minecraft.getInstance().execute(() -> Minecraft.getInstance().setScreen(new ShopScreen()));
            return 1;
        }));
        // Псевдоним /shop для удобства.
        d.register(literal("shop").executes(ctx -> {
            Minecraft.getInstance().execute(() -> Minecraft.getInstance().setScreen(new ShopScreen()));
            return 1;
        }));
    }

    /** Добавляем кнопку «Донат» в экран инвентаря. */
    private static void onScreenInit(ScreenEvent.Init.Post event) {
        if (!(event.getScreen() instanceof InventoryScreen inv)) return;
        int x = inv.getGuiLeft() + inv.getXSize() - 22;
        int y = inv.getGuiTop() + 4;
        Button btn = Button.builder(Component.literal("$"), b -> Minecraft.getInstance().setScreen(new ShopScreen()))
                .bounds(x, y, 18, 18)
                .tooltip(Tooltip.create(Component.literal("Донат-магазин (/donate)")))
                .build();
        event.addListener(btn);
    }
}
