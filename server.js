// CRUZY LINE Webhook Server v3
// SQLite database + Admin Dashboard + REST API
const express = require('express');
const cors = require('cors');
const { messagingApi, middleware } = require('@line/bot-sdk');
const PDFDocument = require('pdfkit');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ═══════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const LIFF_URL = process.env.LIFF_URL || 'https://liff.line.me/2009609185-pRes2K3v';
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
  : 'https://tuatid-production-13e1.up.railway.app';
const ADMIN_KEY = process.env.ADMIN_KEY || 'cruzy2024';

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

// ═══════════════════════════════════════════════
//  SQLite DATABASE
// ═══════════════════════════════════════════════
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const pdfDir = path.join(dataDir, 'pdfs');
if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });

// ── Thai Font Setup (Sarabun from Google Fonts) ──
const fontDir = path.join(dataDir, 'fonts');
if (!fs.existsSync(fontDir)) fs.mkdirSync(fontDir, { recursive: true });

const FONT_FILES = {
  'Sarabun-Regular.ttf': 'https://github.com/google/fonts/raw/main/ofl/sarabun/Sarabun-Regular.ttf',
  'Sarabun-Bold.ttf': 'https://github.com/google/fonts/raw/main/ofl/sarabun/Sarabun-Bold.ttf',
};

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    };
    get(url);
  });
}

async function ensureFonts() {
  for (const [name, url] of Object.entries(FONT_FILES)) {
    const fp = path.join(fontDir, name);
    if (fs.existsSync(fp) && fs.statSync(fp).size > 10000) continue;
    try {
      console.log('Downloading font: ' + name);
      await downloadFile(url, fp);
      console.log('Font downloaded: ' + name + ' (' + fs.statSync(fp).size + ' bytes)');
    } catch (e) {
      console.error('Font download failed: ' + name, e.message);
    }
  }
}

// Download fonts at startup
ensureFonts().catch(e => console.error('Font init error:', e));

const FONT_REGULAR = path.join(fontDir, 'Sarabun-Regular.ttf');
const FONT_BOLD = path.join(fontDir, 'Sarabun-Bold.ttf');

const db = new Database(path.join(dataDir, 'cruzy.db'));
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category_id INTEGER DEFAULT NULL,
    size TEXT NOT NULL DEFAULT 'big',
    stock INTEGER NOT NULL DEFAULT 0,
    price REAL DEFAULT 0,
    image_url TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT UNIQUE NOT NULL,
    user_id TEXT,
    big_items TEXT DEFAULT '[]',
    small_items TEXT DEFAULT '[]',
    total INTEGER DEFAULT 0,
    status TEXT DEFAULT 'confirmed',
    note TEXT DEFAULT '',
    pdf_url TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    size TEXT NOT NULL,
    qty INTEGER DEFAULT 1,
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
  );

  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
