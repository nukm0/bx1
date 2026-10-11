# Барахолка — Telegram Mini App маркетплейс

Репозиторий содержит frontend, Express API и Prisma/PostgreSQL. Telegram-бот запускается отдельно на ПК из архива `baraholka-bot-pc.zip`.

## Что есть в проекте

- React/Vite интерфейс Telegram Mini App в стиле современного городского маркетплейса.
- Express API, проверка подписи Telegram `initData`, PostgreSQL/Prisma.
- Объявления и модерация, профили, подписки/уведомления, отзывы, жалобы.
- Запросы на поднятие объявления через `@nukm0` (оплата автоматически не подключена).
- Роли, запросы на бан с доказательствами и решение владельца, муты.
- Заявки на магазины и роль партнёра, рекламные баннеры, аудит действий.
- Номер телефона хранится отдельно и не включён в публичный профиль.

> Это исходный starter-проект. До публичного запуска пройдите список «Перед запуском» ниже: интерфейсы некоторых функций и production-интеграции требуют доработки, а не все заявленные функции полностью готовы к production.

## Развёртывание

### 1. База данных
Создайте PostgreSQL в Neon/Supabase/Render. Возьмите connection string и сохраните в переменную `DATABASE_URL` сервера API. Не публикуйте её.

### 2. Backend API
Разверните Node.js сервис из этого репозитория на Render/Railway/Fly.io/VPS. Build: `npm install`; Start: `npm run start -w @baraholka/api` (добавьте script start: `node src/index.js` в `apps/api/package.json`, если его нет). Добавьте env:
- `DATABASE_URL`
- `BOT_TOKEN` — новый токен от BotFather, одинаковый для проверки Telegram Mini App и бота
- `OWNER_TELEGRAM_IDS=998579758`
- `SESSION_SECRET` — случайная длинная строка\n- `BOT_INTERNAL_SECRET` — отдельный длинный случайный секрет, тот же самый, что в `.env` локального бота
- `WEB_ORIGIN=https://bx1-iota.vercel.app`
- `PORT` обычно задаёт хостинг

В `apps/api/package.json` добавьте production-скрипт `start` (если не добавлен):
`"start": "node src/index.js"`.

### 3. Миграция Prisma
Локально из корня:
```bash
npm install
npm run db:generate
npm run db:migrate
```
Если миграции ещё не созданы, выполните `npm run db:migrate` в разработке, подтвердите создание начальной миграции и закоммитьте `apps/api/prisma/migrations/`. На production применяйте `prisma migrate deploy`.

### 4. Frontend на Vercel
Импортируйте GitHub-репозиторий в Vercel. Root Directory: `apps/web`. Build command: `npm run build`; Output Directory: `dist`. Добавьте env `VITE_API_URL=https://ВАШ-API-ДОМЕН`. Если Vercel собирает проект с корня монорепозитория, настройте install command `npm install` в корне.
После изменения env пересоберите deployment.

### 5. Telegram
В BotFather укажите Mini App URL `https://bx1-iota.vercel.app`. Бот запускается отдельно на ПК. В `WEB_ORIGIN` API должен точно совпадать с адресом сайта.

## Запуск локально (Windows)
1. Установите Node.js 20 LTS.
2. Склонируйте репозиторий и распакуйте бот рядом с ним.
3. В корне проекта: `npm install`.
4. Создайте `.env` на основе `.env.example`, задайте `DATABASE_URL`, новый `BOT_TOKEN`, `OWNER_TELEGRAM_IDS=998579758`, `WEB_ORIGIN`.
5. Запустите PostgreSQL и миграции.
6. `npm run dev` запускает API и frontend; бот запускается из своей папки отдельно.

### Статистика и подтверждение банов в Telegram\nBackend предоставляет приватные endpoints для бота, защищённые `BOT_INTERNAL_SECRET`. Задайте одинаковый секрет на API-хостинге и в локальном `.env` бота. Не используйте токен бота как этот секрет.\n\n## Безопасность
- Никогда не добавляйте `.env`, токены или строки подключения к БД в GitHub.
- Токен, который ранее был отправлен в чат, нужно отозвать в BotFather и заменить.
- Владелец определяется по числовому Telegram ID `998579758`, не по username.
- Telegram username может меняться; используйте Telegram ID для прав.
- Публичные данные профиля не должны включать телефон.
- Перед запуском настройте rate limiting, приватное хранилище изображений, резервные копии, логирование, CORS, HTTPS и тесты.
