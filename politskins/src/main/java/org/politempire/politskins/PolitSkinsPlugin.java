package org.politempire.politskins;

import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.List;
import java.util.stream.Stream;

/**
 * PolitSkins 2.0 — фолбэк-скины PolitEmpire для Paper 1.21.1.
 *
 * ЗАЧЕМ ПЕРЕПИСАН
 *
 *   Версия 1.0 собиралась под 1.20.4/Java 17 и ходила в сеть на каждый вход
 *   каждого игрока — и за скином, и за плащом. Плащей на проекте нет ни одного
 *   файла, так что половина запросов уходила в пустоту, а скины и так приезжают
 *   через authlib-injector прямо из GML, уже подписанные.
 *
 * ЧТО ДЕЛАЕТ СЕЙЧАС
 *
 *   Слушает вход и смотрит, есть ли в профиле свойство textures. Если есть —
 *   не делает ничего и в сеть не ходит. Если нет (authlib не ответил, игрок
 *   зашёл в обход лаунчера) — подтягивает скин с сайта и ставит его сам.
 *   В обычный день это ноль запросов, а не сотни.
 *
 * ПОЧЕМУ ИМЕННО AsyncPlayerPreLoginEvent
 *
 *   Он срабатывает до того, как игрок вошёл в мир, поэтому профиль правится
 *   обычным Paper API. Менять скин уже вошедшему игроку без NMS и рассылки
 *   пакетов респавна нельзя — поэтому /politskins refresh не переодевает
 *   игрока на лету, а готовит подпись к следующему входу (см. ниже).
 */
public final class PolitSkinsPlugin extends JavaPlugin implements Listener, TabCompleter {

    private SkinService service;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        service = new SkinService(this);
        service.reload();

        getServer().getPluginManager().registerEvents(this, this);

        var command = getCommand("politskins");
        if (command != null) {
            command.setExecutor(this);
            command.setTabCompleter(this);
        }

        getLogger().info("PolitSkins включён, режим: "
                + (service.isFallbackOnly()
                        ? "фолбэк (скин ставится только тем, кому его не выдал authlib)"
                        : "принудительный (скин ставится всем — это заметно больше запросов)"));
    }

    @Override
    public void onDisable() {
        getLogger().info("PolitSkins выключен. Итог сессии: " + service.stats());
    }

    /**
     * Вход игрока. Событие уже асинхронное, поэтому HTTP можно делать прямо
     * здесь — основной поток сервера не задет.
     *
     * Приоритет HIGH, а не MONITOR: на MONITOR правки события игнорируются, а
     * нам нужно именно записать свойство. HIGH при этом даёт другим плагинам
     * отработать раньше, так что мы видим итоговое состояние профиля.
     */
    @EventHandler(priority = EventPriority.HIGH)
    public void onPreLogin(AsyncPlayerPreLoginEvent event) {
        // Игрока уже завернули (бан, вайтлист, другой плагин) — скин не нужен.
        if (event.getLoginResult() != AsyncPlayerPreLoginEvent.Result.ALLOWED) {
            return;
        }
        service.applyToProfile(event.getPlayerProfile(), event.getName());
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length == 0) {
            sender.sendMessage("§e/politskins reload §7— перечитать config.yml");
            sender.sendMessage("§e/politskins refresh <ник> §7— заново подписать скин игрока");
            sender.sendMessage("§e/politskins clearcache §7— очистить кэш подписей");
            sender.sendMessage("§e/politskins status §7— счётчики за текущую сессию");
            return true;
        }

        switch (args[0].toLowerCase()) {
            case "reload" -> {
                service.reload();
                sender.sendMessage("§aКонфиг перечитан. Режим: "
                        + (service.isFallbackOnly() ? "фолбэк" : "принудительный"));
            }

            case "status" -> sender.sendMessage("§ePolitSkins: §f" + service.stats());

            case "clearcache" -> {
                int removed = service.clearCache();
                sender.sendMessage("§aКэш очищен, удалено файлов: " + removed);
            }

            case "refresh" -> {
                if (args.length < 2) {
                    sender.sendMessage("§cУкажи ник: /politskins refresh <ник>");
                    return true;
                }
                String nick = args[1];
                sender.sendMessage("§7Скачиваю и подписываю скин игрока " + nick + "...");

                // HTTP в основном потоке подвесил бы весь сервер на время
                // запроса к MineSkin — уводим в асинхронный планировщик.
                Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
                    boolean ok = service.prewarm(nick);
                    sender.sendMessage(ok
                            ? "§aСкин игрока " + nick + " подписан и лежит в кэше. "
                                    + "§7Применится при следующем входе: сменить скин уже вошедшему "
                                    + "игроку без NMS нельзя."
                            : "§cНе получилось. Смотри консоль — там причина.");
                });
            }

            default -> sender.sendMessage("§cНеизвестная команда. Просто /politskins — список.");
        }
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1) {
            return Stream.of("reload", "refresh", "clearcache", "status")
                    .filter(s -> s.startsWith(args[0].toLowerCase()))
                    .toList();
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("refresh")) {
            return Bukkit.getOnlinePlayers().stream()
                    .map(player -> player.getName())
                    .filter(name -> name.toLowerCase().startsWith(args[1].toLowerCase()))
                    .toList();
        }
        return List.of();
    }
}
