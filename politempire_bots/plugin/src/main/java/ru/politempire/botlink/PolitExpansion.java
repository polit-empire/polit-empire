package ru.politempire.botlink;

import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import org.bukkit.OfflinePlayer;
import org.jetbrains.annotations.NotNull;
import com.palmergames.bukkit.towny.TownyAPI;
import com.palmergames.bukkit.towny.object.Town;
import java.util.List;
import java.util.Comparator;
import java.util.stream.Collectors;

public class PolitExpansion extends PlaceholderExpansion {
    private final BotLinkPlugin plugin;
    private final StatsTracker statsTracker;
    
    // Кэшированные топы городов, чтобы не лагать
    private long lastTopUpdate = 0;
    private List<Town> topResidents;
    private List<Town> topTownBlocks;
    private List<Town> topBalance;
    
    // Кэшированные топы игроков по статистике
    private List<String> topKills;
    private List<String> topDeaths;
    private List<String> topKd;

    public PolitExpansion(BotLinkPlugin plugin, StatsTracker statsTracker) {
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
            
            try {
                java.util.Set<String> tracked = statsTracker.getTrackedPlayers();
                topKills = tracked.stream()
                        .sorted((a, b) -> Integer.compare(statsTracker.getKills(b), statsTracker.getKills(a)))
                        .collect(Collectors.toList());
                        
                topDeaths = tracked.stream()
                        .sorted((a, b) -> Integer.compare(statsTracker.getDeaths(b), statsTracker.getDeaths(a)))
                        .collect(Collectors.toList());
                        
                topKd = tracked.stream()
                        .sorted((a, b) -> Double.compare(getKd(b), getKd(a)))
                        .collect(Collectors.toList());
            } catch (Throwable e) {
                topKills = null;
                topDeaths = null;
                topKd = null;
            }
        }
    }
    
    private double getKd(String nick) {
        int k = statsTracker.getKills(nick);
        int d = statsTracker.getDeaths(nick);
        return d == 0 ? k : (double) k / d;
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
                com.palmergames.bukkit.towny.object.Resident res = TownyAPI.getInstance().getResident(player.getUniqueId());
                if (res == null && player.getName() != null) {
                    res = TownyAPI.getInstance().getResident(player.getName());
                }
                Town town = res != null ? res.getTownOrNull() : null;
                return town != null ? town.getName() : "&7Отсутствует";
            } catch (Throwable e) {
                return "&7Отсутствует";
            }
        }
        
        if (params.startsWith("top_")) {
            updateTopsIfNeeded();
            
            boolean isName = params.contains("_name_");
            boolean isValue = params.contains("_value_");
            
            // Если не указано name или value, считаем что это name для обратной совместимости
            if (!isName && !isValue) {
                isName = true;
            }
            
            try {
                String[] parts = params.split("_");
                int index = Integer.parseInt(parts[parts.length - 1]) - 1;
                
                if (params.contains("top_residents")) {
                    if (topResidents == null || index < 0 || index >= topResidents.size()) return "---";
                    Town t = topResidents.get(index);
                    return isName ? t.getName() : String.valueOf(t.getNumResidents());
                }
                
                if (params.contains("top_territory")) {
                    if (topTownBlocks == null || index < 0 || index >= topTownBlocks.size()) return "---";
                    Town t = topTownBlocks.get(index);
                    return isName ? t.getName() : String.valueOf(t.getTownBlocks().size());
                }
                
                if (params.contains("top_balance")) {
                    if (topBalance == null || index < 0 || index >= topBalance.size()) return "---";
                    Town t = topBalance.get(index);
                    return isName ? t.getName() : String.format("%.2f", t.getAccount().getHoldingBalance());
                }
                
                if (params.contains("top_kills")) {
                    if (topKills == null || index < 0 || index >= topKills.size()) return "---";
                    String p = topKills.get(index);
                    return isName ? p : String.valueOf(statsTracker.getKills(p));
                }

                if (params.contains("top_deaths")) {
                    if (topDeaths == null || index < 0 || index >= topDeaths.size()) return "---";
                    String p = topDeaths.get(index);
                    return isName ? p : String.valueOf(statsTracker.getDeaths(p));
                }

                if (params.contains("top_kd")) {
                    if (topKd == null || index < 0 || index >= topKd.size()) return "---";
                    String p = topKd.get(index);
                    return isName ? p : String.format("%.2f", getKd(p));
                }
            } catch (Exception e) {}
            return "---";
        }

        return null;
    }
}
