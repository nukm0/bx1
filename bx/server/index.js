import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'data.json');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const seed = [
  { id: '1', title: 'Винтажный фотоаппарат', price: 4500, category: 'Электроника', city: 'Москва', description: 'Рабочий фотоаппарат в хорошем состоянии. В комплекте ремешок.', image: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800', seller: 'Алексей', createdAt: Date.now() },
  { id: '2', title: 'Кресло в скандинавском стиле', price: 7200, category: 'Дом и сад', city: 'Санкт-Петербург', description: 'Удобное кресло, есть небольшие следы использования.', image: 'https://images.unsplash.com/photo-1503602642458-232111445657?w=800', seller: 'Мария', createdAt: Date.now() - 10000 },
  { id: '3', title: 'Кроссовки, размер ების', price: 2500, category: 'Одежда', city: 'Казань', description: 'Почти новые, надевал пару раз.', image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800', seller: 'Денис', createdAt: Date.now() - 20000 },
  { id: '4', title: 'Настольная лампа', price: 900, category: 'Дом и сад', city: 'Москва', description: 'Минималистичная лампа, отлично работает.', image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800', seller: 'Ольга', createdAt: Date.now() - 30000 }
];

function readListings() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2)); return seed; }
}
function saveListings(items) { fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2)); }

// Проверка подписи Telegram Web App initData.
// Для локального демо разрешаем запросы без initData; перед публикацией задайте BOT_TOKEN.
function verifyTelegramInitData(initData) {
  const token = process.env.BOT_TOKEN;
  if (!token || !initData) return !token; // Без токена работает только демо-режим.
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    params.delete('hash');
    const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calculated, 'hex'));
  } catch { return false; }
}
function telegramGuard(req, res, next) {
  if (!process.env.BOT_TOKEN) return next();
  const initData = req.get('x-telegram-init-data') || '';
  if (!verifyTelegramInitData(initData)) return res.status(401).json({ error: 'Не удалось проверить Telegram-пользователя' });
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/listings', (_req, res) => {
  const { q = '', category = 'Все', city = '' } = _req.query;
  const query = String(q).toLowerCase();
  const items = readListings().filter(x =>
    (category === 'Все' || x.category === category) &&
    (!city || x.city.toLowerCase().includes(String(city).toLowerCase())) &&
    (!query || `${x.title} ${x.description} ${x.city}`.toLowerCase().includes(query))
  ).sort((a, b) => b.createdAt - a.createdAt);
  res.json(items);
});
app.post('/api/listings', telegramGuard, (req, res) => {
  const { title, price, category, city, description, image, seller } = req.body || {};
  if (!title?.trim() || !Number.isFinite(Number(price)) || Number(price) < 0 || !category || !city?.trim()) {
    return res.status(400).json({ error: 'Заполните название, цену, категорию и город' });
  }
  const items = readListings();
  const listing = {
    id: crypto.randomUUID(), title: title.trim().slice(0, 100), price: Number(price),
    category, city: city.trim().slice(0, 80), description: String(description || '').slice(0, 2000),
    image: String(image || '').slice(0, 1000), seller: String(seller || 'Пользователь').slice(0, 80), createdAt: Date.now()
  };
  items.push(listing); saveListings(items);
  res.status(201).json(listing);
});
app.get('/api/listings/:id', (req, res) => {
  const item = readListings().find(x => x.id === req.params.id);
  item ? res.json(item) : res.status(404).json({ error: 'Объявление не найдено' });
});
app.listen(PORT, () => console.log(`API запущен: http://localhost:${PORT}`));