`);

// ── Migration: add 'code' column if not exists ──
try {
  db.prepare("SELECT code FROM products LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE products ADD COLUMN code TEXT DEFAULT ''");
  console.log('Migration: added code column to products');
}

// ═══════════════════════════════════════════════
//  EXPRESS APP
// ═══════════════════════════════════════════════
const app = express();
app.use(cors());
app.use('/pdf', express.static(pdfDir));

// ── Health check ──
app.get('/', (req, res) => {
  res.json({
    service: 'CRUZY Webhook', version: '3.0', status: 'running',
    endpoints: {
      admin: '/admin',
      categories: '/api/categories',
      products: '/api/products',
      orders: '/api/orders',
      stock: '/api/stock',
      stats: '/api/stats',
    }
  });
});

// ═══════════════════════════════════════════════
//  ADMIN DASHBOARD (served as HTML)
// ═══════════════════════════════════════════════
app.get('/admin', (req, res) => {
  const adminHtml = path.join(__dirname, 'admin.html');
  if (fs.existsSync(adminHtml)) {
    res.sendFile(adminHtml);
  } else {
    res.send('<h1>Admin file not found. Deploy admin.html to the server.</h1>');
  }
});

// ═══════════════════════════════════════════════
//  API: CATEGORIES
// ═══════════════════════════════════════════════
app.get('/api/categories', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
  res.json({ count: cats.length, categories: cats });
});

app.post('/api/categories', express.json(), (req, res) => {
  const { key, name, slug, sort_order } = req.body;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const s = slug || name.toLowerCase().replace(/[^a-z0-9ก-๙]+/g, '-').replace(/-+$/, '');
  const result = db.prepare('INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)').run(name, s, sort_order || 0);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/categories/:id', express.json(), (req, res) => {
  const { key, name, slug, sort_order, active } = req.body;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const updates = []; const vals = [];
  if (name !== undefined) { updates.push('name = ?'); vals.push(name); }
  if (slug !== undefined) { updates.push('slug = ?'); vals.push(slug); }
  if (sort_order !== undefined) { updates.push('sort_order = ?'); vals.push(sort_order); }
  if (active !== undefined) { updates.push('active = ?'); vals.push(active ? 1 : 0); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare('UPDATE categories SET ' + updates.join(', ') + ' WHERE id = ?').run(...vals);
  res.json({ success: true });
});

app.delete('/api/categories/:id', express.json(), (req, res) => {
  const key = req.body.key || req.query.key;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(req.params.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
//  API: PRODUCTS
// ═══════════════════════════════════════════════

// GET /api/products — list all (with category name)
app.get('/api/products', (req, res) => {
  const { size, active, category_id } = req.query;
  let sql = 'SELECT p.*, c.name as category_name, c.slug as category_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE 1=1';
  const params = [];
  if (size) { sql += ' AND p.size = ?'; params.push(size); }
  if (active !== undefined) { sql += ' AND p.active = ?'; params.push(active === 'true' ? 1 : 0); }
  if (category_id) { sql += ' AND p.category_id = ?'; params.push(parseInt(category_id)); }
  sql += ' ORDER BY p.sort_order, p.id';
  const products = db.prepare(sql).all(...params);
  res.json({ count: products.length, products });
});

// POST /api/products — add product
app.post('/api/products', express.json(), (req, res) => {
  const { key, name, code, size, stock, price, image_url, active, sort_order, category_id } = req.body;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const stmt = db.prepare(
    'INSERT INTO products (name, code, category_id, size, stock, price, image_url, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(name || 'New', code || '', category_id || null, size || 'big', stock || 0, price || 0, image_url || '', active !== false ? 1 : 0, sort_order || 0);
  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/products/:id — update product
app.put('/api/products/:id', express.json(), (req, res) => {
  const { key, ...fields } = req.body;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });

  const allowed = ['name', 'code', 'category_id', 'size', 'stock', 'price', 'image_url', 'active', 'sort_order'];
  const updates = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      updates.push(k + ' = ?');
      values.push(v);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields' });

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare('UPDATE products SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
  res.json({ success: true });
});

// DELETE /api/products/:id
app.delete('/api/products/:id', express.json(), (req, res) => {
  const key = req.body.key || req.query.key;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/products/bulk — bulk add products
app.post('/api/products/bulk', express.json(), (req, res) => {
  const { key, products } = req.body;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
  if (!Array.isArray(products)) return res.status(400).json({ error: 'products must be array' });

  const stmt = db.prepare(
    'INSERT INTO products (name, code, category_id, size, stock, price, image_url, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insert = db.transaction((items) => {
    let count = 0;
    for (const p of items) {
      stmt.run(p.name || 'New', p.code || '', p.category_id || null, p.size || 'big', p.stock || 0, p.price || 0, p.image_url || '', p.active !== false ? 1 : 0, p.sort_order || 0);
      count++;
    }
    return count;
  });

  const count = insert(products);
  res.json({ success: true, inserted: count });
});

// GET /api/products/grouped — products grouped by category (for LIFF)
app.get('/api/products/grouped', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order, id').all();
  const products = db.prepare(
    'SELECT p.*, c.name as category_name, c.slug as category_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.active = 1 ORDER BY CASE WHEN p.stock <= 0 THEN 1 ELSE 0 END, p.code ASC, p.sort_order, p.id'
  ).all();

  // Group by category
  const grouped = [];
  const catMap = {};
  cats.forEach(c => { catMap[c.id] = { ...c, products: [] }; });

  // Uncategorized bucket
  const uncategorized = { id: 0, name: 'อื่นๆ', slug: 'other', products: [] };

  products.forEach(p => {
    if (p.category_id && catMap[p.category_id]) {
      catMap[p.category_id].products.push(p);
    } else {
      uncategorized.products.push(p);
    }
  });

  cats.forEach(c => {
    if (catMap[c.id].products.length > 0) {
      grouped.push({ category: catMap[c.id].name, slug: catMap[c.id].slug, products: catMap[c.id].products });
    }
  });
  if (uncategorized.products.length > 0) {
    grouped.push({ category: uncategorized.name, slug: uncategorized.slug, products: uncategorized.products });
  }

  res.json({ count: products.length, groups: grouped });
});

// ═══════════════════════════════════════════════
//  API: STOCK
// ═══════════════════════════════════════════════
app.get('/api/stock', (req, res) => {
  const stock = db.prepare('SELECT id, name, size, stock, active FROM products ORDER BY size, id').all();
  res.json({ count: stock.length, stock });
});

app.post('/api/stock/update', express.json(), (req, res) => {
  const { key, updates } = req.body;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });

  const stmt = db.prepare('UPDATE products SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?');
  const update = db.transaction((items) => {
    for (const u of items) stmt.run(u.stock, u.id);
  });
  update(updates);
  res.json({ success: true, updated: updates.length });
});

// ═══════════════════════════════════════════════
//  API: ORDERS
// ═══════════════════════════════════════════════
app.get('/api/orders', (req, res) => {
  const { limit, offset, status, from, to, key } = req.query;
  const auth = key === ADMIN_KEY;
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];

  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (from) { sql += ' AND created_at >= ?'; params.push(from); }
  if (to) { sql += ' AND created_at <= ?'; params.push(to); }

  sql += ' ORDER BY created_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
  if (offset) { sql += ' OFFSET ?'; params.push(parseInt(offset)); }

  let orders = db.prepare(sql).all(...params);
  if (!auth) orders = orders.map(o => ({ ...o, user_id: undefined }));

  // Parse JSON fields
  orders = orders.map(o => ({
    ...o,
    big_items: JSON.parse(o.big_items || '[]'),
    small_items: JSON.parse(o.small_items || '[]'),
  }));

  const total = db.prepare('SELECT COUNT(*) as cnt FROM orders').get().cnt;
  res.json({ total, count: orders.length, orders });
});

app.get('/api/orders/:orderId', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Not found' });
  order.big_items = JSON.parse(order.big_items || '[]');
  order.small_items = JSON.parse(order.small_items || '[]');
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.orderId);
  res.json(order);
});

// Update order status
app.put('/api/orders/:orderId', express.json(), (req, res) => {
  const { key, status, note } = req.body;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });

  const updates = [];
  const values = [];
  if (status) { updates.push('status = ?'); values.push(status); }
  if (note !== undefined) { updates.push('note = ?'); values.push(note); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  values.push(req.params.orderId);
  db.prepare('UPDATE orders SET ' + updates.join(', ') + ' WHERE order_id = ?').run(...values);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
//  API: STATS (for dashboard)
// ═══════════════════════════════════════════════
app.get('/api/stats', (req, res) => {
  const totalProducts = db.prepare('SELECT COUNT(*) as cnt FROM products').get().cnt;
  const activeProducts = db.prepare('SELECT COUNT(*) as cnt FROM products WHERE active = 1').get().cnt;
  const totalOrders = db.prepare('SELECT COUNT(*) as cnt FROM orders').get().cnt;
  const todayOrders = db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE created_at >= date('now')").get().cnt;
  const totalItems = db.prepare('SELECT SUM(total) as s FROM orders').get().s || 0;
  const lowStock = db.prepare('SELECT COUNT(*) as cnt FROM products WHERE stock <= 5 AND active = 1').get().cnt;

  // Orders per day (last 7 days)
  const daily = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as orders, SUM(total) as items
    FROM orders WHERE created_at >= date('now', '-7 days')
    GROUP BY date(created_at) ORDER BY day
  `).all();

  // Top products
  const topProducts = db.prepare(`
    SELECT product_id, p.name, p.size, COUNT(*) as order_count
    FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id
    GROUP BY product_id ORDER BY order_count DESC LIMIT 10
  `).all();

  res.json({
    products: { total: totalProducts, active: activeProducts, lowStock },
    orders: { total: totalOrders, today: todayOrders, totalItems },
    daily, topProducts,
  });
});

