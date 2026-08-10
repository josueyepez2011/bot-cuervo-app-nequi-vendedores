require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { db, FieldValue } = require('./firebase');
const crypto = require('crypto');

// ─── FUNCIONES DE FECHA COLOMBIA ─────────────────────────
function getColDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}
function getColTime() {
  return new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
}
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const OWNER_PHONE = process.env.OWNER_PHONE || '8116120039';
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;

if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN no configurado en .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ─── PLANES ───────────────────────────────────────────────
const PLANS = {
  basico: {
    name: 'PLAN BÁSICO',
    amount: '1.2 MILLONES',
    balance: 1200000,
    price: 25000,
    commission: 10000,
    emoji: '🔹',
    planName: '',
  },
  pro: {
    name: 'PLAN PRO',
    amount: '2.5 MILLONES',
    balance: 2500000,
    price: 35000,
    commission: 14000,
    emoji: '🔹',
    planName: 'bronce',
  },
  ultra: {
    name: 'PLAN ULTRA',
    amount: '5 MILLONES',
    balance: 5000000,
    price: 50000,
    commission: 20000,
    emoji: '🔹',
    planName: 'plata',
  },
  elite: {
    name: 'PLAN ELITE',
    amount: '12 MILLONES',
    balance: 12000000,
    price: 100000,
    commission: 35000,
    emoji: '👑',
    planName: 'oro',
  },
};

// ─── ESTADOS DE CONVERSACIÓN ──────────────────────────────
const userStates = new Map();

function formatCOP(amount) {
  return '$' + amount.toLocaleString('es-CO') + ' COP';
}

// ─── HELPERS FIREBASE ────────────────────────────────────
async function getSeller(tgId) {
  const ref = db.collection('sellers').doc(String(tgId));
  const snap = await ref.get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function resetDailyLimitIfNeeded(seller) {
  const today = getColDate();
  if (seller.lastResetDate !== today) {
    await db.collection('sellers').doc(seller.id).update({
      usersCreatedToday: 0,
      lastResetDate: today,
    });
    return { ...seller, usersCreatedToday: 0, lastResetDate: today };
  }
  return seller;
}

const EXTRA_OWNER_ID = '7703974919';

function isOwner(telegramId) {
  const tid = String(telegramId);
  return (OWNER_TELEGRAM_ID && tid === String(OWNER_TELEGRAM_ID)) || tid === EXTRA_OWNER_ID;
}

// ─── TECLADOS ────────────────────────────────────────────
function plansKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔹 PLAN BÁSICO - $25.000 COP', 'plan_basico')],
    [Markup.button.callback('🔹 PLAN PRO - $35.000 COP', 'plan_pro')],
    [Markup.button.callback('🔹 PLAN ULTRA - $50.000 COP', 'plan_ultra')],
    [Markup.button.callback('👑 PLAN ELITE - $100.000 COP', 'plan_elite')],
  ]);
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ CONFIRMAR VENTA', 'confirm_sale'),
      Markup.button.callback('❌ CANCELAR', 'cancel_sale'),
    ],
  ]);
}

function approveKeyboard(requestId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ APROBAR', `approve_${requestId}`),
      Markup.button.callback('❌ NEGAR', `deny_${requestId}`),
    ],
  ]);
}

function sellerMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔥 VER PLANES DISPONIBLES', 'show_plans')],
    [Markup.button.callback('🧪 USUARIO DE PRUEBA', 'test_user')],
    [Markup.button.callback('📊 MIS ESTADÍSTICAS', 'my_stats')],
  ]);
}

function ownerMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔥 VER PLANES DISPONIBLES', 'show_plans')],
    [Markup.button.callback('🧪 USUARIO DE PRUEBA', 'test_user')],
    [Markup.button.callback('➕ AGREGAR VENDEDOR', 'add_seller_btn')],
    [Markup.button.callback('🚫 DESACTIVAR VENDEDOR', 'remove_seller_btn')],
    [Markup.button.callback('✅ REACTIVAR VENDEDOR', 'active_seller_btn')],
    [Markup.button.callback('🔢 CAMBIAR LÍMITE', 'set_limit_btn')],
    [Markup.button.callback('📊 MIS ESTADÍSTICAS', 'my_stats')],
    [Markup.button.callback('👥 LISTAR VENDEDORES', 'admin_sellers')],
    [Markup.button.callback('📋 SOLICITUDES PENDIENTES', 'pending_requests')],
  ]);
}

