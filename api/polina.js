// Отвечает за посетителя: получает разговор, спрашивает ИИ, возвращает ответ Полины.
// Ключи берутся из настроек Vercel (Environment Variables), в коде их нет.
const { INSTRUCTIONS, PHRASES, GREETINGS, LIMITS } = require("./_polina-config.js");

function clean(body) {
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === "visitor" || m.role === "polina") && typeof m.text === "string")
    .slice(-24)
    .map(m => ({ role: m.role, text: m.text.slice(0, LIMITS.maxMessageLength) }));
  const n = body.note && typeof body.note === "object" ? body.note : {};
  const note = {
    name: String(n.name || "").slice(0, 200), contact: String(n.contact || "").slice(0, 200),
    request: String(n.request || "").slice(0, 2000), urgency: String(n.urgency || "").slice(0, 20),
  };
  const greet = GREETINGS[body.greet] ? body.greet : "greet";
  return { messages, note, greet };
}

function buildPrompt({ messages, note, greet }) {
  const convo = messages.map(m => (m.role === "visitor" ? "Посетитель" : "Полина") + ": " + m.text).join("\n");
  const list = Object.entries(PHRASES).map(([id, t]) => `${id} — «${t}»`).join("\n");
  return `Текущая запись (JSON): ${JSON.stringify(note)}

Разговор:
Полина: ${GREETINGS[greet]}
${convo}

Верни строго JSON без пояснений:
{"reply": "ответ посетителю", "say": "id фразы", "note": {"name": "...", "contact": "...", "request": "...", "urgency": "обычно|срочно"}}
В "note" сохрани всё известное, дополнив новым; неизвестные поля — пустая строка.
"say" — какую из готовых фраз Полина произнесёт вслух своим голосом. Выбери ближайшую по смыслу к твоему ответу (лучше, если ответ начинается с этой фразы):
${list}`;
}

async function askOpenAI(prompt) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.OPENAI_API_KEY },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      messages: [{ role: "system", content: INSTRUCTIONS }, { role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("OpenAI: " + (j.error && j.error.message || r.status));
  return j.choices[0].message.content;
}

async function askAnthropic(prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
      max_tokens: 600, system: INSTRUCTIONS,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Anthropic: " + (j.error && j.error.message || r.status));
  return (j.content || []).map(c => c.text || "").join("");
}

function parse(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : text);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Только POST" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const data = clean(body || {});
  if (!data.messages.some(m => m.role === "visitor")) return res.status(400).json({ error: "Пустой разговор" });
  if (data.messages.filter(m => m.role === "visitor").length > LIMITS.maxVisitorMessages)
    return res.status(200).json({ reply: "Я всё записала и передам. Спасибо!", say: "done", note: data.note });

  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY)
    return res.status(200).json({ nokey: true }); // нет ключа — сайт работает бесплатно, по сценарию

  try {
    const prompt = buildPrompt(data);
    const raw = process.env.OPENAI_API_KEY ? await askOpenAI(prompt) : await askAnthropic(prompt);
    const out = parse(raw);
    const n = out.note || {};
    res.status(200).json({
      reply: String(out.reply || "Записала. Что ещё передать?").slice(0, 1000),
      say: PHRASES[out.say] ? out.say : "noting",
      note: {
        name: String(n.name || data.note.name), contact: String(n.contact || data.note.contact),
        request: String(n.request || data.note.request), urgency: String(n.urgency || data.note.urgency),
      },
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "ИИ не ответил" });
  }
};