// ═══════════════════════════════════════════════
//  POST /order — from LIFF
// ═══════════════════════════════════════════════
app.post('/order', express.json(), async (req, res) => {
  try {
    const { items, userId } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'missing items' });
    }

    // Generate order ID
    const orderId = '#CRZ' + Date.now().toString().slice(-6);
    const total = items.length;

    const now = new Date();
    const dateStr =
      now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');

    // ── Check stock before processing ──
    const outOfStock = [];
    const getProduct = db.prepare('SELECT id, name, stock FROM products WHERE id = ?');
    for (const it of items) {
      const prod = getProduct.get(it.product_id);
      if (!prod || prod.stock < (it.quantity || 1)) {
        outOfStock.push({ product_id: it.product_id, name: it.name || (prod && prod.name) || 'Unknown', available: prod ? prod.stock : 0 });
      }
    }
    if (outOfStock.length > 0) {
      return res.status(409).json({
        error: 'out_of_stock',
        message: 'สินค้าบางรายการหมดแล้ว',
        outOfStock
      });
    }

    // Calculate total price
    let totalPrice = 0;
    items.forEach(it => { totalPrice += (it.price || 0) * (it.quantity || 1); });

    // ── Save order to DB ────────────────
    db.prepare(`
      INSERT OR IGNORE INTO orders (order_id, user_id, big_items, small_items, total, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'confirmed', ?)
    `).run(orderId, userId || null, JSON.stringify(items), '[]', total, dateStr);

    // ── Save order items + update stock ─
    const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, size, qty) VALUES (?, ?, ?, ?)');
    const decStock = db.prepare('UPDATE products SET stock = MAX(0, stock - ?), updated_at = datetime(\'now\') WHERE id = ?');
    const processItems = db.transaction((orderItems) => {
      for (const it of orderItems) {
        const qty = it.quantity || 1;
        insertItem.run(orderId, it.product_id, 'standard', qty);
        decStock.run(qty, it.product_id);
      }
    });
    processItems(items);

    // ── Get product details for PDF ─────
    const allProducts = db.prepare('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id').all();

    // ── Generate PDF ────────────────────
    const filename = orderId.replace('#', '') + '.pdf';
    const filepath = path.join(pdfDir, filename);
    const pdfUrl = BASE_URL + '/pdf/' + filename;

    await generatePDF(filepath, { orderId, items, total, totalPrice, dateStr, products: allProducts });

    // Update order with PDF URL
    db.prepare('UPDATE orders SET pdf_url = ? WHERE order_id = ?').run(pdfUrl, orderId);

    // ── Push Flex Message ───────────────
    if (userId) {
      try {
        const flexMsg = buildReceiptFlex(orderId, items, total, totalPrice, dateStr, pdfUrl, allProducts);
        await client.pushMessage({ to: userId, messages: [flexMsg] });
      } catch (e) { console.error('Push error:', e.message); }
    }

    res.json({ success: true, orderId, pdfUrl, date: dateStr });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════
