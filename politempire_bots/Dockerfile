FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bot ./bot

# .env подключается через env_file в docker-compose
CMD ["python", "-m", "bot.main"]
