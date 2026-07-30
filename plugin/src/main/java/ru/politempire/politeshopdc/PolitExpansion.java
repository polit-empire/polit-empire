package ru.politempire.politeshopdc;

import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import org.bukkit.OfflinePlayer;
import org.jetbrains.annotations.NotNull;
import com.palmergames.bukkit.towny.TownyAPI;
import com.palmergames.bukkit.towny.object.Town;
import java.util.List;
import java.util.Comparator;
import java.util.stream.Collectors;

public class PolitExpansion extends PlaceholderExpansion {
    private final PoliteShopPlugin plugin;
    private final StatsTracker statsTracker;
    
    // Кэшированные топы городов, чтобы не лагать
    private long lastTopUpdate = 0;
    private List<Town> topResidents;
    private List<Town> topTownBlocks;
    private List<Town> topBalance;

    public PolitExpansion(PoliteShopPlugin plugin, StatsTracker statsTracker) {
        this.plugin = plugin;
        this.statsTracker = statsTracker;
    }

    @Override
    public @NotNull String getIdentifier() {
        return "polit";
    }

    @Override
    public @NotNull String getAuthor() {
        return "PolitEmpire";
    }

    @Override
    public @NotNull String getVersion() {
        return plugin.getDescription().getVersion();
    }

    @Override
    public boolean persist() {
        return true;
    }
    
    private void updateTopsIfNeeded() {
        long now = System.currentTimeMillis();
        if (now - lastTopUpdate > 300_000) { // раз в 5 минут
            lastTopUpdate = now;
            try {
                List<Town> towns = TownyAPI.getInstance().getTowns();
                topResidents = towns.stream()
                        .sorted(Comparator.comparingInt(Town::getNumResidents).reversed())
                        .collect(Collectors.toList());
                        
                topTownBlocks = towns.stream()
                        .sorted(Comparator.comparingInt(t -> t.getTownBlocks().size()))
                        .map(t -> (Town) t) // force type
                        .sorted((t1, t2) -> Integer.compare(t2.getTownBlocks().size(), t1.getTownBlocks().size()))
                        .collect(Collectors.toList());
                        
                topBalance = towns.stream()
                        .sorted(Comparator.comparingDouble((Town t) -> t.getAccount().getHoldingBalance()).reversed())
                        .collect(Collectors.toList());
            } catch (Throwable ignored) {
                // Towny не установлен или ошибка
                topResidents = null;
                topTownBlocks = null;
                topBalance = null;
            }
        }
    }

    @Override
    public String onRequest(OfflinePlayer player, @NotNull String params) {
        if (player == null || player.getName() == null) return "";
        
        String nick = player.getName();

        if (params.equals("kills")) {
            return String.valueOf(statsTracker.getKills(nick));
        }
        if (params.equals("deaths")) {
            return String.valueOf(statsTracker.getDeaths(nick));
        }
        if (params.equals("kd")) {
            int k = statsTracker.getKills(nick);
            int d = statsTracker.getDeaths(nick);
            if (d == 0) return String.valueOf(k);
            return String.format("%.2f", (double) k / d);
        }
        if (params.equals("town")) {
            try {
                Town town = TownyAPI.getInstance().getTown(player.getUniqueId());
                return town != null ? town.getName() : "города нету";
            } catch (Throwable e) {
                return "города нету";
            }
        }
        
        // %polit_top_residents_1%
        if (params.startsWith("top_residents_")) {
            updateTopsIfNeeded();
            if (topResidents == null) return "N/A";
            try {
                int index = Integer.parseInt(params.replace("top_residents_", "")) - 1;
                if (index >= 0 && index < topResidents.size()) {
                    return topResidents.get(index).getName();
                }
            } catch (Exception e) {}
            return "N/A";
        }
        
        // %polit_top_territory_1%
        if (params.startsWith("top_territory_")) {
            updateTopsIfNeeded();
            if (topTownBlocks == null) return "N/A";
            try {
                int index = Integer.parseInt(params.replace("top_territory_", "")) - 1;
                if (index >= 0 && index < topTownBlocks.size()) {
                    return topTownBlocks.get(index).getName();
                }
            } catch (Exception e) {}
            return "N/A";
        }
        
        // %polit_top_balance_1%
        if (params.startsWith("top_balance_")) {
            updateTopsIfNeeded();
            if (topBalance == null) return "N/A";
            try {
                int index = Integer.parseInt(params.replace("top_balance_", "")) - 1;
                if (index >= 0 && index < topBalance.size()) {
                    return topBalance.get(index).getName();
                }
            } catch (Exception e) {}
            return "N/A";
        }

        return null;
    }
}
