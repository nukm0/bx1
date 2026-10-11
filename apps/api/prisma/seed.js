import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
await prisma.$connect();
console.log('Database connection OK. Add demo listings through the app after Telegram auth is configured.');
await prisma.$disconnect();