// ─── NOTIFICACIÓN DE VENTA AL GRUPO ──────────────────────
async function notifySale(seller, plan, customerPhone, customerPin, months) {
  if (!GROUP_CHAT_ID) return;

  const planInfo = PLANS[plan];
  const msg =
    `🛒 <b>¡NUEVA VENTA REGISTRADA!</b> 🛒\n\n` +
    `👤 <b>Vendedor:</b> ${seller.name}\n` +
    `📱 <b>ID Vendedor:</b> <code>${seller.phone || 'N/A'}</code>\n` +
    `📎 <b>@:</b> @${seller.username || 'N/A'}\n\n` +
    `📦 <b>Paquete:</b> ${planInfo.emoji} ${planInfo.name}\n` +
    `🔢 <b>Monto:</b> ${planInfo.amount}\n` +
    (plan === 'basico' ? '' : `📅 <b>Meses:</b> ${months}\n`) +
    `\n` +
    `📱 <b>Teléfono cliente:</b> <code>${customerPhone}</code>\n` +
    `🔐 <b>PIN:</b> <code>${customerPin}</code>\n\n` +
    `💰 <b>Cobrado:</b> ${formatCOP(planInfo.price)}\n` +
    `💸 <b>Comisión ganada:</b> ${formatCOP(planInfo.commission)}\n\n` +
    `🕐 <b>Fecha:</b> ${getColTime()}`;

  try {
    if (GROUP_CHAT_ID) {
      await bot.telegram.sendMessage(GROUP_CHAT_ID, msg, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('Error enviando notificación al grupo:', err.message);
  }

  const owners = [OWNER_TELEGRAM_ID, EXTRA_OWNER_ID].filter(Boolean);
  for (const ownerId of owners) {
    try {
      await bot.telegram.sendMessage(ownerId, msg, { parse_mode: 'HTML' });
    } catch (err) {
      console.error(`Error enviando notificación al owner ${ownerId}:`, err.message);
    }
  }
}

// ─── NOTIFICACIÓN DE SOLICITUD DE ACCESO ────────────────
async function notifyOwnerAccessRequest(seller, requestId) {
  const owners = [OWNER_TELEGRAM_ID, EXTRA_OWNER_ID].filter(Boolean);

  if (owners.length === 0) return;

  const msg =
    `🔔 <b>¡SOLICITUD DE MÁS ACCESOS!</b> 🔔\n\n` +
    `👤 <b>Vendedor:</b> ${seller.name}\n` +
    `📱 <b>Teléfono:</b> <code>${seller.phone || 'N/A'}</code>\n` +
    `📎 <b>@:</b> @${seller.username || 'N/A'}\n` +
    `📊 <b>Creaciones hoy:</b> ${seller.usersCreatedToday}/${seller.dailyLimit || 5}\n\n` +
    `Este vendedor alcanzó su límite diario y solicita más accesos.`;

  for (const ownerId of owners) {
    try {
      await bot.telegram.sendMessage(ownerId, msg, {
        parse_mode: 'HTML',
        ...approveKeyboard(requestId),
      });
    } catch (err) {
      console.error(`Error notificando al owner ${ownerId}:`, err.message);
    }
  }
}

// ─── COMANDO /start ──────────────────────────────────────
bot.command('start', async (ctx) => {
  const tgId = String(ctx.from.id);

  if (isOwner(tgId)) {
    return ctx.reply(
      `🔥 *Bienvenido, OWNER de Nequi Ultra* 🔥\n\n` +
      `Selecciona una opción:`,
      { parse_mode: 'Markdown', ...ownerMenuKeyboard() }
    );
  }

  const seller = await getSeller(tgId);

  if (!seller) {
    return ctx.reply(
      `❌ *Acceso denegado*\n\n` +
      `No estás registrado como vendedor. Si crees que deberías tener acceso, contacta al administrador.`,
      { parse_mode: 'Markdown' }
    );
  }

  if (!seller.active) {
    return ctx.reply(
      `🚫 Tu cuenta de vendedor ha sido desactivada. Contacta al administrador.`
    );
  }

  // Actualizar nombre/username del vendedor
  db.collection('sellers').doc(tgId).update({
    name: ctx.from.first_name || seller.name,
    username: ctx.from.username || seller.username || '',
    lastActive: FieldValue.serverTimestamp(),
  }).catch(() => { });

  return ctx.reply(
    `🔥 *¡Bienvenido, ${seller.name}!* 🔥\n\n` +
    `📊 *Tus accesos hoy:* ${seller.usersCreatedToday || 0}/${seller.dailyLimit || 5}\n\n` +
    `Selecciona una opción:`,
    { parse_mode: 'Markdown', ...sellerMenuKeyboard() }
  );
});

// ─── COMANDO /cmd ────────────────────────────────────────
bot.command('cmd', async (ctx) => {
  ctx.reply('🔥 *NEQUI ULTRA — ELIGE TU PLAN* 🔥', {
    parse_mode: 'Markdown',
    ...plansKeyboard(),
  });
});

// ─── COMANDO /cancelar ───────────────────────────────────
bot.command('cancelar', async (ctx) => {
  const tgId = String(ctx.from.id);
  userStates.delete(tgId);
  ctx.reply('❌ Operación cancelada.');
});

// ─── MOSTRAR PLANES ──────────────────────────────────────
bot.action('show_plans', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(
    `🔥 *NEQUI ULTRA — ELIGE TU PLAN* 🔥\n\n` +
    `🔹 *PLAN BÁSICO*\n🔢 1.2 MILLONES\n💵 ${formatCOP(25000)}\n\n` +
    `🔹 *PLAN PRO*\n🔢 2.5 MILLONES\n✨ Premium de nombres\n💵 ${formatCOP(35000)}\n\n` +
    `🔹 *PLAN ULTRA*\n🔢 5 MILLONES\n✨ Premium de nombres\n🔑 Premium de llaves\n💵 ${formatCOP(50000)}\n\n` +
    `👑 *PLAN ELITE*\n🔢 12 MILLONES\n✨ Todas las funciones\n🔑 Premium de llaves\n🏦 Bancolombia\n💵 ${formatCOP(100000)}`,
    { parse_mode: 'Markdown', ...plansKeyboard() }
  );
});

// ─── USUARIO DE PRUEBA ────────────────────────────────────
bot.action('test_user', async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = String(ctx.from.id);

  if (!isOwner(tgId)) {
    const seller = await getSeller(tgId);
    if (!seller || !seller.active) {
      return ctx.reply('❌ No tienes acceso.');
    }
  }

  const today = getColDate();
  const statsRef = db.collection('stats').doc('test_users');
  const statsSnap = await statsRef.get();

  let count = 0;
  let lastDate = '';
  if (statsSnap.exists) {
    const data = statsSnap.data();
    count = data.date === today ? data.count : 0;
    lastDate = data.date;
  }

  if (count >= 2) {
    return ctx.reply(
      `⚠️ *Límite de usuarios de prueba alcanzado*\n\n` +
      `Ya se generaron *2/2* usuarios de prueba hoy. Vuelve mañana.`,
      { parse_mode: 'Markdown' }
    );
  }

  let randomPhone;
  let userRef;
  do {
    randomPhone = '3' + String(Math.floor(Math.random() * 900000000) + 100000000);
    userRef = await db.collection('users').doc(randomPhone).get();
  } while (userRef.exists);

  const randomPin = String(Math.floor(Math.random() * 9000) + 1000);
  const randomName = `UserTest${Math.floor(Math.random() * 9999)}`;

  const expirationDate = new Date();
  expirationDate.setTime(expirationDate.getTime() + (30 * 24 * 60 * 60 * 1000));

  await db.collection('users').doc(randomPhone).set({
    name: randomName,
    planVip: 'prueba',
    premiumExpiry: expirationDate.getTime(),
    balance: 1000,
    banned: false,
    pin: randomPin,
    phone: randomPhone,
    premium: true,
    vencimiento: expirationDate.toISOString(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    boundDeviceId: "",
    qrScanCount: 0,
    qrScanDate: "",
    reserva: 0,
    uid: crypto.randomUUID(),
    vipLlaves: true,
    vipNombres: true
  });

  await statsRef.set({ count: count + 1, date: today }, { merge: true });

  ctx.reply(
    `🧪 *¡USUARIO DE PRUEBA CREADO!*\n\n` +
    `📱 *Teléfono:* \`${randomPhone}\`\n` +
    `🔐 *PIN:* \`${randomPin}\`\n` +
    `👤 *Nombre:* ${randomName}\n` +
    `💰 *Saldo:* $1.000 COP\n\n` +
    `📊 *Pruebas hoy:* ${count + 1}/2`,
    { parse_mode: 'Markdown' }
  );
});

// ─── SELECCIÓN DE PLAN ───────────────────────────────────
Object.keys(PLANS).forEach((planKey) => {
  bot.action(`plan_${planKey}`, async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = String(ctx.from.id);

    if (isOwner(tgId)) {
      userStates.set(tgId, { step: 'awaiting_phone', plan: planKey });
      return ctx.reply(
        `📱 *${PLANS[planKey].emoji} ${PLANS[planKey].name}*\n\n` +
        `Envía el *número de teléfono* del cliente (10 dígitos):`,
        { parse_mode: 'Markdown' }
      );
    }

    const seller = await getSeller(tgId);
    if (!seller || !seller.active) {
      return ctx.reply('❌ No tienes acceso para realizar ventas.');
    }

    const refreshed = await resetDailyLimitIfNeeded(seller);
    const limit = refreshed.dailyLimit || 5;

    if (refreshed.usersCreatedToday >= limit) {
      return ctx.reply(
        `⚠️ *¡Límite diario alcanzado!*\n\n` +
        `Has creado *${refreshed.usersCreatedToday}/${limit}* usuarios hoy.\n\n` +
        `Solicita más accesos al administrador:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔑 SOLICITAR MÁS ACCESOS', 'request_access')],
          ]),
        }
      );
    }

    userStates.set(tgId, { step: 'awaiting_phone', plan: planKey });
    ctx.reply(
      `📱 *${PLANS[planKey].emoji} ${PLANS[planKey].name}*\n\n` +
      `Envía el *número de teléfono* del cliente (10 dígitos):`,
      { parse_mode: 'Markdown' }
    );
  });
});

// ─── SOLICITAR MÁS ACCESOS ───────────────────────────────
bot.action('request_access', async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = String(ctx.from.id);
  const seller = await getSeller(tgId);

  if (!seller) return ctx.reply('❌ No estás registrado como vendedor.');

  const refreshed = await resetDailyLimitIfNeeded(seller);

  const reqRef = await db.collection('access_requests').add({
    sellerId: tgId,
    sellerPhone: seller.phone || '',
    sellerName: seller.name,
    sellerUsername: seller.username || '',
    sellerCurrentCount: refreshed.usersCreatedToday,
    sellerLimit: refreshed.dailyLimit || 5,
    requestedAt: FieldValue.serverTimestamp(),
    status: 'pending',
  });

  await notifyOwnerAccessRequest(refreshed, reqRef.id);

  ctx.reply(
    `✅ *Solicitud enviada*\n\n` +
    `Tu solicitud de más accesos ha sido enviada al administrador. ` +
    `Recibirás una notificación cuando sea procesada.`,
    { parse_mode: 'Markdown' }
  );
});

// ─── APROBAR / NEGAR SOLICITUD ──────────────────────────
bot.action(/^approve_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede aprobar solicitudes.');

  const requestId = ctx.match[1];
  const reqRef = db.collection('access_requests').doc(requestId);
  const reqSnap = await reqRef.get();

  if (!reqSnap.exists) return ctx.reply('❌ Solicitud no encontrada.');

  const req = reqSnap.data();
  if (req.status !== 'pending') return ctx.reply('⚠️ Esta solicitud ya fue procesada.');

  await reqRef.update({ status: 'approved', resolvedAt: FieldValue.serverTimestamp() });

  // Aumentar límite del vendedor por hoy (+5)
  const sellerRef = db.collection('sellers').doc(req.sellerId);
  await sellerRef.update({
    dailyLimit: FieldValue.increment(5),
  });

  try {
    await bot.telegram.sendMessage(
      req.sellerId,
      `✅ *¡Solicitud aprobada!*\n\nEl administrador te ha concedido *5 accesos adicionales* por hoy.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) { /* ignore */ }

  await ctx.editMessageReplyMarkup(undefined);
  ctx.reply(`✅ Solicitud de *${req.sellerName}* aprobada. +5 accesos otorgados.`, {
    parse_mode: 'Markdown',
  });
});

bot.action(/^deny_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede negar solicitudes.');

  const requestId = ctx.match[1];
  const reqRef = db.collection('access_requests').doc(requestId);
  const reqSnap = await reqRef.get();

  if (!reqSnap.exists) return ctx.reply('❌ Solicitud no encontrada.');

  const req = reqSnap.data();
  if (req.status !== 'pending') return ctx.reply('⚠️ Esta solicitud ya fue procesada.');

  await reqRef.update({ status: 'denied', resolvedAt: FieldValue.serverTimestamp() });

  try {
    await bot.telegram.sendMessage(
      req.sellerId,
      `❌ *Solicitud denegada*\n\nEl administrador ha denegado tu solicitud de más accesos.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) { /* ignore */ }

  await ctx.editMessageReplyMarkup(undefined);
  ctx.reply(`❌ Solicitud de *${req.sellerName}* denegada.`, { parse_mode: 'Markdown' });
});

// ─── MIS ESTADÍSTICAS ────────────────────────────────────
bot.action('my_stats', async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = String(ctx.from.id);

  let seller;
  if (isOwner(tgId)) {
    const salesSnap = await db.collection('sales').get();
    let totalSales = 0;
    let totalCommission = 0;
    const byPlan = { basico: 0, pro: 0, ultra: 0, elite: 0 };
    salesSnap.forEach((doc) => {
      const s = doc.data();
      totalSales += s.price || 0;
      totalCommission += s.commission || 0;
      if (byPlan[s.package] !== undefined) byPlan[s.package]++;
    });

    return ctx.reply(
      `📊 *ESTADÍSTICAS GLOBALES*\n\n` +
      `💰 *Ventas totales:* ${formatCOP(totalSales)}\n` +
      `💸 *Comisiones totales:* ${formatCOP(totalCommission)}\n` +
      `🛒 *Transacciones:* ${salesSnap.size}\n\n` +
      `🔹 Básico: ${byPlan.basico} | 🔹 Pro: ${byPlan.pro}\n` +
      `🔹 Ultra: ${byPlan.ultra} | 👑 Elite: ${byPlan.elite}`,
      { parse_mode: 'Markdown' }
    );
  }

  seller = await getSeller(tgId);
  if (!seller) return ctx.reply('❌ No estás registrado.');

  const refreshed = await resetDailyLimitIfNeeded(seller);

  const salesSnap = await db
    .collection('sales')
    .where('sellerId', '==', tgId)
    .get();

  let totalSold = 0;
  let totalCommission = 0;
  const byPlan = { basico: 0, pro: 0, ultra: 0, elite: 0 };
  salesSnap.forEach((doc) => {
    const s = doc.data();
    totalSold += s.price || 0;
    totalCommission += s.commission || 0;
    if (byPlan[s.package] !== undefined) byPlan[s.package]++;
  });

  ctx.reply(
    `📊 *TUS ESTADÍSTICAS*\n\n` +
    `👤 *Vendedor:* ${refreshed.name}\n` +
    `📱 *Teléfono:* \`${refreshed.phone || 'N/A'}\`\n\n` +
    `🔢 *Accesos hoy:* ${refreshed.usersCreatedToday}/${refreshed.dailyLimit || 5}\n` +
    `🛒 *Ventas totales:* ${salesSnap.size}\n` +
    `🔹 Básico: ${byPlan.basico} | 🔹 Pro: ${byPlan.pro} | 🔹 Ultra: ${byPlan.ultra} | 👑 Elite: ${byPlan.elite}\n\n` +
    `💰 *Vendido:* ${formatCOP(totalSold)}\n` +
    `💸 *Ganado:* ${formatCOP(totalCommission)}`,
    { parse_mode: 'Markdown' }
  );
});

// ─── ADMIN: LISTAR VENDEDORES (OWNER) ────────────────────
bot.action('admin_sellers', async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede usar este comando.');

  const snap = await db.collection('sellers').get();
  if (snap.empty) return ctx.reply('📋 No hay vendedores registrados.');

  let msg = '👥 *VENDEDORES REGISTRADOS*\n\n';
  snap.forEach((doc) => {
    const s = doc.data();
    const status = s.active ? '✅' : '🚫';
    msg += `${status} *${s.name}* — \`${s.phone || 'N/A'}\` — @${s.username || 'N/A'}\n`;
  });

  ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ─── AGREGAR VENDEDOR POR BOTONES ────────────────────────
bot.action('add_seller_btn', async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede usar este comando.');

  userStates.set(tgId, { step: 'awaiting_seller_tgid' });
  ctx.reply('📝 Envía el *ID de Telegram* del vendedor:', { parse_mode: 'Markdown' });
});

// ─── DESACTIVAR VENDEDOR ─────────────────────────────────
bot.action('remove_seller_btn', async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede usar este comando.');

  userStates.set(tgId, { step: 'awaiting_remove_tgid' });
  ctx.reply('📝 Envía el *ID de Telegram* del vendedor a desactivar:', { parse_mode: 'Markdown' });
});

// ─── REACTIVAR VENDEDOR ──────────────────────────────────
bot.action('active_seller_btn', async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede usar este comando.');

  userStates.set(tgId, { step: 'awaiting_active_tgid' });
  ctx.reply('📝 Envía el *ID de Telegram* del vendedor a reactivar:', { parse_mode: 'Markdown' });
});

// ─── CAMBIAR LÍMITE ──────────────────────────────────────
bot.action('set_limit_btn', async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede usar este comando.');

  userStates.set(tgId, { step: 'awaiting_limit_tgid' });
  ctx.reply('📝 Envía el *ID de Telegram* del vendedor:', { parse_mode: 'Markdown' });
});

