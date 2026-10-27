// Отправляет поручение Сержу в Telegram. Одно сообщение на посетителя:
// когда разговор продолжается, сообщение в Telegram обновляется, а не дублируется.
const { BOSS, TELEGRAM_CHAT_ID } = require("./_polina-config.js");
const API = () => "https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN + "/";

const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function tg(method, payload) {
  const r = await fetch(API() + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return r.json();
}

// Если TELEGRAM_CHAT_ID не задан — берём чат того, кто последним написал боту (это вы после /start).
let lastUpdatesError = "";
async function chatId() {
  if (process.env.TELEGRAM_CHAT_ID) return process.env.TELEGRAM_CHAT_ID;
  if (TELEGRAM_CHAT_ID) return TELEGRAM_CHAT_ID;
  let u = await tg("getUpdates", { limit: 100 });
  // Если у бота включён вебхук (например, его подключило приложение BotFather), getUpdates не работает — отключаем вебхук.
  if (!u.ok && /webhook/i.test(u.description || "")) {
    await tg("deleteWebhook", { drop_pending_updates: false });
    u = await tg("getUpdates", { limit: 100 });
  }
  lastUpdatesError = u.ok ? "" : (u.description || "getUpdates error");
  const list = (u.result || []).map(x => x.message || x.edited_message || x.my_chat_member || {}).filter(m => m.chat && m.chat.type === "private");
  return list.length ? list[list.length - 1].chat.id : null;
}

// Проверка: откройте в браузере  /api/task  — бот пришлёт тестовое сообщение или покажет причину.
async function selfTest(res) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return res.status(200).json({ ok: false, reason: "На сервере не задан TELEGRAM_BOT_TOKEN (Netlify → Site configuration → Environment variables), после добавления нужен Redeploy" });
  const me = await tg("getMe", {});
  if (!me.ok) return res.status(200).json({ ok: false, reason: "Telegram не принял токен — скопируйте его заново из @BotFather", telegram: me.description });
  const chat_id = await chatId();
  if (!chat_id) return res.status(200).json({ ok: false, bot: "@" + me.result.username, reason: "Бот не знает, куда писать: откройте @" + me.result.username + " в Telegram, отправьте /start и обновите эту страницу", telegram: lastUpdatesError || "нет новых сообщений боту" });
  const fixed = !!(process.env.TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID);
  const s = await tg("sendMessage", { chat_id, text: "✅ Приёмная Сержа подключена. Сюда будут приходить поручения от Полины." + (fixed ? "" : "\n\nВаш номер чата: " + chat_id + "\nДобавьте его в Netlify как TELEGRAM_CHAT_ID, чтобы поручения всегда шли только вам.") });
  return res.status(200).json(s.ok
    ? { ok: true, bot: "@" + me.result.username, message: "Тестовое сообщение отправлено — проверьте Telegram", chat_id: String(chat_id),
        next: fixed ? "Номер чата закреплён — всё готово" : "Добавьте в Netlify переменную TELEGRAM_CHAT_ID = " + chat_id + " и сделайте Redeploy" }
    : { ok: false, reason: s.description });
}

module.exports = async (req, res) => {
  if (req.method === "GET") return selfTest(res);
  if (req.method !== "POST") return res.status(405).json({ error: "Только POST" });
  if (!process.env.TELEGRAM_BOT_TOKEN) return res.status(200).json({ skipped: "Telegram не настроен" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const n = (body && body.note) || {};
  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-30)
    .filter(m => m && typeof m.text === "string")
    .map(m => (m.role === "visitor" ? "👤 " : "💬 ") + esc(m.text.slice(0, 500)));
  const urgent = /сроч/i.test(n.urgency || "");

  let text = `${urgent ? "🔴 <b>СРОЧНО</b>\n" : ""}📝 <b>Поручение для ${esc(BOSS)}а</b>\n\n` +
    `<b>Кто:</b> ${esc(n.name) || "не представился"}\n` +
    `<b>Что передать:</b> ${esc(n.request) || "—"}\n` +
    `<b>Контакт:</b> ${esc(n.contact) || "не оставил"}\n` +
    `<b>Срочность:</b> ${esc(n.urgency) || "обычно"}\n\n<b>Разговор:</b>\n` + msgs.join("\n");
  if (text.length > 4000) text = text.slice(0, 3990) + "…";

  try {
    const chat_id = await chatId();
    if (!chat_id) return res.status(200).json({ skipped: "Напишите боту /start, чтобы он узнал ваш чат" });
    const id = Number(body.tg) || 0;
    if (id) {
      const e = await tg("editMessageText", { chat_id, message_id: id, text, parse_mode: "HTML" });
      if (e.ok || /not modified/i.test(e.description || "")) return res.status(200).json({ message_id: id });
    }
    const s = await tg("sendMessage", { chat_id, text, parse_mode: "HTML" });
    if (!s.ok) throw new Error(s.description);
    res.status(200).json({ message_id: s.result.message_id });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Telegram не принял сообщение" });
  }
};
