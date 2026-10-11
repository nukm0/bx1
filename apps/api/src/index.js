import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import crypto from 'node:crypto';

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env.PORT || 3001);
app.use(helmet());
app.use(cors({ origin: process.env.WEB_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));

// Validate Telegram Web App initData. Never trust initDataUnsafe or a client-supplied user ID.
function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const p = new URLSearchParams(initData);
    const hash = p.get('hash');
    const authDate = Number(p.get('auth_date'));
    if (!hash || !authDate || Math.abs(Date.now()/1000 - authDate) > 86400) return null;
    p.delete('hash');
    const check = [...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256','WebAppData').update(botToken).digest();
    const calculated = crypto.createHmac('sha256',secret).update(check).digest('hex');
    const a = Buffer.from(hash, 'hex'), b = Buffer.from(calculated, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return null;
    const user = JSON.parse(p.get('user') || '{}');
    if (!user.id) return null;
    return user;
  } catch { return null; }
}
async function auth(req,res,next) {
  const telegramUser = validateInitData(req.get('x-telegram-init-data'), process.env.BOT_TOKEN);
  if (!telegramUser) return res.status(401).json({error:'Откройте приложение через Telegram'});
  try {
    req.tg = telegramUser;
    req.user = await prisma.user.upsert({
      where:{telegramId:String(telegramUser.id)},
      update:{username:telegramUser.username || null, firstName:telegramUser.first_name || 'Пользователь', lastName:telegramUser.last_name || null, photoUrl:telegramUser.photo_url || null},
      create:{telegramId:String(telegramUser.id),username:telegramUser.username || null,firstName:telegramUser.first_name || 'Пользователь',lastName:telegramUser.last_name || null,photoUrl:telegramUser.photo_url || null}
    });
    if (req.user.bannedAt) return res.status(403).json({error:'Доступ к Барахолке ограничен'});
    if (req.user.mutedUntil && req.user.mutedUntil > new Date() && ['POST','PATCH','DELETE'].includes(req.method)) return res.status(403).json({error:'Ваш аккаунт временно ограничен'});
    next();
  } catch(e) { next(e); }
}
const hasRole = (user, ...roles) => roles.some(r => user.roles.includes(r));
const requireRole = (...roles) => (req,res,next) => hasRole(req.user, ...roles) ? next() : res.status(403).json({error:'Недостаточно прав'});
const isOwner = req => (process.env.OWNER_TELEGRAM_IDS || '').split(',').map(x=>x.trim()).includes(String(req.tg.id));
const requireOwner = (req,res,next) => isOwner(req) ? next() : res.status(403).json({error:'Только владелец может выполнить это действие'});
const phoneSchema = z.string().regex(/^\+7\d{10}$/, 'Заходите с русского номера (+7)');

app.get('/api/health', (_req,res)=>res.json({ok:true}));
app.get('/api/listings', async (req,res,next)=>{
  try {
    const {q,city,category} = req.query;
    const rows = await prisma.listing.findMany({
      where:{status:'ACTIVE', ...(city?{city:{contains:String(city),mode:'insensitive'}}:{}), ...(category && category!=='Все'?{category:String(category)}:{}), ...(q?{OR:[{title:{contains:String(q),mode:'insensitive'}},{description:{contains:String(q),mode:'insensitive'}}]}:{})},
      include:{seller:{select:{id:true,username:true,firstName:true,photoUrl:true,city:true}}},
      orderBy:[{isPromoted:'desc'},{createdAt:'desc'}], take:100
    });
    res.json(rows);
  } catch(e){next(e);}
});
app.post('/api/contact',auth,async(req,res,next)=>{
  try {
    // Only accept Telegram's native contact object; never trust a typed phone number.
    const c = req.body?.contact;
    if (!c?.phone_number || String(c.user_id)!==String(req.tg.id)) return res.status(400).json({error:'Поделитесь своим контактом через кнопку Telegram'});
    const raw = String(c.phone_number).replace(/[()\s-]/g,'');
    const normalized = raw.startsWith('8') ? '+7'+raw.slice(1) : raw.startsWith('7') ? '+'+raw : raw;
    const parsed = phoneSchema.safeParse(normalized);
    if (!parsed.success) return res.status(400).json({error:'Заходите с русского номера (+7)'});
    await prisma.user.update({where:{id:req.user.id},data:{phone:parsed.data,phoneVerified:true}});
    res.json({ok:true});
  } catch(e){next(e);}
});
app.get('/api/me',auth,async(req,res)=>{
  const [listingCount, followers, reviews] = await Promise.all([
    prisma.listing.count({where:{sellerId:req.user.id}}), prisma.follow.count({where:{followedId:req.user.id}}),
    prisma.review.findMany({where:{targetId:req.user.id},select:{rating:true,verifiedDeal:true}})
  ]);
  res.json({id:req.user.id,telegramId:req.user.telegramId,username:req.user.username,firstName:req.user.firstName,lastName:req.user.lastName,photoUrl:req.user.photoUrl,city:req.user.city,roles:req.user.roles,listingCount,followers,reviewCount:reviews.length,averageRating:reviews.length?reviews.reduce((s,r)=>s+r.rating,0)/reviews.length:null,verifiedReviews:reviews.filter(r=>r.verifiedDeal).length});
});
app.get('/api/users/:id',auth,async(req,res,next)=>{
  try {
    const u=await prisma.user.findUnique({where:{id:req.params.id},select:{id:true,telegramId:true,username:true,firstName:true,lastName:true,photoUrl:true,city:true,createdAt:true,roles:true}});
    if(!u)return res.status(404).json({error:'Пользователь не найден'});
    const [listingCount,followers,reviews,activeListings]=await Promise.all([
      prisma.listing.count({where:{sellerId:u.id,status:'ACTIVE'}}),prisma.follow.count({where:{followedId:u.id}}),
      prisma.review.findMany({where:{targetId:u.id},select:{rating:true,verifiedDeal:true}}),
      prisma.listing.findMany({where:{sellerId:u.id,status:'ACTIVE'},orderBy:{createdAt:'desc'},take:12})
    ]);
    res.json({...u,listingCount,followers,reviewCount:reviews.length,averageRating:reviews.length?reviews.reduce((s,r)=>s+r.rating,0)/reviews.length:null,verifiedReviews:reviews.filter(r=>r.verifiedDeal).length,activeListings});
  }catch(e){next(e);}
});
app.post('/api/listings',auth,async(req,res,next)=>{
  try{
    if(!req.user.phoneVerified)return res.status(403).json({error:'Сначала подтвердите российский номер телефона (+7)'});
    const schema=z.object({title:z.string().trim().min(3).max(100),description:z.string().max(3000).default(''),price:z.number().int().min(0).max(100000000),city:z.string().trim().min(2).max(100),category:z.string().min(1).max(50),images:z.array(z.string().url()).max(8).default([])});
    const d=schema.parse(req.body);
    const listing=await prisma.listing.create({data:{...d,sellerId:req.user.id,status:'PENDING'}});
    const followers=await prisma.follow.findMany({where:{followedId:req.user.id},select:{followerId:true}});
    if(followers.length)await prisma.notification.createMany({data:followers.map(f=>({userId:f.followerId,type:'NEW_LISTING',title:'Новое объявление',body:`${req.user.firstName}: ${d.title}`,url:`/listing/${listing.id}`}))});
    res.status(201).json({listing,message:'Объявление отправлено на модерацию'});
  }catch(e){next(e);}
});
app.post('/api/users/:id/follow',auth,async(req,res,next)=>{
  try{if(req.params.id===req.user.id)return res.status(400).json({error:'Нельзя подписаться на себя'});const row=await prisma.follow.upsert({where:{followerId_followedId:{followerId:req.user.id,followedId:req.params.id}},create:{followerId:req.user.id,followedId:req.params.id},update:{}});res.json({ok:true,row});}catch(e){next(e);}
});
app.delete('/api/users/:id/follow',auth,async(req,res,next)=>{
  try{await prisma.follow.deleteMany({where:{followerId:req.user.id,followedId:req.params.id}});res.json({ok:true});}catch(e){next(e);}
});
app.get('/api/notifications',auth,async(req,res,next)=>{
  try{res.json(await prisma.notification.findMany({where:{userId:req.user.id},orderBy:{createdAt:'desc'},take:100}));}catch(e){next(e);}
});
app.post('/api/reports',auth,async(req,res,next)=>{
  try{const d=z.object({listingId:z.string(),reason:z.string().min(5).max(1000),evidenceUrls:z.array(z.string().url()).max(5).default([])}).parse(req.body);res.status(201).json(await prisma.report.create({data:{...d,reporterId:req.user.id}}));}catch(e){next(e);}
});
app.post('/api/admin/mute',auth,requireRole('MODERATOR','ADMIN','OWNER'),async(req,res,next)=>{
  try{const d=z.object({telegramId:z.string(),hours:z.number().int().min(1).max(720),reason:z.string().min(5).max(1000)}).parse(req.body);const target=await prisma.user.findUnique({where:{telegramId:d.telegramId}});if(!target)return res.status(404).json({error:'Пользователь не найден'});const until=new Date(Date.now()+d.hours*3600000);await prisma.user.update({where:{id:target.id},data:{mutedUntil:until}});await prisma.auditLog.create({data:{actorId:req.user.id,action:'MUTE',targetType:'User',targetId:target.id,metadata:{until:until.toISOString(),reason:d.reason}}});res.json({ok:true,mutedUntil:until});}catch(e){next(e);}
});
app.post('/api/admin/ban-requests',auth,requireRole('MODERATOR','ADMIN','OWNER'),async(req,res,next)=>{
  try{const d=z.object({telegramId:z.string(),reason:z.string().min(10).max(2000),evidenceUrls:z.array(z.string().url()).min(1).max(10)}).parse(req.body);const target=await prisma.user.findUnique({where:{telegramId:d.telegramId}});if(!target)return res.status(404).json({error:'Пользователь не найден'});const request=await prisma.banRequest.create({data:{targetId:target.id,requestedByTelegramId:String(req.tg.id),reason:d.reason,evidenceUrls:d.evidenceUrls}});res.status(201).json({request,message:'Запрос отправлен владельцу. Бан не вступит в силу до подтверждения.'});}catch(e){next(e);}
});
app.get('/api/owner/stats',auth,requireOwner,async(req,res,next)=>{
  try{const [users,listings,activeListings,pendingListings,reports,pendingBans,shops,boosts,followers]=await Promise.all([
    prisma.user.count(),prisma.listing.count(),prisma.listing.count({where:{status:'ACTIVE'}}),prisma.listing.count({where:{status:'PENDING'}}),prisma.report.count({where:{status:'OPEN'}}),prisma.banRequest.count({where:{status:'PENDING'}}),prisma.shop.count({where:{status:'PENDING'}}),prisma.boostRequest.count({where:{status:'REQUESTED'}}),prisma.follow.count()
  ]);res.json({users,listings,activeListings,pendingListings,openReports:reports,pendingBans,pendingShops:shops,pendingBoosts:boosts,followers});}catch(e){next(e);}
});
app.get('/api/owner/ban-requests',auth,requireOwner,async(req,res,next)=>{
  try{res.json(await prisma.banRequest.findMany({where:{status:'PENDING'},include:{target:{select:{telegramId:true,username:true,firstName:true,photoUrl:true}}},orderBy:{createdAt:'asc'}}));}catch(e){next(e);}
});
app.post('/api/owner/ban-requests/:id/decision',auth,requireOwner,async(req,res,next)=>{
  try{const d=z.object({approve:z.boolean(),note:z.string().max(1000).optional()}).parse(req.body);const br=await prisma.banRequest.findUnique({where:{id:req.params.id}});if(!br||br.status!=='PENDING')return res.status(404).json({error:'Запрос не найден или уже рассмотрен'});const result=await prisma.$transaction(async tx=>{const updated=await tx.banRequest.update({where:{id:br.id},data:{status:d.approve?'APPROVED':'REJECTED',decidedByTelegramId:String(req.tg.id),decisionNote:d.note||null,decidedAt:new Date()}});if(d.approve)await tx.user.update({where:{id:br.targetId},data:{bannedAt:new Date()}});await tx.auditLog.create({data:{actorId:req.user.id,action:d.approve?'BAN_APPROVED':'BAN_REJECTED',targetType:'BanRequest',targetId:br.id,metadata:{note:d.note||null}}});return updated;});res.json({ok:true,request:result});}catch(e){next(e);}
});
app.post('/api/owner/roles',auth,requireOwner,async(req,res,next)=>{
  try{const d=z.object({telegramId:z.string(),role:z.enum(['USER','MODERATOR','SHOP_PARTNER','ADMIN'])}).parse(req.body);const target=await prisma.user.findUnique({where:{telegramId:d.telegramId}});if(!target)return res.status(404).json({error:'Пользователь не найден'});const roles=[...new Set([...target.roles.filter(r=>r!=='USER'),d.role])];const updated=await prisma.user.update({where:{id:target.id},data:{roles}});await prisma.auditLog.create({data:{actorId:req.user.id,action:'ROLE_GRANTED',targetType:'User',targetId:target.id,metadata:{role:d.role}}});res.json({ok:true,roles:updated.roles});}catch(e){next(e);}
});
app.post('/api/shops',auth,async(req,res,next)=>{
  try{if(!req.user.phoneVerified)return res.status(403).json({error:'Сначала подтвердите номер +7'});const d=z.object({title:z.string().min(2).max(100),description:z.string().max(2000),city:z.string().min(2).max(100),logoUrl:z.string().url().optional()}).parse(req.body);res.status(201).json(await prisma.shop.create({data:{...d,ownerId:req.user.id}}));}catch(e){next(e);}
});
app.post('/api/boost-requests',auth,async(req,res,next)=>{
  try{const d=z.object({listingId:z.string(),amountRub:z.number().int().min(1).max(100000)}).parse(req.body);const listing=await prisma.listing.findUnique({where:{id:d.listingId}});if(!listing||listing.sellerId!==req.user.id)return res.status(404).json({error:'Объявление не найдено'});const request=await prisma.boostRequest.create({data:{...d,userTelegramId:String(req.tg.id)}});res.status(201).json({request,contact:'@nukm0',message:'Заявка создана. Напишите @nukm0 и укажите ID заявки; продвижение включит владелец после подтверждения.'});}catch(e){next(e);}
});

// Public ad ribbon: never exposes inactive/future/expired banners.
app.get('/api/banner',async(_req,res,next)=>{
  try{const now=new Date();const banner=await prisma.adBanner.findFirst({where:{active:true,AND:[{OR:[{startsAt:null},{startsAt:{lte:now}}]},{OR:[{endsAt:null},{endsAt:{gte:now}}]}]},orderBy:{createdAt:'desc'}});res.json(banner);}catch(e){next(e);}
});
// Phone number is deliberately available only through this privileged endpoint.
app.get('/api/admin/users/:telegramId/private',auth,requireRole('ADMIN','OWNER'),async(req,res,next)=>{
  try{const target=await prisma.user.findUnique({where:{telegramId:req.params.telegramId},select:{telegramId:true,username:true,firstName:true,phone:true,phoneVerified:true}});if(!target)return res.status(404).json({error:'Пользователь не найден'});res.json(target);}catch(e){next(e);}
});
app.post('/api/owner/banners',auth,requireOwner,async(req,res,next)=>{
  try{const d=z.object({title:z.string().min(2).max(120),imageUrl:z.string().url().optional(),targetUrl:z.string().url().optional(),active:z.boolean().default(false),startsAt:z.string().datetime().optional(),endsAt:z.string().datetime().optional()}).parse(req.body);const banner=await prisma.adBanner.create({data:{...d,startsAt:d.startsAt?new Date(d.startsAt):null,endsAt:d.endsAt?new Date(d.endsAt):null}});await prisma.auditLog.create({data:{actorId:req.user.id,action:'BANNER_CREATED',targetType:'AdBanner',targetId:banner.id}});res.status(201).json(banner);}catch(e){next(e);}
});
app.post('/api/owner/listings/:id/decision',auth,requireOwner,async(req,res,next)=>{
  try{const d=z.object({approve:z.boolean(),note:z.string().max(1000).optional()}).parse(req.body);const listing=await prisma.listing.findUnique({where:{id:req.params.id}});if(!listing||listing.status!=='PENDING')return res.status(404).json({error:'Объявление не найдено или уже рассмотрено'});const updated=await prisma.listing.update({where:{id:listing.id},data:{status:d.approve?'ACTIVE':'REJECTED'}});await prisma.auditLog.create({data:{actorId:req.user.id,action:d.approve?'LISTING_APPROVED':'LISTING_REJECTED',targetType:'Listing',targetId:listing.id,metadata:{note:d.note||null}}});res.json(updated);}catch(e){next(e);}
});
app.post('/api/owner/shops/:id/decision',auth,requireOwner,async(req,res,next)=>{
  try{const d=z.object({approve:z.boolean()}).parse(req.body);const shop=await prisma.shop.findUnique({where:{id:req.params.id}});if(!shop||shop.status!=='PENDING')return res.status(404).json({error:'Заявка магазина не найдена'});const updated=await prisma.shop.update({where:{id:shop.id},data:{status:d.approve?'APPROVED':'REJECTED'}});if(d.approve){const u=await prisma.user.findUnique({where:{id:shop.ownerId}});if(u&&!u.roles.includes('SHOP_PARTNER'))await prisma.user.update({where:{id:u.id},data:{roles:[...u.roles,'SHOP_PARTNER']}});}await prisma.auditLog.create({data:{actorId:req.user.id,action:d.approve?'SHOP_APPROVED':'SHOP_REJECTED',targetType:'Shop',targetId:shop.id}});res.json(updated);}catch(e){next(e);}
});
app.post('/api/owner/boost-requests/:id/decision',auth,requireOwner,async(req,res,next)=>{
  try{const d=z.object({approve:z.boolean()}).parse(req.body);const br=await prisma.boostRequest.findUnique({where:{id:req.params.id}});if(!br||br.status!=='REQUESTED')return res.status(404).json({error:'Заявка не найдена'});const updated=await prisma.boostRequest.update({where:{id:br.id},data:{status:d.approve?'APPROVED':'REJECTED',resolvedAt:new Date()}});if(d.approve)await prisma.listing.update({where:{id:br.listingId},data:{isPromoted:true,promotedUntil:new Date(Date.now()+7*86400000)}});await prisma.auditLog.create({data:{actorId:req.user.id,action:d.approve?'BOOST_APPROVED':'BOOST_REJECTED',targetType:'BoostRequest',targetId:br.id}});res.json(updated);}catch(e){next(e);}
});


// Private bot-to-API bridge. Configure the same random BOT_INTERNAL_SECRET on API and PC bot.
function internalBotAuth(req,res,next){
  const expected=process.env.BOT_INTERNAL_SECRET;
  const supplied=req.get('x-bot-internal-secret');
  if(!expected || !supplied || supplied.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))){
    return res.status(401).json({error:'Unauthorized'});
  }
  next();
}
app.get('/api/internal/bot/stats',internalBotAuth,async(_req,res,next)=>{
  try{
    const [users,listings,activeListings,pendingListings,reports,pendingBans,shops,boosts]=await Promise.all([
      prisma.user.count(),prisma.listing.count(),prisma.listing.count({where:{status:'ACTIVE'}}),
      prisma.listing.count({where:{status:'PENDING'}}),prisma.report.count({where:{status:'OPEN'}}),
      prisma.banRequest.count({where:{status:'PENDING'}}),prisma.shop.count({where:{status:'PENDING'}}),
      prisma.boostRequest.count({where:{status:'REQUESTED'}})
    ]);
    res.json({users,listings,activeListings,pendingListings,openReports:reports,pendingBans,pendingShops:shops,pendingBoosts:boosts});
  }catch(e){next(e);}
});
app.get('/api/internal/bot/ban-requests',internalBotAuth,async(_req,res,next)=>{
  try{
    res.json(await prisma.banRequest.findMany({where:{status:'PENDING'},include:{target:{select:{telegramId:true,username:true,firstName:true}}},orderBy:{createdAt:'asc'},take:20}));
  }catch(e){next(e);}
});
app.post('/api/internal/bot/ban-requests/:id/decision',internalBotAuth,async(req,res,next)=>{
  try{
    const d=z.object({approve:z.boolean(),decidedByTelegramId:z.string()}).parse(req.body);
    if((process.env.OWNER_TELEGRAM_IDS||'').split(',').map(x=>x.trim()).filter(Boolean).includes(d.decidedByTelegramId)===false)return res.status(403).json({error:'Only owner'});
    const br=await prisma.banRequest.findUnique({where:{id:req.params.id}});
    if(!br||br.status!=='PENDING')return res.status(404).json({error:'Request not pending'});
    const owner=await prisma.user.upsert({
      where:{telegramId:d.decidedByTelegramId},
      update:{},
      create:{telegramId:d.decidedByTelegramId,firstName:'Владелец',roles:['OWNER']}
    });
    const result=await prisma.$transaction(async tx=>{
      const updated=await tx.banRequest.update({where:{id:br.id},data:{status:d.approve?'APPROVED':'REJECTED',decidedByTelegramId:d.decidedByTelegramId,decidedAt:new Date(),decisionNote:'Решение владельца через Telegram-бота'}});
      if(d.approve)await tx.user.update({where:{id:br.targetId},data:{bannedAt:new Date()}});
      await tx.auditLog.create({data:{actorId:owner.id,action:d.approve?'BAN_APPROVED_BOT':'BAN_REJECTED_BOT',targetType:'BanRequest',targetId:br.id}});
      return updated;
    });
    res.json({ok:true,request:result});
  }catch(e){next(e);}
});

app.use((err,req,res,_next)=>{console.error(err?.message || err);if(err instanceof z.ZodError)return res.status(400).json({error:'Проверьте введённые данные',details:err.issues.map(i=>({path:i.path,message:i.message}))});res.status(500).json({error:'Внутренняя ошибка сервера'});});
app.listen(PORT,()=>console.log(`Baraholka API listening on :${PORT}`));