// ─── ADMIN: SOLICITUDES PENDIENTES ───────────────────────
bot.action('pending_requests', async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede usar este comando.');

  const snap = await db
    .collection('access_requests')
    .where('status', '==', 'pending')
    .get();

  if (snap.empty) return ctx.reply('✅ No hay solicitudes pendientes.');

  for (const doc of snap.docs) {
    const r = doc.data();
    await ctx.reply(
      `🔔 *Solicitud de más accesos*\n\n` +
      `👤 *Vendedor:* ${r.sellerName}\n` +
      `📱 *Teléfono:* \`${r.sellerPhone}\`\n` +
      `📎 *@:* @${r.sellerUsername}\n` +
      `📊 *Progreso:* ${r.sellerCurrentCount}/${r.sellerLimit}`,
      { parse_mode: 'Markdown', ...approveKeyboard(doc.id) }
    );
  }
});

// ─── PROCESAR TEXTO (ESTADOS) ────────────────────────────
bot.on('text', async (ctx) => {
  const tgId = String(ctx.from.id);
  const text = ctx.message.text.trim();

  // Ignorar comandos
  if (text.startsWith('/')) return;

  const state = userStates.get(tgId);
  if (!state) return;

  try {
    // Flujo: agregar vendedor
    if (state.step === 'awaiting_seller_tgid') {
      const sellerTgId = text.replace(/\D/g, '');
      if (!sellerTgId) return ctx.reply('⚠️ ID inválido. Envía un ID válido:');
      state.sellerTgId = sellerTgId;
      state.step = 'awaiting_seller_name';
      userStates.set(tgId, state);
      return ctx.reply('👤 Envía el *nombre* del vendedor:', { parse_mode: 'Markdown' });
    }

    if (state.step === 'awaiting_seller_name') {
      const name = text;
      await db.collection('sellers').doc(state.sellerTgId).set({
        name: name,
        username: '',
        active: true,
        dailyLimit: 5,
        usersCreatedToday: 0,
        lastResetDate: getColDate(),
        totalEarnings: 0,
        totalSales: 0,
        addedBy: 'OWNER',
        createdAt: FieldValue.serverTimestamp(),
      });

      userStates.delete(tgId);

      try {
        await bot.telegram.sendMessage(
          state.sellerTgId,
          `🎉 *¡Has sido registrado como vendedor de Nequi Ultra!*\n\nUsa /start para comenzar a vender.\nTienes *5 accesos diarios*.`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) { /* no pudo notificar */ }

      return ctx.reply(`✅ Vendedor *${name}* agregado exitosamente.`, {
        parse_mode: 'Markdown',
        ...ownerMenuKeyboard(),
      });
    }

    // Flujo: desactivar vendedor
    if (state.step === 'awaiting_remove_tgid') {
      const sellerTgId = text.replace(/\D/g, '');
      if (!sellerTgId) return ctx.reply('⚠️ ID inválido:');
      await db.collection('sellers').doc(sellerTgId).update({ active: false });
      userStates.delete(tgId);
      return ctx.reply(`🚫 Vendedor \`${sellerTgId}\` desactivado.`, {
        parse_mode: 'Markdown',
        ...ownerMenuKeyboard(),
      });
    }

    // Flujo: reactivar vendedor
    if (state.step === 'awaiting_active_tgid') {
      const sellerTgId = text.replace(/\D/g, '');
      if (!sellerTgId) return ctx.reply('⚠️ ID inválido:');
      await db.collection('sellers').doc(sellerTgId).update({ active: true });
      userStates.delete(tgId);
      return ctx.reply(`✅ Vendedor \`${sellerTgId}\` reactivado.`, {
        parse_mode: 'Markdown',
        ...ownerMenuKeyboard(),
      });
    }

    // Flujo: cambiar límite
    if (state.step === 'awaiting_limit_tgid') {
      const sellerTgId = text.replace(/\D/g, '');
      if (!sellerTgId) return ctx.reply('⚠️ ID inválido:');
      state.sellerTgId = sellerTgId;
      state.step = 'awaiting_limit_value';
      userStates.set(tgId, state);
      return ctx.reply('🔢 Envía el *nuevo límite* diario:', { parse_mode: 'Markdown' });
    }

    if (state.step === 'awaiting_limit_value') {
      const limit = parseInt(text, 10);
      if (isNaN(limit) || limit < 1) return ctx.reply('⚠️ Límite inválido. Número mayor a 0:');
      await db.collection('sellers').doc(state.sellerTgId).update({ dailyLimit: limit });
      userStates.delete(tgId);
      try {
        await bot.telegram.sendMessage(
          state.sellerTgId,
          `🔔 Tu límite diario ha sido actualizado a *${limit}* accesos por día.`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) { /* ignore */ }
      return ctx.reply(
        `✅ Límite de \`${state.sellerTgId}\` actualizado a *${limit}*.`,
        { parse_mode: 'Markdown', ...ownerMenuKeyboard() }
      );
    }

    // Flujo: venta de plan
    if (state.step === 'awaiting_phone') {
      const phone = text.replace(/\D/g, '');
      if (phone.length < 10) {
        return ctx.reply('⚠️ Número inválido. Envía un número de 10 dígitos:');
      }

      const userRef = await db.collection('users').doc(phone).get();
      if (userRef.exists) {
        return ctx.reply('❌ Este usuario ya existe. Por favor envía un número diferente:');
      }

      state.customerPhone = phone;
      state.step = 'awaiting_pin';
      userStates.set(tgId, state);
      return ctx.reply('🔐 Envía el *PIN* del cliente (4 dígitos):', { parse_mode: 'Markdown' });
    }

    if (state.step === 'awaiting_pin') {
      const pin = text.replace(/\D/g, '');
      if (pin.length < 4) {
        return ctx.reply('⚠️ PIN inválido. Debe tener al menos 4 dígitos:');
      }
      state.customerPin = pin;
      
      if (state.plan === 'basico') {
        state.months = '';
        state.step = 'confirm_sale';
        userStates.set(tgId, state);
        
        const planInfo = PLANS[state.plan];
        
        return ctx.reply(
          `📋 *CONFIRMAR VENTA*\n\n` +
          `📦 *Plan:* ${planInfo.emoji} ${planInfo.name}\n` +
          `🔢 *Monto:* ${planInfo.amount}\n` +
          `📱 *Teléfono:* \`${state.customerPhone}\`\n` +
          `🔐 *PIN:* \`${state.customerPin}\`\n\n` +
          `💰 *Cobrar:* ${formatCOP(planInfo.price)}\n` +
          `💸 *Tu comisión:* ${formatCOP(planInfo.commission)}`,
          { parse_mode: 'Markdown', ...confirmKeyboard() }
        );
      } else {
        state.step = 'awaiting_months';
        userStates.set(tgId, state);
        return ctx.reply('📅 ¿Cuántos *meses* del plan? (1-12):', { parse_mode: 'Markdown' });
      }
    }

    if (state.step === 'awaiting_months') {
      const months = parseInt(text, 10);
      if (isNaN(months) || months < 1 || months > 12) {
        return ctx.reply('⚠️ Ingresa un número válido entre 1 y 12:');
      }
      state.months = months;
      state.step = 'confirm_sale';
      userStates.set(tgId, state);

      const planInfo = PLANS[state.plan];

      return ctx.reply(
        `📋 *CONFIRMAR VENTA*\n\n` +
        `📦 *Plan:* ${planInfo.emoji} ${planInfo.name}\n` +
        `🔢 *Monto:* ${planInfo.amount}\n` +
        `📱 *Teléfono:* \`${state.customerPhone}\`\n` +
        `🔐 *PIN:* \`${state.customerPin}\`\n` +
        `📅 *Meses:* ${months}\n\n` +
        `💰 *Cobrar:* ${formatCOP(planInfo.price)}\n` +
        `💸 *Tu comisión:* ${formatCOP(planInfo.commission)}`,
        { parse_mode: 'Markdown', ...confirmKeyboard() }
      );
    }
  } catch (err) {
    console.error('Error en conversación:', err);
    ctx.reply('❌ Ocurrió un error. Intenta de nuevo con /start');
    userStates.delete(tgId);
  }
});

// ─── CONFIRMAR VENTA ─────────────────────────────────────
bot.action('confirm_sale', async (ctx) => {
  const tgId = String(ctx.from.id);
  const state = userStates.get(tgId);

  if (!state || state.step !== 'confirm_sale') {
    await ctx.answerCbQuery('Sesion expirada');
    return ctx.reply('⚠️ Sesión expirada. Usa /start para comenzar de nuevo.');
  }

  try {
    await ctx.answerCbQuery();

    const planKey = state.plan;
    const planInfo = PLANS[planKey];
    const months = state.months;

    let seller;
    if (isOwner(tgId)) {
      seller = { id: tgId, phone: 'OWNER', name: 'OWNER', username: 'Owner' };
    } else {
      seller = await getSeller(tgId);
      if (!seller) {
        userStates.delete(tgId);
        return ctx.reply('❌ Vendedor no encontrado.');
      }
      seller = await resetDailyLimitIfNeeded(seller);

      if (seller.usersCreatedToday >= (seller.dailyLimit || 5)) {
        userStates.delete(tgId);
        return ctx.reply('⚠️ Límite diario alcanzado. Solicita más accesos.');
      }
    }

    userStates.delete(tgId);

    // Guardar venta en Firebase
    await db.collection('sales').add({
      sellerId: seller.id,
      sellerPhone: seller.phone || '',
      sellerName: seller.name,
      sellerUsername: seller.username || '',
      package: planKey,
      planName: planInfo.name,
      planAmount: planInfo.amount,
      price: planInfo.price,
      commission: planInfo.commission,
      months: months,
      customerPhone: state.customerPhone,
      customerPin: state.customerPin,
      timestamp: FieldValue.serverTimestamp(),
    });

    // Crear/actualizar usuario en colección users
    let premiumExpiry = "";
    let vencimiento = "";
    if (planKey !== 'basico') {
      const expirationDate = new Date();
      expirationDate.setTime(expirationDate.getTime() + (30 * 24 * 60 * 60 * 1000 * months));
      premiumExpiry = expirationDate.getTime();
      vencimiento = expirationDate.toISOString();
    }

    await db.collection('users').doc(state.customerPhone).set({
      planVip: planInfo.planName,
      premiumExpiry: premiumExpiry,
      balance: planInfo.balance,
      pin: state.customerPin,
      premium: planKey === 'basico' ? false : (planInfo.planName !== ''),
      vencimiento: vencimiento,
      createdBy: seller.name,
      updatedAt: FieldValue.serverTimestamp(),
      banned: false,
      boundDeviceId: "",
      createdAt: FieldValue.serverTimestamp(),
      name: "USUARIO",
      phone: state.customerPhone,
      qrScanCount: 0,
      qrScanDate: "",
      reserva: 0,
      uid: crypto.randomUUID(),
      vipLlaves: planKey === 'ultra' || planKey === 'elite',
      vipNombres: planKey === 'pro' || planKey === 'ultra' || planKey === 'elite'
    }, { merge: true });

    // Actualizar contador del vendedor
    if (!isOwner(tgId)) {
      await db.collection('sellers').doc(tgId).update({
        usersCreatedToday: FieldValue.increment(1),
        totalEarnings: FieldValue.increment(planInfo.commission),
        totalSales: FieldValue.increment(1),
      });
    }

    // Notificar al grupo (solo ventas de vendedores)
    if (!isOwner(tgId)) {
      await notifySale(seller, planKey, state.customerPhone, state.customerPin, months);
    }

    // Quitar botones del mensaje anterior
    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch (e) { /* ignore */ }

    // Mensaje de confirmación
    const menuKeyboard = isOwner(tgId) ? ownerMenuKeyboard() : sellerMenuKeyboard();
    await ctx.reply(
      `✅ *¡VENTA REGISTRADA CON ÉXITO!*\n\n` +
      `📦 *Plan:* ${planInfo.emoji} ${planInfo.name}\n` +
      `📱 *Teléfono:* \`${state.customerPhone}\`\n` +
      `🔐 *PIN:* \`${state.customerPin}\`\n` +
      `📅 *Meses:* ${months}\n` +
      `💰 *Cobrado:* ${formatCOP(planInfo.price)}\n` +
      `💸 *Tu comisión:* ${formatCOP(planInfo.commission)}\n\n` +
      `🔥 ¡Sigue vendiendo!`,
      { parse_mode: 'Markdown', ...menuKeyboard }
    );
  } catch (err) {
    console.error('Error en confirm_sale:', err);
    try { await ctx.answerCbQuery('Error interno'); } catch (e) { }
    return ctx.reply('❌ Error al procesar la venta: ' + err.message.slice(0, 100));
  }
});

// ─── CANCELAR VENTA ──────────────────────────────────────
bot.action('cancel_sale', async (ctx) => {
  await ctx.answerCbQuery();
  const tgId = String(ctx.from.id);
  userStates.delete(tgId);
  ctx.reply('❌ Venta cancelada. Usa /start para comenzar de nuevo.');
});

// ─── COMANDO /addseller (OWNER) ──────────────────────────
bot.command('addseller', async (ctx) => {
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede usar este comando.');

  const args = ctx.message.text.split(/\s+/).slice(1);
  // Uso: /addseller <telegram_id> <nombre>
  if (args.length < 2) {
    return ctx.reply(
      '📝 *Uso:* `/addseller <telegram_id> <nombre>`\n\n' +
      'Ejemplo: `/addseller 123456789 Juan`',
      { parse_mode: 'Markdown' }
    );
  }

  const sellerTgId = args.shift();
  const name = args.join(' ');

  await db.collection('sellers').doc(sellerTgId).set({
    name: name,
    username: '',
    active: true,
    dailyLimit: 5,
    usersCreatedToday: 0,
    lastResetDate: getColDate(),
    totalEarnings: 0,
    totalSales: 0,
    addedBy: 'OWNER',
    createdAt: FieldValue.serverTimestamp(),
  });

  ctx.reply(`✅ Vendedor *${name}* agregado exitosamente.`, {
    parse_mode: 'Markdown',
  });

  // Notificar al vendedor
  try {
    await bot.telegram.sendMessage(
      sellerTgId,
      `🎉 *¡Has sido registrado como vendedor de Nequi Ultra!*\n\n` +
      `Usa /start para comenzar a vender.\n` +
      `Tienes *5 accesos diarios*.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    ctx.reply('⚠️ No pude notificar al vendedor (posiblemente no ha iniciado el bot).');
  }
});

// ─── COMANDO /removeseller (OWNER) ───────────────────────
bot.command('removeseller', async (ctx) => {
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede usar este comando.');

  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length < 1) {
    return ctx.reply('📝 *Uso:* `/removeseller <telegram_id>`', { parse_mode: 'Markdown' });
  }

  const sellerTgId = args[0];
  await db.collection('sellers').doc(sellerTgId).update({ active: false });

  ctx.reply(`🚫 Vendedor \`${sellerTgId}\` desactivado.`, { parse_mode: 'Markdown' });
});

// ─── COMANDO /activeseller (OWNER) ───────────────────────
bot.command('activeseller', async (ctx) => {
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede usar este comando.');

  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length < 1) {
    return ctx.reply('📝 *Uso:* `/activeseller <telegram_id>`', { parse_mode: 'Markdown' });
  }

  const sellerTgId = args[0];
  await db.collection('sellers').doc(sellerTgId).update({ active: true });

  ctx.reply(`✅ Vendedor \`${sellerTgId}\` reactivado.`, { parse_mode: 'Markdown' });
});

// ─── COMANDO /setlimit (OWNER) ───────────────────────────
bot.command('setlimit', async (ctx) => {
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede usar este comando.');

  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length < 2) {
    return ctx.reply(
      '📝 *Uso:* `/setlimit <telegram_id> <nuevo_limite>`\n\n' +
      'Ejemplo: `/setlimit 123456789 10`',
      { parse_mode: 'Markdown' }
    );
  }

  const [sellerTgId, limitStr] = args;
  const limit = parseInt(limitStr, 10);
  if (isNaN(limit) || limit < 1) {
    return ctx.reply('⚠️ El límite debe ser un número mayor a 0.');
  }

  await db.collection('sellers').doc(sellerTgId).update({ dailyLimit: limit });

  ctx.reply(`✅ Límite diario de \`${sellerTgId}\` actualizado a *${limit}*.`, {
    parse_mode: 'Markdown',
  });

  try {
    await bot.telegram.sendMessage(
      sellerTgId,
      `🔔 Tu límite diario ha sido actualizado a *${limit}* accesos por día.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) { /* ignore */ }
});

// ─── COMANDO /allsellers (OWNER) ─────────────────────────
bot.command('allsellers', async (ctx) => {
  const tgId = String(ctx.from.id);
  if (!isOwner(tgId)) return ctx.reply('❌ Solo el owner puede usar este comando.');

  const snap = await db.collection('sellers').get();
  if (snap.empty) return ctx.reply('📋 No hay vendedores registrados.');

  let msg = '👥 *TODOS LOS VENDEDORES*\n\n';
  let i = 1;
  snap.forEach((doc) => {
    const s = doc.data();
    const status = s.active ? '✅' : '🚫';
    msg += `${i}. ${status} *${s.name}*\n`;
    msg += `   📱 \`${s.phone || 'N/A'}\` | TG: \`${doc.id}\`\n`;
    msg += `   📊 ${s.usersCreatedToday || 0}/${s.dailyLimit || 5} | 💰 ${formatCOP(s.totalEarnings || 0)}\n\n`;
    i++;
  });

  ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ─── MANEJO DE ERRORES ───────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Error en bot (${ctx.updateType}):`, err);
});

// ─── PROCESO EN SEGUNDO PLANO (EXPIRACIÓN VIP) ───────────
async function checkExpiredUsers() {
  try {
    console.log('⏳ [CRON] Verificando expiraciones de VIP...');
    const now = Date.now();
    const expiredUsersSnap = await db.collection('users')
      .where('premium', '==', true)
      .where('premiumExpiry', '<', now)
      .get();

    if (expiredUsersSnap.empty) return;

    const batch = db.batch();
    expiredUsersSnap.forEach((doc) => {
      batch.update(doc.ref, { premium: false });
    });

    await batch.commit();
    console.log(`✅ [CRON] ${expiredUsersSnap.size} usuarios actualizados a premium: false (Suscripción Vencida)`);
  } catch (err) {
    console.error('❌ Error comprobando usuarios expirados:', err.message);
  }
}

// Ejecutar la comprobación inmediatamente al encender, y luego cada 1 minuto
checkExpiredUsers();
setInterval(checkExpiredUsers, 60 * 1000);

// ─── INICIAR BOT ─────────────────────────────────────────
bot
  .launch()
  .then(() => console.log('🔥 Bot de vendedores Nequi Ultra iniciado!'))
  .catch((err) => {
    console.error('Error al iniciar el bot:', err);
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('🤖 Bot listo. Esperando mensajes...');
