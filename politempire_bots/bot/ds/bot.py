"""Discord-бот: персональные инвайты, рефералка, онлайн Minecraft-сервера."""
import logging

import discord
from discord import app_commands
from discord.ext import tasks
from mcstatus import JavaServer

from bot import config, db
from bot.services import referrals

log = logging.getLogger("ds")

intents = discord.Intents.default()
intents.members = True
intents.invites = True
# Для чтения новостного канала (нужен Message Content Intent в Developer Portal)
intents.message_content = True


class PolitEmpireBot(discord.Client):
    def __init__(self) -> None:
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        self._invite_uses: dict[str, int] = {}
        self._last_channel_name: str | None = None
        self._rename_cooldown = 0

    async def setup_hook(self) -> None:
        guild = discord.Object(id=config.DISCORD_GUILD_ID)
        try:
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        except discord.Forbidden:
            log.error(
                "Не удалось синхронизировать slash-команды (403 Missing Access): "
                "проверьте DISCORD_GUILD_ID и перепригласите бота со scope "
                "'applications.commands'. Бот продолжает работу без slash-команд."
            )
        except Exception:
            log.exception("Слэш-команды не синхронизированы; продолжаем без них")
        self.update_online.start()
        if config.DISCORD_ANTICHEAT_CHANNEL_ID:
            self.post_anticheat.start()

    async def on_ready(self) -> None:
        log.info("Discord bot ready as %s", self.user)
        await self._cache_invites()
        await self._backfill_news()

    # ---------- Новости для лаунчера ----------

    @staticmethod
    def _news_image(message: discord.Message) -> str | None:
        for att in message.attachments:
            if (att.content_type or "").startswith("image/"):
                return att.url
        for emb in message.embeds:
            if emb.image and emb.image.url:
                return emb.image.url
            if emb.thumbnail and emb.thumbnail.url:
                return emb.thumbnail.url
        return None

    async def _save_news(self, message: discord.Message) -> None:
        content = (message.content or "").strip()
        image = self._news_image(message)
        if not content and not image:
            return
        await db.execute(
            "INSERT INTO bot_news (message_id, author, content, image_url, posted_at) "
            "VALUES (%s, %s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE content=VALUES(content), image_url=VALUES(image_url), "
            "author=VALUES(author)",
            (
                message.id,
                message.author.display_name[:100],
                content,
                image,
                message.created_at.replace(tzinfo=None),
            ),
        )

    async def _backfill_news(self) -> None:
        """Подтягивает последние посты канала новостей при старте."""
        if not config.DISCORD_NEWS_CHANNEL_ID:
            return
        channel = self.get_channel(config.DISCORD_NEWS_CHANNEL_ID)
        if channel is None:
            log.warning("News channel %s not found", config.DISCORD_NEWS_CHANNEL_ID)
            return
        try:
            async for message in channel.history(limit=config.NEWS_BACKFILL_LIMIT):
                await self._save_news(message)
            log.info("News backfill done from #%s", getattr(channel, "name", "?"))
        except discord.Forbidden:
            log.error("No permission to read news channel history")
        except Exception:
            log.exception("News backfill failed")

    async def on_message(self, message: discord.Message) -> None:
        if message.channel.id == config.DISCORD_NEWS_CHANNEL_ID and not message.author.bot:
            try:
                await self._save_news(message)
            except Exception:
                log.exception("Failed to save news post")

    async def on_raw_message_edit(self, payload: discord.RawMessageUpdateEvent) -> None:
        if payload.channel_id != config.DISCORD_NEWS_CHANNEL_ID:
            return
        channel = self.get_channel(payload.channel_id)
        if channel is None:
            return
        try:
            message = await channel.fetch_message(payload.message_id)
            await self._save_news(message)
        except Exception:
            log.exception("Failed to update edited news post")

    async def on_raw_message_delete(self, payload: discord.RawMessageDeleteEvent) -> None:
        if payload.channel_id != config.DISCORD_NEWS_CHANNEL_ID:
            return
        try:
            await db.execute("DELETE FROM bot_news WHERE message_id=%s", (payload.message_id,))
        except Exception:
            log.exception("Failed to delete news post")

    async def _cache_invites(self) -> None:
        guild = self.get_guild(config.DISCORD_GUILD_ID)
        if not guild:
            return
        try:
            invites = await guild.invites()
            self._invite_uses = {i.code: i.uses or 0 for i in invites}
        except discord.Forbidden:
            log.error("No permission to read invites (need Manage Server)")

    async def on_invite_create(self, invite: discord.Invite) -> None:
        self._invite_uses[invite.code] = invite.uses or 0

    async def on_invite_delete(self, invite: discord.Invite) -> None:
        self._invite_uses.pop(invite.code, None)

    async def on_member_join(self, member: discord.Member) -> None:
        """Определяем, по какому инвайту вступил пользователь, сравнивая счётчики uses."""
        if member.guild.id != config.DISCORD_GUILD_ID or member.bot:
            return
        used_code = None
        try:
            invites = await member.guild.invites()
        except discord.Forbidden:
            invites = []
        current = {i.code: i.uses or 0 for i in invites}
        for code, uses in current.items():
            if uses > self._invite_uses.get(code, 0):
                used_code = code
                break
        self._invite_uses = current

        inviter_discord_id = None
        if used_code:
            row = await db.fetchone(
                "SELECT discord_id FROM bot_discord_invites WHERE invite_code=%s",
                (used_code,),
            )
            if row:
                inviter_discord_id = row["discord_id"]

        counted = await referrals.register_join(member.id, used_code, inviter_discord_id)
        log.info(
            "Member %s joined via %s (inviter=%s, counted=%s)",
            member.id, used_code, inviter_discord_id, counted,
        )

    # ---------- Онлайн Minecraft ----------

    async def _fetch_status(self) -> tuple[bool, int, int]:
        try:
            server = await JavaServer.async_lookup(f"{config.MC_HOST}:{config.MC_PORT}")
            status = await server.async_status()
            return True, status.players.online, status.players.max
        except Exception:
            return False, 0, 0

    @tasks.loop(seconds=config.ONLINE_UPDATE_INTERVAL)
    async def update_online(self) -> None:
        online, players, slots = await self._fetch_status()
        # Статус бота
        activity = discord.Activity(
            type=discord.ActivityType.watching,
            name=f"онлайн: {players}/{slots}" if online else "сервер офлайн",
        )
        try:
            await self.change_presence(activity=activity)
        except Exception:
            pass
        # Название канала (не чаще раза в CHANNEL_RENAME_INTERVAL из-за лимитов Discord)
        if config.DISCORD_STATUS_CHANNEL_ID:
            self._rename_cooldown -= config.ONLINE_UPDATE_INTERVAL
            if self._rename_cooldown > 0:
                return
            name = f"🟢 Онлайн: {players}/{slots}" if online else "🔴 Сервер офлайн"
            if name == self._last_channel_name:
                return
            channel = self.get_channel(config.DISCORD_STATUS_CHANNEL_ID)
            if channel:
                try:
                    await channel.edit(name=name)
                    self._last_channel_name = name
                    self._rename_cooldown = config.CHANNEL_RENAME_INTERVAL
                except Exception:
                    log.exception("Failed to rename status channel")

    @update_online.before_loop
    async def before_update_online(self) -> None:
        await self.wait_until_ready()

    # ---------- Логи античита ----------

    @staticmethod
    def _anticheat_view(kind: str, detail: str) -> tuple[str, int]:
        """Человекочитаемый заголовок и цвет embed по типу события."""
        # (подпись, критичность 0-2) — критичность определяет цвет
        table: dict[str, tuple[str, int]] = {
            # служебные события защиты
            "anticheat_started": ("Защита запущена в процессе игры", 0),
            "inject_ok": ("Защита активна (модуль внедрён)", 0),
            "inject_failed": ("Не удалось внедрить защиту", 1),
            "dll_prepare_failed": ("Модуль защиты недоступен", 1),
            # нарушения из DLL (внутри процесса игры)
            "injected_module": ("Инжект постороннего кода в игру", 2),
            "cheat_module": ("Чит-модуль в процессе игры", 2),
            "suspicious_module": ("Подозрительный модуль в процессе игры", 2),
            "debugger": ("К игре подключён отладчик", 2),
            "overlay_blocked": ("Заблокирован оверлей поверх игры (чит завершён)", 2),
            # нарушения из внешнего монитора лаунчера
            "external_process": ("Запущен сторонний чит/инжектор", 2),
            # автоматический бан по железу (3 попытки инжекта)
            "hwid_banned": ("Игрок забанен по железу (3 попытки инжекта)", 2),
        }
        label, sev = table.get(kind, (kind, 1))
        color = {0: 0x2ECC71, 1: 0xE67E22, 2: 0xE74C3C}[sev]
        return label, color

    @tasks.loop(seconds=config.ANTICHEAT_POLL_INTERVAL)
    async def post_anticheat(self) -> None:
        channel = self.get_channel(config.DISCORD_ANTICHEAT_CHANNEL_ID)
        if channel is None:
            return
        try:
            rows = await db.fetchall(
                "SELECT id, minecraft_nick, hwid, kind, detail, source, created_at "
                "FROM anticheat_events WHERE posted=0 ORDER BY id ASC LIMIT 20"
            )
        except Exception:
            log.exception("Anticheat: failed to read events")
            return
        if not rows:
            return

        posted_ids: list[int] = []
        for row in rows:
            label, color = self._anticheat_view(row["kind"], row["detail"] or "")
            embed = discord.Embed(
                title=f"🛡 {label}",
                colour=color,
                timestamp=row["created_at"],
            )
            embed.add_field(name="Игрок", value=f"`{row['minecraft_nick'] or '—'}`", inline=True)
            embed.add_field(name="Источник", value=row["source"] or "dll", inline=True)
            if row["hwid"]:
                # Показываем HWID ПОЛНОСТЬЮ и отдельным блоком, чтобы его можно
                # было скопировать одним тапом и забанить через бота.
                embed.add_field(
                    name="HWID (для бана)",
                    value=f"```{row['hwid']}```",
                    inline=False,
                )
            if row["detail"]:
                embed.add_field(name="Детали", value=str(row["detail"])[:1024], inline=False)
            embed.set_footer(text=f"event #{row['id']} · тип: {row['kind']}")
            try:
                await channel.send(embed=embed)
                posted_ids.append(row["id"])
            except discord.Forbidden:
                log.error("Anticheat: no permission to post in channel %s",
                          config.DISCORD_ANTICHEAT_CHANNEL_ID)
                return
            except Exception:
                log.exception("Anticheat: failed to send event %s", row["id"])

        if posted_ids:
            placeholders = ",".join(["%s"] * len(posted_ids))
            await db.execute(
                f"UPDATE anticheat_events SET posted=1 WHERE id IN ({placeholders})",
                tuple(posted_ids),
            )

    @post_anticheat.before_loop
    async def before_post_anticheat(self) -> None:
        await self.wait_until_ready()