//  PDF GENERATION
// ═══════════════════════════════════════════════
function generatePDF(filepath, data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    // Register Thai fonts if available
    const hasThai = fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD) &&
                    fs.statSync(FONT_REGULAR).size > 10000 && fs.statSync(FONT_BOLD).size > 10000;
    const fontR = hasThai ? 'Thai' : 'Helvetica';
    const fontB = hasThai ? 'Thai-Bold' : 'Helvetica-Bold';
    if (hasThai) {
      doc.registerFont('Thai', FONT_REGULAR);
      doc.registerFont('Thai-Bold', FONT_BOLD);
    }

    const gold = '#C9A800';
    const dark = '#1a1a1a';
    const W = 595;

    // Header
    doc.rect(0, 0, W, 100).fill(dark);
    doc.fontSize(30).font(fontB).fillColor(gold).text('CRUZY', 0, 22, { align: 'center', width: W });
    doc.fontSize(10).font(fontR).fillColor('#aaa').text('3D Sticker Order Summary', 0, 56, { align: 'center', width: W });
    doc.fontSize(8).fillColor('#666').text('LINE: @cruzy', 0, 74, { align: 'center', width: W });

    // Info box
    const iy = 115;
    doc.roundedRect(40, iy, W - 80, 55, 6).fill('#f8f8f5');
    doc.fillColor('#333').fontSize(11).font(fontB);
    doc.text('Order: ' + data.orderId, 55, iy + 10);
    doc.fontSize(9).font(fontR).text('Date: ' + data.dateStr, 55, iy + 28);
    doc.fontSize(9).font(fontB).text('Status:', 350, iy + 10);
    doc.fillColor('#27ae60').font(fontR).text('Confirmed', 395, iy + 10);

    let y = iy + 70;

    // Group items by category
    const groups = {};
    (data.items || []).forEach(it => {
      const prod = data.products ? data.products.find(p => p.id === it.product_id) : null;
      const cat = (prod && prod.category_name) || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push({ ...it, productData: prod });
    });

    Object.keys(groups).forEach(cat => {
      const items = groups[cat];
      doc.fontSize(13).font(fontB).fillColor('#2c5282').text(cat + '  (' + items.length + ')', 40, y);
      y += 22;

      // Header row
      doc.roundedRect(40, y, W - 80, 20, 3).fill('#f0f0ee');
      doc.fontSize(8).font(fontB).fillColor('#666');
      doc.text('#', 50, y + 5); doc.text('Name', 80, y + 5);
      doc.text('Qty', 370, y + 5); doc.text('Price', 420, y + 5); doc.text('Status', 480, y + 5);
      y += 24;

      items.forEach((it, i) => {
        if (i % 2 === 0) doc.rect(40, y - 2, W - 80, 20).fill('#fafaf8');
        const pName = (it.productData && it.productData.name) || it.name || '#' + it.product_id;
        const price = it.price || 0;
        doc.fontSize(9).font(fontR).fillColor('#333');
        doc.text(String(i + 1), 50, y + 3); doc.text(pName, 80, y + 3, { width: 280 });
        doc.text(String(it.quantity || 1), 370, y + 3);
        doc.text(price > 0 ? price.toLocaleString() + ' B' : '-', 420, y + 3);
        doc.fillColor('#27ae60').text('OK', 480, y + 3);
        y += 20;
      });
      y += 8;
    });

    // Total
    doc.moveTo(40, y).lineTo(W - 40, y).strokeColor(gold).lineWidth(2).stroke();
    y += 8;
    doc.roundedRect(40, y, W - 80, 40, 6).fill(dark);
    let totalText = 'TOTAL: ' + (data.total || 0) + ' items';
    if (data.totalPrice > 0) totalText += '  |  ' + data.totalPrice.toLocaleString() + ' Baht';
    doc.fontSize(15).font(fontB).fillColor(gold)
      .text(totalText, 0, y + 12, { align: 'center', width: W });
    y += 55;

    doc.fontSize(9).font(fontR).fillColor('#999')
      .text('Thank you for your order! CRUZY team will contact you within 24 hours.', 0, y, { align: 'center', width: W });

    // Footer
    doc.moveTo(40, 800).lineTo(W - 40, 800).strokeColor('#e0e0e0').lineWidth(0.5).stroke();
    doc.fontSize(7).font(fontR).fillColor('#ccc')
      .text('CRUZY Order System | ' + data.dateStr, 40, 805, { width: W - 80, align: 'center' });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ═══════════════════════════════════════════════
