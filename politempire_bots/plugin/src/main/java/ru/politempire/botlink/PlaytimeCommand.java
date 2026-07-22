package ru.politempire.botlink;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;

import java.util.Collections;
import java.util.List;

/**
 * /playtime [ник] — показать наигранное время (своё или другого игрока).
 */
public final class PlaytimeCommand implements CommandExecutor, TabCompleter {

    private final BotLinkPlugin plugin;

    public PlaytimeCommand(BotLinkPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, String @NotNull [] args) {
        PlaytimeManager pm = PlaytimeManager.get();
        if (pm == null) {
            sender.sendMessage(plugin.msg("api-error"));
            return true;
        }

        if (args.length == 0) {
            if (!(sender instanceof Player player)) {
                sender.sendMessage("Использование: /playtime <ник>");
                return true;
            }
            showPlaytime(sender, player.getName(), pm.getPlaytimeFormatted(player));
            return true;
        }

        // /playtime <ник> — может запрашивать любой, данные публичные
        String target = args[0];
        pm.fetchPlaytimeAsync(target).thenAccept(secs ->
                plugin.getServer().getScheduler().runTask(plugin, () ->
                        showPlaytime(sender, target, PlaytimeManager.formatTime(secs))));
        return true;
    }

    private void showPlaytime(CommandSender sender, String name, String formatted) {
        sender.sendMessage(plugin.msg("playtime-show", "%player%", name, "%time%", formatted));
    }

    @Override
    public List<String> onTabComplete(@NotNull CommandSender sender, @NotNull Command command,
                                      @NotNull String label, String @NotNull [] args) {
        if (args.length == 1 && sender.hasPermission("botlink.playtime.others")) {
            return null; // Bukkit сам дополнит по онлайн-игрокам
        }
        return Collections.emptyList();
    }
}
