package ru.politempire.politeshop.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.ChatFormatting;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import ru.politempire.politeshop.Config;
import ru.politempire.politeshop.net.AdminApi;
import ru.politempire.politeshop.server.DcCache;

/**
 * Серверные команды управления DC:
 *   /dc give <ник> <кол-во> [причина]
 *   /dc take <ник> <кол-во> [причина]
 *   /dc set  <ник> <кол-во> [причина]
 *   /dc get  <ник>
 *   /dc balance            — свой баланс (доступно всем)
 *
 * Изменения идут через admin-API сайта (общий журнал DC). Нужен mod_admin_key
 * в конфиге мода на сервере.
 */
public final class DcCommand {
    private DcCommand() {}

    public static void onRegisterCommands(RegisterCommandsEvent event) {
        CommandDispatcher<CommandSourceStack> d = event.getDispatcher();

        d.register(Commands.literal("dc")
                // /dc balance — свой баланс, доступно всем.
                .then(Commands.literal("balance").executes(ctx -> {
                    CommandSourceStack src = ctx.getSource();
                    String nick = src.getTextName();
                    AdminApi.dc("get", nick, 0, null).thenAccept(r -> {
                        if (r.ok) {
                            src.getServer().execute(() -> src.sendSuccess(
                                    () -> Component.literal("Ваш баланс: " + r.balance + " DC").withStyle(ChatFormatting.GOLD), false));
                        } else {
                            src.getServer().execute(() -> src.sendFailure(
                                    Component.literal("Не удалось получить баланс: " + r.error)));
                        }
                    });
                    return 1;
                }))
                // Остальные — только для операторов (permission level 2).
                .then(Commands.literal("give").requires(s -> s.hasPermission(2))
                        .then(nickArg().then(amountArg().executes(c -> run(c, "give"))
                                .then(reasonArg().executes(c -> run(c, "give"))))))
                .then(Commands.literal("take").requires(s -> s.hasPermission(2))
                        .then(nickArg().then(amountArg().executes(c -> run(c, "take"))
                                .then(reasonArg().executes(c -> run(c, "take"))))))
                .then(Commands.literal("set").requires(s -> s.hasPermission(2))
                        .then(nickArg().then(amountArg().executes(c -> run(c, "set"))
                                .then(reasonArg().executes(c -> run(c, "set"))))))
                .then(Commands.literal("get").requires(s -> s.hasPermission(2))
                        .then(nickArg().executes(c -> run(c, "get"))))
        );
    }

    private static com.mojang.brigadier.builder.RequiredArgumentBuilder<CommandSourceStack, String> nickArg() {
        return Commands.argument("nick", StringArgumentType.word());
    }

    private static com.mojang.brigadier.builder.RequiredArgumentBuilder<CommandSourceStack, Integer> amountArg() {
        return Commands.argument("amount", IntegerArgumentType.integer(0, 10_000_000));
    }

    private static com.mojang.brigadier.builder.RequiredArgumentBuilder<CommandSourceStack, String> reasonArg() {
        return Commands.argument("reason", StringArgumentType.greedyString());
    }

    private static int run(com.mojang.brigadier.context.CommandContext<CommandSourceStack> ctx, String action) {
        CommandSourceStack src = ctx.getSource();
        String nick = StringArgumentType.getString(ctx, "nick");
        int amount = "get".equals(action) ? 0 : IntegerArgumentType.getInteger(ctx, "amount");
        String reason = null;
        try { reason = StringArgumentType.getString(ctx, "reason"); } catch (IllegalArgumentException ignored) {}

        if (Config.adminKey().isBlank()) {
            src.sendFailure(Component.literal("Не задан adminKey в конфиге мода (config/politeshop-common.toml)"));
            return 0;
        }

        AdminApi.dc(action, nick, amount, reason).thenAccept(r -> src.getServer().execute(() -> {
            if (r.ok) {
                DcCache.put(nick, r.balance);
                String verb = switch (action) {
                    case "give" -> "Выдано " + amount + " DC игроку ";
                    case "take" -> "Списано " + amount + " DC у игрока ";
                    case "set" -> "Установлен баланс " + amount + " DC игроку ";
                    default -> "Баланс игрока ";
                };
                src.sendSuccess(() -> Component.literal(verb + nick + ". Текущий баланс: " + r.balance + " DC")
                        .withStyle(ChatFormatting.GREEN), true);
            } else {
                src.sendFailure(Component.literal("Ошибка: " + r.error));
            }
        }));
        return 1;
    }
}