client = PolitEmpireBot()


@client.tree.command(name="invite", description="Получить персональную пригласительную ссылку")
async def cmd_invite(interaction: discord.Interaction) -> None:
    row = await db.fetchone(
        "SELECT invite_code FROM bot_discord_invites WHERE discord_id=%s",
        (interaction.user.id,),
    )
    if row:
        await interaction.response.send_message(
            f"Ваша ссылка: https://discord.gg/{row['invite_code']}", ephemeral=True
        )
        return
    guild = interaction.guild
    channel = guild.system_channel or next(
        (c for c in guild.text_channels if c.permissions_for(guild.me).create_instant_invite),
        None,
    )
    if channel is None:
        await interaction.response.send_message(
            "Не удалось создать инвайт: нет подходящего канала.", ephemeral=True
        )
        return
    invite = await channel.create_invite(max_age=0, max_uses=0, unique=True,
                                         reason=f"Referral invite for {interaction.user}")
    await db.execute(
        "INSERT INTO bot_discord_invites (invite_code, discord_id) VALUES (%s, %s)",
        (invite.code, interaction.user.id),
    )
    client._invite_uses[invite.code] = 0
    await interaction.response.send_message(
        f"Ваша персональная ссылка: {invite.url}\n"
        f"Приглашение засчитывается, когда приглашённый зайдёт на Minecraft-сервер "
        f"и проведёт там не менее 10 минут.",
        ephemeral=True,
    )


