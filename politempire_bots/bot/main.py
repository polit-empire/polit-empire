"""Точка входа: запускает Telegram-бота, Discord-бота и HTTP API вместе.

Запуск: python -m bot.main
"""
import asyncio
import logging

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.enums import ParseMode

from bot import config, db
from bot.api.server import start_api
from bot.ds.bot import start_discord_bot
from bot.services import bans
from bot.tg import notify
from bot.tg.handlers import create_dispatcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
log = logging.getLogger("main")


async def main() -> None:
    await db.init_pool()
    log.info("Database connected, bot tables ensured")

    # Если api.telegram.org заблокирован у хостинга, подключаемся через прокси.
    tg_session = None
    if config.TG_PROXY:
        log.info("Telegram: используем прокси %s", config.TG_PROXY)
        tg_session = AiohttpSession(proxy=config.TG_PROXY)
    tg_bot = Bot(
        token=config.TG_BOT_TOKEN,
        session=tg_session,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    notify.set_bot(tg_bot)
    dp = create_dispatcher()

    # Бот работает через long polling и заменяет старый webhook-бот сайта:
    # снимаем webhook, иначе Telegram не будет отдавать обновления polling'у.
    # Делаем это best-effort с повторами: временный сетевой сбой до
    # api.telegram.org не должен ронять весь процесс (и Discord-бота вместе с ним).
    for attempt in range(1, 6):
        try:
            await tg_bot.delete_webhook(drop_pending_updates=True)
            break
        except Exception as err:
            log.warning(
                "delete_webhook failed (attempt %s/5): %s. Повтор через 5 c.",
                attempt, err,
            )
            await asyncio.sleep(5)
    else:
        log.error(
            "Не удалось снять webhook Telegram после 5 попыток. "
            "Продолжаем запуск: polling сам переподключится, когда сеть восстановится."
        )

    await start_api()

    tasks = [
        asyncio.create_task(dp.start_polling(tg_bot), name="telegram"),
        asyncio.create_task(start_discord_bot(), name="discord"),
        asyncio.create_task(bans.sync_loop(), name="ban-sync"),
    ]
    try:
        # return_exceptions=True: сбой одной задачи (например Telegram при
        # потере сети) не должен отменять остальные (Discord, ban-sync).
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for task, result in zip(tasks, results):
            if isinstance(result, Exception):
                log.error("Задача %s завершилась с ошибкой: %s", task.get_name(), result)
    finally:
        await db.close_pool()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        log.info("Shutting down")
