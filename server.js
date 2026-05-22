import "dotenv/config";
import express from "express";
import { randomUUID } from "crypto";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.warn("[warn] MP_ACCESS_TOKEN not set — copy .env.example to .env and add credentials before checkout will work.");
}

const mp = ACCESS_TOKEN ? new MercadoPagoConfig({ accessToken: ACCESS_TOKEN }) : null;

const CATALOG = [
  { id: 1, title: "Classic White Tee",    price: 449 },
  { id: 2, title: "Midnight Black Tee",   price: 469 },
  { id: 3, title: "Forest Green Tee",     price: 509 },
  { id: 4, title: "Sunset Orange Tee",    price: 489 },
  { id: 5, title: "Ocean Blue Tee",       price: 469 },
  { id: 6, title: "Heather Grey Tee",     price: 449 },
  { id: 7, title: "Burgundy Red Tee",     price: 509 },
  { id: 8, title: "Mustard Yellow Tee",   price: 489 },
];

const orders = new Map();

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.post("/api/create-preference", async (req, res) => {
  if (!mp) {
    return res.status(503).json({ error: "Payment provider not configured" });
  }

  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty or malformed" });
  }

  const validatedItems = [];
  for (const item of items) {
    const product = CATALOG.find(p => p.id === item.id);
    if (!product) {
      return res.status(400).json({ error: `Unknown product id ${item.id}` });
    }
    const qty = Number.parseInt(item.qty, 10);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 99) {
      return res.status(400).json({ error: `Invalid quantity for product ${item.id}` });
    }
    validatedItems.push({
      id: String(product.id),
      title: product.title,
      quantity: qty,
      unit_price: product.price,
      currency_id: "MXN",
    });
  }

  const orderId = randomUUID();
  orders.set(orderId, { status: "created", createdAt: new Date().toISOString(), items: validatedItems });

  try {
    const result = await new Preference(mp).create({
      body: {
        items: validatedItems,
        back_urls: {
          success: `${BASE_URL}/success.html`,
          failure: `${BASE_URL}/failure.html`,
          pending: `${BASE_URL}/pending.html`,
        },
        auto_return: "approved",
        payment_methods: {
          excluded_payment_types: [
            { id: "bank_transfer" },
            { id: "digital_wallet" },
            { id: "atm" },
          ],
          installments: 12,
        },
        notification_url: `${BASE_URL}/api/webhook`,
        external_reference: orderId,
        statement_descriptor: "TEE HAVEN",
      },
    });

    return res.json({
      id: result.id,
      init_point: result.init_point,
      external_reference: orderId,
    });
  } catch (err) {
    console.error("[create-preference] failed", err?.message || err);
    orders.delete(orderId);
    return res.status(502).json({ error: "Failed to create payment preference" });
  }
});

app.post("/api/webhook", async (req, res) => {
  res.sendStatus(200);

  if (!mp) return;

  const type = req.body?.type || req.query?.type;
  const paymentId = req.body?.data?.id || req.query?.["data.id"];

  if (type !== "payment" || !paymentId) return;

  try {
    const payment = await new Payment(mp).get({ id: paymentId });
    const ref = payment.external_reference;
    if (!ref) return;
    const prev = orders.get(ref) || {};
    orders.set(ref, {
      ...prev,
      status: payment.status,
      paymentId: payment.id,
      method: payment.payment_method_id,
      updatedAt: new Date().toISOString(),
    });
    console.log(`[webhook] order ${ref} → ${payment.status} (${payment.payment_method_id})`);
  } catch (err) {
    console.error("[webhook] payment lookup failed", err?.message || err);
  }
});

app.get("/api/orders/:ref", (req, res) => {
  const order = orders.get(req.params.ref);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

app.listen(PORT, () => {
  console.log(`Tee Haven running at ${BASE_URL}`);
});
