// Обёртка для Netlify: запускает тот же код, что и api/task.js на Vercel.
const handler = require("../../api/task.js");

exports.handler = (event) => new Promise((resolve) => {
  let body = {};
  try { body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body) : {}; } catch (e) {}
  const req = { method: event.httpMethod, body };
  let code = 200;
  const res = {
    status(c) { code = c; return res; },
    json(o) { resolve({ statusCode: code, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(o) }); },
  };
  Promise.resolve(handler(req, res)).catch((e) => resolve({ statusCode: 500, body: JSON.stringify({ error: String(e) }) }));
});