@client.tree.command(name="link", description="Привязать ник Minecraft для получения наград")
@app_commands.describe(nickname="Ваш ник на Minecraft-сервере")
async def cmd_link(interaction: discord.Interaction, nickname: str) -> None:
    nickname = nickname.strip()
    user = await db.fetchone("SELECT minecraft_nick FROM users WHERE minecraft_nick=%s", (nickname,))
    if not user:
        await interaction.response.send_message(
            "Такой ник не зарегистрирован. Сначала зарегистрируйтесь в Telegram-боте.",
            ephemeral=True,
        )
        return
    taken = await db.fetchone(
        "SELECT discord_id FROM bot_discord_links WHERE mc_username=%s", (nickname,)
    )
    if taken and taken["discord_id"] != interaction.user.id:
        await interaction.response.send_message(
            "Этот ник уже привязан к другому Discord-аккаунту.", ephemeral=True
        )
        return
    await db.execute(
        "INSERT INTO bot_discord_links (discord_id, mc_username) VALUES (%s, %s) "
        "ON DUPLICATE KEY UPDATE mc_username=VALUES(mc_username)",
        (interaction.user.id, nickname),
    )
    # Привязываем ник к записи реферала, если этот пользователь был приглашён
    await referrals.attach_mc_username(interaction.user.id, nickname)
    await interaction.response.send_message(
        f"Ник **{nickname}** привязан. Награды за рефералов будут выдаваться на него.",
        ephemeral=True,
    )


@client.tree.command(name="referrals", description="Моя реферальная статистика")
async def cmd_referrals(interaction: discord.Interaction) -> None:
    stats = await referrals.stats_for_inviter(interaction.user.id)
    await interaction.response.send_message(
        f"Приглашено: {stats['total']}\n"
        f"Выполнили условия: {stats['completed']}\n"
        f"Награждено: {stats['rewarded']}",
        ephemeral=True,
    )


@client.tree.command(name="online", description="Онлайн Minecraft-сервера")
async def cmd_online(interaction: discord.Interaction) -> None:
    online, players, slots = await client._fetch_status()
    if online:
        text = f"🟢 Сервер онлайн\nИгроков: {players}/{slots}"
    else:
        text = "🔴 Сервер офлайн"
    await interaction.response.send_message(text)


async def start_discord_bot() -> None:
    await client.start(config.DISCORD_TOKEN)