//  Flex Message
// ═══════════════════════════════════════════════
function buildReceiptFlex(orderId, items, total, totalPrice, dateStr, pdfUrl, allProducts) {
  const body = [
    { type: 'text', text: orderId, weight: 'bold', size: 'lg', color: '#1a1a1a' },
    { type: 'text', text: dateStr, size: 'xs', color: '#999999', margin: 'sm' },
    { type: 'separator', margin: 'lg' }
  ];

  // Group by category
  const groups = {};
  items.forEach(it => {
    const prod = allProducts ? allProducts.find(p => p.id === it.product_id) : null;
    const cat = (prod && prod.category_name) || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ ...it, productData: prod });
  });

  Object.keys(groups).forEach(cat => {
    const catItems = groups[cat];
    body.push({ type: 'box', layout: 'horizontal', margin: 'lg', contents: [
      { type: 'text', text: cat, weight: 'bold', size: 'sm', color: '#2c5282', flex: 2 },
      { type: 'text', text: catItems.length + ' items', size: 'sm', color: '#444444', align: 'end', flex: 1 }
    ]});

    // Show each item individually with qty
    catItems.forEach(it => {
      const pName = (it.productData && it.productData.name) || it.name || '#' + it.product_id;
      const qty = it.quantity || 1;
      const price = it.price || 0;
      const priceText = price > 0 ? (price * qty).toLocaleString() + ' B' : '-';
      body.push({ type: 'box', layout: 'horizontal', margin: 'sm', paddingStart: '8px', contents: [
        { type: 'text', text: pName, size: 'xs', color: '#555555', flex: 4, wrap: true },
        { type: 'text', text: 'x' + qty, size: 'xs', color: '#888888', flex: 1, align: 'center' },
        { type: 'text', text: priceText, size: 'xs', color: '#555555', flex: 2, align: 'end' }
      ]});
    });
  });

  body.push({ type: 'separator', margin: 'lg' });
  let totalText = total + ' items';
  if (totalPrice > 0) totalText += ' | ' + totalPrice.toLocaleString() + ' B';
  body.push({ type: 'box', layout: 'horizontal', margin: 'lg', contents: [
    { type: 'text', text: 'Total', weight: 'bold', size: 'md', color: '#1a1a1a' },
    { type: 'text', text: totalText, weight: 'bold', size: 'md', color: '#C9A800', align: 'end' }
  ]});

  return {
    type: 'flex', altText: 'CRUZY Order ' + orderId,
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#1a1a1a', paddingAll: '16px', contents: [
        { type: 'text', text: 'CRUZY', color: '#F5C518', weight: 'bold', size: 'lg', align: 'center' },
        { type: 'text', text: 'Order Confirmed', color: '#ffffff', size: 'xs', align: 'center', margin: 'sm' }
      ]},
      body: { type: 'box', layout: 'vertical', contents: body, paddingAll: '16px' },
      footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [
        { type: 'button', action: { type: 'uri', label: 'Download PDF', uri: pdfUrl }, style: 'primary', color: '#F5C518' },
        { type: 'text', text: 'CRUZY team will contact you within 24 hrs.', size: 'xxs', color: '#999999', align: 'center', margin: 'md' }
      ]}
    }
  };
}

