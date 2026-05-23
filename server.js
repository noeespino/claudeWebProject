// Load environment variables from .env file
import "dotenv/config";
// Import Express framework for building the web server
import express from "express";
// Import randomUUID for generating unique order IDs
import { randomUUID } from "crypto";
// Import Mercado Pago SDK for payment processing
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
// Import path utilities for working with file paths
import path from "path";
// Import fileURLToPath to convert ES module URLs to file paths
import { fileURLToPath } from "url";

// Get the current file path (needed in ES modules where __filename is not available by default)
const __filename = fileURLToPath(import.meta.url);
// Get the directory name of the current file
const __dirname = path.dirname(__filename);

// Get server port from environment variable or default to 3000
const PORT = process.env.PORT || 3000;
// Get base URL for redirect callbacks or construct from localhost and port
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
// Get Mercado Pago access token from environment variables
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// Warn user if Mercado Pago token is not configured
if (!ACCESS_TOKEN) {
  console.warn("[warn] MP_ACCESS_TOKEN not set — copy .env.example to .env and add credentials before checkout will work.");
}

// Initialize Mercado Pago configuration if token exists, otherwise set to null
const mp = ACCESS_TOKEN ? new MercadoPagoConfig({ accessToken: ACCESS_TOKEN }) : null;

// Product catalog with t-shirt items (id, title, price in Mexican Pesos)
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

// In-memory Map to store orders by their unique reference ID
const orders = new Map();

// Create Express application instance
const app = express();
// Middleware to parse incoming JSON requests
app.use(express.json());
// Middleware to serve static files (HTML, CSS, JS) from the current directory
app.use(express.static(__dirname));

/**
 * POST /api/create-preference
 * Creates a Mercado Pago payment preference and stores the order
 * Expects request body: { items: [{id, qty}, ...] }
 */
app.post("/api/create-preference", async (req, res) => {
  // Check if Mercado Pago is configured
  if (!mp) {
    return res.status(503).json({ error: "Payment provider not configured" });
  }

  // Extract items from request body
  const { items } = req.body || {};
  // Validate that items is an array and not empty
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty or malformed" });
  }

  // Array to store validated items
  const validatedItems = [];
  // Validate each item in the cart
  for (const item of items) {
    // Find the product in catalog by ID
    const product = CATALOG.find(p => p.id === item.id);
    // Return error if product not found
    if (!product) {
      return res.status(400).json({ error: `Unknown product id ${item.id}` });
    }
    // Parse quantity as integer
    const qty = Number.parseInt(item.qty, 10);
    // Validate quantity is a valid number between 1 and 99
    if (!Number.isFinite(qty) || qty <= 0 || qty > 99) {
      return res.status(400).json({ error: `Invalid quantity for product ${item.id}` });
    }
    // Add validated item to the list
    validatedItems.push({
      id: String(product.id),
      title: product.title,
      quantity: qty,
      unit_price: product.price,
      currency_id: "MXN",
    });
  }

  // Generate unique order ID
  const orderId = randomUUID();
  // Store order in memory with initial status
  orders.set(orderId, { status: "created", createdAt: new Date().toISOString(), items: validatedItems });

  // Try to create Mercado Pago preference
  try {
    const result = await new Preference(mp).create({
      body: {
        items: validatedItems,
        // URLs to redirect user after payment
        back_urls: {
          success: `${BASE_URL}/success.html`,
          failure: `${BASE_URL}/failure.html`,
          pending: `${BASE_URL}/pending.html`,
        },
        // Automatically return after approved payment
        auto_return: "approved",
        // Payment method configuration
        payment_methods: {
          // Exclude certain payment types
          excluded_payment_types: [
            { id: "bank_transfer" },
            { id: "digital_wallet" },
            { id: "atm" },
          ],
          // Allow up to 12 installments
          installments: 12,
        },
        // Webhook URL to receive payment notifications
        notification_url: `${BASE_URL}/api/webhook`,
        // External reference to link preference with our order
        external_reference: orderId,
        // Statement descriptor shown on customer's bank statement
        statement_descriptor: "TEE HAVEN",
      },
    });

    // Return preference ID and init point (checkout URL) to client
    return res.json({
      id: result.id,
      init_point: result.init_point,
      external_reference: orderId,
    });
  } catch (err) {
    // Log error and clean up order if preference creation fails
    console.error("[create-preference] failed", err?.message || err);
    orders.delete(orderId);
    return res.status(502).json({ error: "Failed to create payment preference" });
  }
});

/**
 * POST /api/webhook
 * Receives payment status updates from Mercado Pago
 * Updates order status based on payment notifications
 */
app.post("/api/webhook", async (req, res) => {
  // Immediately respond to Mercado Pago (important for reliability)
  res.sendStatus(200);

  // Exit if Mercado Pago not configured
  if (!mp) return;

  // Extract payment type from request body or query parameters
  const type = req.body?.type || req.query?.type;
  // Extract payment ID from request body or query parameters
  const paymentId = req.body?.data?.id || req.query?.["data.id"];

  // Only process payment type notifications with valid payment ID
  if (type !== "payment" || !paymentId) return;

  // Try to fetch payment details from Mercado Pago
  try {
    const payment = await new Payment(mp).get({ id: paymentId });
    // Get external reference (our order ID) from payment
    const ref = payment.external_reference;
    // Skip if no reference found
    if (!ref) return;
    // Get existing order data or empty object
    const prev = orders.get(ref) || {};
    // Update order with payment status and details
    orders.set(ref, {
      ...prev,
      status: payment.status,
      paymentId: payment.id,
      method: payment.payment_method_id,
      updatedAt: new Date().toISOString(),
    });
    // Log successful status update
    console.log(`[webhook] order ${ref} → ${payment.status} (${payment.payment_method_id})`);
  } catch (err) {
    // Log error if payment lookup fails (but don't break the response)
    console.error("[webhook] payment lookup failed", err?.message || err);
  }
});

/**
 * GET /api/orders/:ref
 * Retrieves order details by external reference ID
 */
app.get("/api/orders/:ref", (req, res) => {
  // Fetch order from in-memory storage
  const order = orders.get(req.params.ref);
  // Return 404 if order not found
  if (!order) return res.status(404).json({ error: "Order not found" });
  // Return order data
  res.json(order);
});

// Start the Express server on the specified port
app.listen(PORT, () => {
  console.log(`Tee Haven running at ${BASE_URL}`);
});
