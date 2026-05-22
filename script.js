const PRODUCTS = [
  { id: 1, name: "Classic White Tee",    desc: "Soft 100% organic cotton everyday essential.", price: 449, color: "#f5f5f0", stroke: "#1a1a1a" },
  { id: 2, name: "Midnight Black Tee",   desc: "Pure black, premium combed cotton.",            price: 469, color: "#1a1a1a", stroke: "#ffffff" },
  { id: 3, name: "Forest Green Tee",     desc: "Earthy tones, sustainably sourced.",            price: 509, color: "#2d5a3d", stroke: "#ffffff" },
  { id: 4, name: "Sunset Orange Tee",    desc: "Bold and vibrant for warm days.",               price: 489, color: "#e67e3c", stroke: "#1a1a1a" },
  { id: 5, name: "Ocean Blue Tee",       desc: "Cool blue, breathable fabric.",                 price: 469, color: "#3a6ea5", stroke: "#ffffff" },
  { id: 6, name: "Heather Grey Tee",     desc: "Versatile heather grey staple.",                price: 449, color: "#9aa0a6", stroke: "#1a1a1a" },
  { id: 7, name: "Burgundy Red Tee",     desc: "Rich deep red, soft hand-feel.",                price: 509, color: "#7a1f2b", stroke: "#ffffff" },
  { id: 8, name: "Mustard Yellow Tee",   desc: "Statement piece with a vintage feel.",          price: 489, color: "#d4a017", stroke: "#1a1a1a" },
];

function formatMXN(n) {
  return `$${n.toFixed(2)} MXN`;
}

function tshirtSVG(fill, stroke) {
  return `
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <path d="M40 50 L70 30 L80 40 Q100 55 120 40 L130 30 L160 50 L150 80 L130 70 L130 170 L70 170 L70 70 L50 80 Z"
        fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
}

const STORAGE_KEY = "teehaven_cart_v1";
let cart = loadCart();

function loadCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
}

function findProduct(id) {
  return PRODUCTS.find(p => p.id === id);
}

function renderProducts() {
  const grid = document.getElementById("product-grid");
  grid.innerHTML = PRODUCTS.map(p => `
    <article class="product-card">
      <div class="product-image">${tshirtSVG(p.color, p.stroke)}</div>
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-desc">${p.desc}</div>
        <div class="product-footer">
          <span class="product-price">${formatMXN(p.price)}</span>
          <button class="add-btn" data-id="${p.id}">Add to cart</button>
        </div>
      </div>
    </article>
  `).join("");

  grid.querySelectorAll(".add-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      addToCart(parseInt(btn.dataset.id, 10));
      openCart();
    });
  });
}

function addToCart(id) {
  const existing = cart.find(item => item.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ id, qty: 1 });
  }
  saveCart();
  renderCart();
}

function updateQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(i => i.id !== id);
  }
  saveCart();
  renderCart();
}

function removeFromCart(id) {
  cart = cart.filter(i => i.id !== id);
  saveCart();
  renderCart();
}

function renderCart() {
  const itemsEl = document.getElementById("cart-items");
  const countEl = document.getElementById("cart-count");
  const totalEl = document.getElementById("cart-total");
  const checkoutBtn = document.getElementById("checkout-btn");

  const itemCount = cart.reduce((sum, i) => sum + i.qty, 0);
  countEl.textContent = itemCount;

  if (cart.length === 0) {
    itemsEl.innerHTML = `<div class="cart-empty">Your cart is empty.</div>`;
    totalEl.textContent = formatMXN(0);
    checkoutBtn.disabled = true;
    return;
  }

  let total = 0;
  itemsEl.innerHTML = cart.map(item => {
    const p = findProduct(item.id);
    if (!p) return "";
    const lineTotal = p.price * item.qty;
    total += lineTotal;
    return `
      <div class="cart-item">
        <div class="cart-item-img">${tshirtSVG(p.color, p.stroke)}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${p.name}</div>
          <div class="cart-item-price">${formatMXN(p.price)} each</div>
          <div class="cart-item-controls">
            <button class="qty-btn" data-action="dec" data-id="${p.id}">&minus;</button>
            <span class="qty-value">${item.qty}</span>
            <button class="qty-btn" data-action="inc" data-id="${p.id}">+</button>
            <button class="remove-btn" data-action="remove" data-id="${p.id}">Remove</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  totalEl.textContent = formatMXN(total);
  checkoutBtn.disabled = false;

  itemsEl.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.id, 10);
      const action = btn.dataset.action;
      if (action === "inc") updateQty(id, +1);
      else if (action === "dec") updateQty(id, -1);
      else if (action === "remove") removeFromCart(id);
    });
  });
}

function openCart() {
  document.getElementById("cart-drawer").classList.add("open");
  document.getElementById("cart-overlay").classList.add("open");
}

function closeCart() {
  document.getElementById("cart-drawer").classList.remove("open");
  document.getElementById("cart-overlay").classList.remove("open");
}

function initEvents() {
  document.getElementById("cart-toggle").addEventListener("click", openCart);
  document.getElementById("cart-close").addEventListener("click", closeCart);
  document.getElementById("cart-overlay").addEventListener("click", closeCart);
  document.getElementById("checkout-btn").addEventListener("click", async () => {
    const btn = document.getElementById("checkout-btn");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Redirecting…";
    try {
      const res = await fetch("/api/create-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cart }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Checkout failed");
      }
      const data = await res.json();
      if (!data.init_point) throw new Error("Missing checkout URL");
      window.location.href = data.init_point;
    } catch (err) {
      console.error("Checkout error", err);
      alert("Could not start checkout. Please try again.");
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderProducts();
  renderCart();
  initEvents();
});
