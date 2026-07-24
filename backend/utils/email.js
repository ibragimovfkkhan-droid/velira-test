// Sends real emails via SMTP (nodemailer) — no EmailJS, no client-side keys.
//
// Two things happen here:
//  1. When a new order or contact message comes in, an email is sent to
//     ADMIN_EMAIL (machtigermond@gmail.com by default) with the details.
//     Order emails include an "Accept" button.
//  2. When the admin clicks that button, the customer gets an email saying
//     their order was accepted — written in whichever language (uz/ru) they
//     used on the site, listing what they ordered.
//
// Required .env variables (see .env.example):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM,
//   ADMIN_EMAIL, APP_BASE_URL, ORDER_ACCEPT_SECRET
//
// If SMTP_USER/SMTP_PASS aren't set, emails are skipped with a console
// warning — the rest of the site keeps working (same pattern as telegram.js).

const nodemailer = require("nodemailer");
const crypto = require("crypto");

let cachedTransporter;
let cachedTransporterKey;

function createTransporter() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT) || 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) return null;

  const key = `${host}:${port}:${user}`;
  if (cachedTransporter && cachedTransporterKey === key) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: { user, pass },
  });
  cachedTransporterKey = key;
  return cachedTransporter;
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtSom(n) {
  return `${Number(n || 0).toLocaleString("ru-RU")} so'm`;
}

// --- Accept-link signing -----------------------------------------------
// The "accept" URL that goes out in the admin email is signed with an HMAC
// so nobody can accept an order just by guessing/incrementing the order id.

function makeAcceptToken(orderId) {
  const secret = process.env.ORDER_ACCEPT_SECRET || "velira-fallback-secret-change-me";
  return crypto.createHmac("sha256", secret).update(String(orderId)).digest("hex");
}

function verifyAcceptToken(orderId, token) {
  if (!token || typeof token !== "string") return false;
  const expected = makeAcceptToken(orderId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function fromAddress() {
  return process.env.EMAIL_FROM || `"Velira" <${process.env.SMTP_USER}>`;
}

async function sendMailSafe(mailOptions, logLabel) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn(
      `[email] SMTP_USER/SMTP_PASS .env faylida topilmadi — ${logLabel} yuborilmadi. ` +
        "README.md dagi 'Email sozlash' bo'limiga qarang."
    );
    return { ok: false, skipped: true };
  }
  try {
    await transporter.sendMail({ from: fromAddress(), ...mailOptions });
    return { ok: true };
  } catch (err) {
    console.error(`[email] ${logLabel} yuborishda xatolik:`, err.message);
    return { ok: false, error: err.message };
  }
}

// --- Admin notification: new order --------------------------------------

