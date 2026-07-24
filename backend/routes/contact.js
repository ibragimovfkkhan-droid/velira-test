const express = require("express");
const { appendJSON } = require("../utils/store");
const { sendTelegramMessage } = require("../utils/telegram");
const { sendAdminContactEmail } = require("../utils/email");

const router = express.Router();

function isValidMessage(body) {
  return (
    body &&
    typeof body.name === "string" &&
    body.name.trim().length > 1 &&
    typeof body.contact === "string" &&
    body.contact.trim().length > 3 &&
    typeof body.message === "string" &&
    body.message.trim().length > 2
  );
}

// POST /api/contact
router.post("/", async (req, res) => {
  const body = req.body;

  if (!isValidMessage(body)) {
    return res.status(400).json({
      error: "Ma'lumotlar to'liq emas: ism, aloqa va xabar matni kerak",
    });
  }

  const entry = {
    id: `MSG-${Date.now()}`,
    createdAt: new Date().toISOString(),
    name: body.name.trim(),
    contact: body.contact.trim(),
    email: typeof body.email === "string" ? body.email.trim() : "",
    message: body.message.trim(),
  };

  appendJSON("messages.json", entry);

  const text =
    `✉️ <b>Yangi xabar (Contact Us)</b>\n\n` +
    `👤 ${entry.name}\n` +
    `📞 ${entry.contact}\n\n` +
    `${entry.message}`;

  // Telegram and email notifications are independent — a failure in one
  // must never block the message from being saved / the API responding.
  await Promise.allSettled([sendTelegramMessage(text), sendAdminContactEmail(entry)]);

  res.status(201).json({ success: true });
});

module.exports = router;
