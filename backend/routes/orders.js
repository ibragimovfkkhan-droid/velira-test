const express = require("express");
const { readJSON, appendJSON, updateJSONById } = require("../utils/store");
const { sendTelegramMessage } = require("../utils/telegram");
const {
  sendAdminOrderEmail,
  sendCustomerAcceptedEmail,
  verifyAcceptToken,
} = require("../utils/email");

const router = express.Router();

function isValidOrder(body) {
  return (
    body &&
    typeof body.name === "string" &&
    body.name.trim().length > 1 &&
    typeof body.phone === "string" &&
    body.phone.trim().length > 5 &&
    Array.isArray(body.items) &&
    body.items.length > 0
  );
}

// Small standalone HTML page shown to the admin after clicking the
// "Accept" button in their email (not JSON — this is opened directly
// in a browser tab).
function renderAdminPage(title, message, ok = true) {
  return `<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Velira</title>
</head>
<body style="font-family:Arial,sans-serif;background:#f6f6f4;margin:0;padding:0;">
  <div style="max-width:480px;margin:80px auto;background:#fff;border-radius:14px;padding:36px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="font-size:44px;line-height:1;margin-bottom:12px;">${ok ? "✅" : "⚠️"}</div>
    <h2 style="margin:0 0 12px;color:#2b2b2b;">${title}</h2>
    <p style="color:#555;font-size:15px;">${message}</p>
  </div>
</body>
</html>`;
}

// POST /api/orders
router.post("/", async (req, res) => {
  const body = req.body;

  if (!isValidOrder(body)) {
    return res.status(400).json({
      error: "Ma'lumotlar to'liq emas: ism, telefon va mahsulotlar ro'yxati kerak",
    });
  }

  const products = readJSON("products.json");

  let total = 0;
  const lineItems = body.items.map((item) => {
    const product = products.find((p) => p.id === item.id);
    const qty = Number(item.qty) || 1;
    const price = product ? product.price : 0;
    total += price * qty;
    return {
      id: item.id,
      name: product ? product.name.uz : item.id,
      qty,
      price,
    };
  });

  const order = {
    id: `ORD-${Date.now()}`,
    createdAt: new Date().toISOString(),
    name: body.name.trim(),
    phone: body.phone.trim(),
    email: typeof body.email === "string" ? body.email.trim() : "",
    lang: body.lang === "ru" ? "ru" : "uz",
    address: (body.address || "").trim(),
    comment: (body.comment || "").trim(),
    items: lineItems,
    total,
    status: "new",
  };

  appendJSON("orders.json", order);

  const itemsText = lineItems
    .map((li) => `• ${li.name} × ${li.qty} — ${(li.price * li.qty).toLocaleString("ru-RU")} so'm`)
    .join("\n");

  const message =
    `🛒 <b>Yangi buyurtma</b> #${order.id}\n\n` +
    `👤 ${order.name}\n` +
    `📞 ${order.phone}\n` +
    (order.address ? `📍 ${order.address}\n` : "") +
    (order.comment ? `💬 ${order.comment}\n` : "") +
    `\n${itemsText}\n\n` +
    `💰 <b>Jami: ${order.total.toLocaleString("ru-RU")} so'm</b>`;

  // Telegram and email notifications are independent — a failure in one
  // must never block the order from being saved / the API responding.
  await Promise.allSettled([sendTelegramMessage(message), sendAdminOrderEmail(order)]);

  res.status(201).json({ success: true, order });
});

// GET /api/orders/:id/accept?token=...
// Opened by the admin from the "Accept" button in the order notification
// email. Marks the order accepted and emails the customer back in their
// own language (uz/ru) with what they ordered.
router.get("/:id/accept", async (req, res) => {
  const { id } = req.params;
  const { token } = req.query;

  if (!verifyAcceptToken(id, token)) {
    return res
      .status(403)
      .send(renderAdminPage("Havola yaroqsiz", "Bu qabul qilish havolasi noto'g'ri yoki buzilgan.", false));
  }

  const orders = readJSON("orders.json");
  const order = orders.find((o) => o.id === id);

  if (!order) {
    return res
      .status(404)
      .send(renderAdminPage("Buyurtma topilmadi", `#${id} raqamli buyurtma bazadan topilmadi.`, false));
  }

  if (order.status === "accepted") {
    return res.send(
      renderAdminPage("Allaqachon qabul qilingan", `Buyurtma #${id} avval qabul qilingan edi.`)
    );
  }

  const updated = updateJSONById("orders.json", id, (o) => ({
    ...o,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  }));

  const emailResult = await sendCustomerAcceptedEmail(updated);

  let note;
  if (!updated.email) {
    note = "Mijoz email kiritmagan edi — telefon yoki Telegram orqali xabar bering.";
  } else if (emailResult.ok) {
    note = `Mijozga (${updated.email}) buyurtma qabul qilingani haqida xabar yuborildi.`;
  } else {
    note = `Mijozga (${updated.email}) xabar yuborishda xatolik yuz berdi — telefon orqali xabar bering.`;
  }

  res.send(renderAdminPage("Buyurtma qabul qilindi", `Buyurtma #${id} qabul qilindi. ${note}`));
});

module.exports = router;