function buildAdminItemsRows(items) {
  return items
    .map(
      (li) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(li.name)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">×${li.qty}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${fmtSom(li.price * li.qty)}</td>
      </tr>`
    )
    .join("");
}

async function sendAdminOrderEmail(order) {
  const adminEmail = process.env.ADMIN_EMAIL || "machtigermond@gmail.com";
  const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
  const acceptUrl = `${baseUrl}/api/orders/${encodeURIComponent(order.id)}/accept?token=${makeAcceptToken(order.id)}`;

  const acceptBlock = order.email
    ? `
      <a href="${acceptUrl}" target="_blank"
         style="display:inline-block;margin-top:22px;padding:14px 30px;background:#2f8f4e;color:#ffffff;
                text-decoration:none;border-radius:8px;font-weight:600;font-family:Arial,sans-serif;">
        ✅ Buyurtmani qabul qilish
      </a>
      <p style="font-size:13px;color:#888;margin-top:10px;font-family:Arial,sans-serif;">
        Bosganingizda mijozga (${escapeHtml(order.email)}) buyurtma qabul qilingani haqida xabar
        ${order.lang === "ru" ? "rus tilida" : "o'zbek tilida"} avtomatik yuboriladi.
      </p>`
    : `<p style="font-family:Arial,sans-serif;color:#c0392b;">
        Mijoz email manzil kiritmagan — qabul xabarini telefon/Telegram orqali qo'lda yuboring.
      </p>`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#2b2b2b;margin-bottom:4px;">🛒 Yangi buyurtma #${escapeHtml(order.id)}</h2>
      <p style="color:#666;margin-top:0;">${new Date(order.createdAt).toLocaleString("uz-UZ")}</p>
      <p>
        <b>Ism:</b> ${escapeHtml(order.name)}<br>
        <b>Telefon:</b> ${escapeHtml(order.phone)}<br>
        ${order.email ? `<b>Email:</b> ${escapeHtml(order.email)}<br>` : ""}
        ${order.address ? `<b>Manzil:</b> ${escapeHtml(order.address)}<br>` : ""}
        ${order.comment ? `<b>Izoh:</b> ${escapeHtml(order.comment)}<br>` : ""}
        <b>Til:</b> ${order.lang === "ru" ? "Rus" : "O'zbek"}
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        ${buildAdminItemsRows(order.items)}
      </table>
      <p style="font-size:17px;"><b>Jami: ${fmtSom(order.total)}</b></p>
      ${acceptBlock}
    </div>`;

  return sendMailSafe(
    {
      to: adminEmail,
      subject: `🛒 Yangi buyurtma #${order.id} — ${fmtSom(order.total)}`,
      html,
    },
    `buyurtma #${order.id} xabari`
  );
}

// --- Admin notification: contact form ------------------------------------

async function sendAdminContactEmail(entry) {
  const adminEmail = process.env.ADMIN_EMAIL || "machtigermond@gmail.com";

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#2b2b2b;">✉️ Yangi xabar (Aloqa formasi)</h2>
      <p>
        <b>Ism:</b> ${escapeHtml(entry.name)}<br>
        <b>Aloqa:</b> ${escapeHtml(entry.contact)}<br>
        ${entry.email ? `<b>Email:</b> ${escapeHtml(entry.email)}<br>` : ""}
      </p>
      <p style="white-space:pre-wrap;border-top:1px solid #eee;padding-top:12px;">${escapeHtml(entry.message)}</p>
    </div>`;

  return sendMailSafe(
    {
      to: adminEmail,
      replyTo: entry.email || undefined,
      subject: `✉️ Yangi xabar — ${entry.name}`,
      html,
    },
    "kontakt xabari"
  );
}

// --- Customer notification: order accepted (localized uz/ru) ------------

const CUSTOMER_TEXT = {
  uz: {
    subject: (id) => `✅ Buyurtmangiz qabul qilindi — #${id}`,
    heading: "Buyurtmangiz qabul qilindi!",
    greeting: (name) => `Assalomu alaykum, ${name}!`,
    body: "Sizning buyurtmangiz qabul qilindi. Tez orada ko'rsatgan telefon raqamingiz orqali siz bilan bog'lanamiz.",
    itemsTitle: "Buyurtma tarkibi:",
    total: "Jami",
    thanks: "Velira'ni tanlaganingiz uchun rahmat! 💙",
  },
  ru: {
    subject: (id) => `✅ Ваш заказ принят — #${id}`,
    heading: "Ваш заказ принят!",
    greeting: (name) => `Здравствуйте, ${name}!`,
    body: "Ваш заказ принят. Мы скоро свяжемся с вами по указанному номеру телефона.",
    itemsTitle: "Состав заказа:",
    total: "Итого",
    thanks: "Спасибо, что выбрали Velira! 💙",
  },
};

function buildCustomerItemsRows(items) {
  return items
    .map(
      (li) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(li.name)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">×${li.qty}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${fmtSom(li.price * li.qty)}</td>
      </tr>`
    )
    .join("");
}

async function sendCustomerAcceptedEmail(order) {
  if (!order.email) return { ok: false, skipped: true };

  const lang = order.lang === "ru" ? "ru" : "uz";
  const t = CUSTOMER_TEXT[lang];

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#2b2b2b;">${t.heading}</h2>
      <p>${t.greeting(escapeHtml(order.name))}</p>
      <p>${t.body}</p>
      <h4 style="margin-bottom:6px;">${t.itemsTitle}</h4>
      <table style="width:100%;border-collapse:collapse;margin:6px 0 16px;">
        ${buildCustomerItemsRows(order.items)}
      </table>
      <p style="font-size:16px;"><b>${t.total}: ${fmtSom(order.total)}</b></p>
      <p style="margin-top:22px;">${t.thanks}</p>
    </div>`;

  return sendMailSafe(
    {
      to: order.email,
      subject: t.subject(order.id),
      html,
    },
    `mijozga qabul xabari (#${order.id})`
  );
}

module.exports = {
  makeAcceptToken,
  verifyAcceptToken,
  sendAdminOrderEmail,
  sendAdminContactEmail,
  sendCustomerAcceptedEmail,
};
