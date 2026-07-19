package ru.politempire.politeshop;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.NeoForge;
import ru.politempire.politeshop.client.ClientSetup;
import ru.politempire.politeshop.command.DcCommand;

/**
 * Точка входа мода PolitEmpire Donate.
 *
 * Мод работает и на клиенте, и на сервере:
 *  - Клиент: донат-меню, корзина, HUD баланса DC, кнопка в инвентаре.
 *    Все данные тянутся с сайта PolitEmpire по HTTP (accessToken игрока).
 *    Баланс отправляется на сервер через DcBalancePayload — для скорборда.
 *  - Сервер: команды /dc (выдача/списание DC), плейсхолдер %donatecoin%
 *    (текстовая замена в скорборде/таб-листе через Netty-перехватчик),
 *    scoreboard-цель "donatecoin" с балансом игрока.
 *    Баланс хранится на сайте — команды дергают его admin-API,
 *    а плейсхолдер работает на балансе, присланном клиентом.
 */
@Mod(PoliteShopMod.MODID)
public class PoliteShopMod {
    public static final String MODID = "politeshop";

    public PoliteShopMod(IEventBus modBus, ModContainer container, Dist dist) {
        // Конфиг (URL сайта + admin-ключ для команд) — общий для клиента и сервера.
        container.registerConfig(ModConfig.Type.COMMON, Config.SPEC);

        // Серверные команды регистрируются на игровой шине событий.
        NeoForge.EVENT_BUS.addListener(DcCommand::onRegisterCommands);

        // Клиентская часть (HUD, кнопка, экраны, кейбинды) — только на клиенте.
        if (dist.isClient()) {
            ClientSetup.init(modBus);
        }
    }
}