// ═══════════════════════════════════════════════
//  LINE Webhook
// ═══════════════════════════════════════════════
app.post('/webhook', middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ success: true }))
    .catch(err => { console.error(err); res.status(500).end(); });
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;
  const text = event.message.text.trim().toLowerCase();
  const keywords = ['สั่งตัวติด', 'ตัวติด', 'sticker', '3d'];
  if (!keywords.some(kw => text.includes(kw.toLowerCase()))) return null;

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{
      type: 'flex', altText: 'สั่งตัวติด 3D - CRUZY',
      contents: {
        type: 'bubble', size: 'mega',
        header: { type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: '#1a1a1a', contents: [
          { type: 'box', layout: 'vertical', backgroundColor: '#1a1a1a', cornerRadius: '12px', paddingAll: '20px', contents: [
            { type: 'text', text: 'CRUZY', color: '#F5C518', size: 'xs', weight: 'bold', align: 'center' }
          ]}
        ]},
        body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: [
          { type: 'text', text: '✨ สั่งตัวติด 3D', weight: 'bold', size: 'lg', color: '#333333' },
          { type: 'text', text: 'เลือกลาย/เลือกไซห์ สั่งได้หลายแบบ', size: 'sm', color: '#888888', margin: 'md', wrap: true }
        ]},
        footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [
          { type: 'button', action: { type: 'uri', label: 'เปิดสั่งซื้อ', uri: LIFF_URL }, style: 'primary', color: '#F5C518' }
        ]}
      }
    }]
  });
}

// ═══════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('CRUZY v3 running on port ' + PORT);
  console.log('Admin: ' + BASE_URL + '/admin');
  console.log('API: ' + BASE_URL + '/api/products');
  const cnt = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  console.log('Products in DB: ' + cnt);
});
