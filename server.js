require("dotenv").config();

const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const http = require("http");
const { Server } = require("socket.io");
const OpenAI = require("openai");




const app = express();
const server = http.createServer(app);

/* =========================
   ADMINISTRATION
========================= */









const io = new Server(server);
const db = new Database("discuteapp.db");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// ============================================================
// ADMIN AVANCE / DISCUTEBOT / QUIZ
// ============================================================

try {
  db.exec(`ALTER TABLE users ADD COLUMN admin_panel INTEGER NOT NULL DEFAULT 0`);
} catch (_) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mood TEXT NOT NULL DEFAULT 'sympathique',
    style TEXT NOT NULL DEFAULT 'naturel et utile',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  INSERT OR IGNORE INTO bot_settings (id, mood, style)
  VALUES (1, 'sympathique', 'naturel et utile');

  CREATE TABLE IF NOT EXISTS quiz_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  INSERT OR IGNORE INTO quiz_settings (id, enabled)
  VALUES (1, 1);

  CREATE TABLE IF NOT EXISTS quiz_difficulties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    reward INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1
  );

  INSERT OR IGNORE INTO quiz_difficulties (code,name,reward,enabled)
  VALUES
    ('easy','Facile',100,1),
    ('medium','Moyen',250,1),
    ('hard','Difficile',500,1);

  CREATE TABLE IF NOT EXISTS quiz_question_settings (
    question_id INTEGER PRIMARY KEY,
    difficulty TEXT NOT NULL DEFAULT 'easy',
    enabled INTEGER NOT NULL DEFAULT 1
  );
`);



// Thèmes du quiz activés
app.get("/api/game/quiz/themes", (req, res) => {
  try {
    const themes = db.prepare(`
      SELECT id, name
      FROM quiz_themes
      WHERE enabled = 1
      ORDER BY id ASC
    `).all();

    res.json({ themes });
  } catch (error) {
    console.error("Erreur chargement thèmes quiz :", error);
    res.status(500).json({
      error: "Impossible de charger les thèmes."
    });
  }
});

const PORT = 3000;

const JWT_SECRET = process.env.JWT_SECRET || "change-moi-cette-cle-secrete";

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

db.exec(`

  CREATE TABLE IF NOT EXISTS bot_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bot_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );


  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    gems INTEGER NOT NULL DEFAULT 0,
    banned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS public_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS directory_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS shop_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_data TEXT NOT NULL DEFAULT '{}',
    price INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    discount_percent INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    equipped INTEGER NOT NULL DEFAULT 0,
    purchased_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, item_id)
  );
`);

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const token = req.cookies.discuteapp_session;

  if (!token) {
    return res.status(401).json({ error: "Non connecté." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare("SELECT id, username, role, gems, banned, admin_panel FROM users WHERE id = ?")
      .get(decoded.id);

    if (!user || user.banned) {
      return res.status(401).json({ error: "Session invalide." });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Session invalide." });
  }
}



app.post("/api/game/quiz/reward", auth, (req, res) => {
  const score = Number(req.body.score);

  const rewards = {
    8: 100,
    9: 250,
    10: 500
  };

  const reward = rewards[score] || 0;

  if (reward === 0) {
    return res.json({
      success: true,
      reward: 0,
      gems: req.user.gems
    });
  }

  db.prepare(`
    UPDATE users
    SET gems = COALESCE(gems, 0) + ?
    WHERE id = ?
  `).run(reward, req.user.id);

  const updatedUser = db
    .prepare("SELECT gems FROM users WHERE id = ?")
    .get(req.user.id);

  res.json({
    success: true,
    reward,
    gems: updatedUser.gems
  });
});



function ownerOnly(req, res, next) {
  if (req.user && req.user.username === "chilladmin") {
    return next();
  }

  return res.status(403).json({
    success: false,
    error: "Seul chilladmin peut modifier les permissions Admin."
  });
}

function chilladminOnly(req, res, next) {
  if (
    req.user &&
    (
      req.user.username === "chilladmin" ||
      Number(req.user.admin_panel) === 1
    )
  ) {
    return next();
  }

  return res.status(403).json({
    success: false,
    error: "Accès au panneau Admin refusé."
  });
}

app.get("/admin.html", auth, chilladminOnly, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

/* =========================
   API ADMIN - COMPTES
========================= */


app.patch("/api/admin/users/:id/admin-access", auth, ownerOnly, (req, res) => {
  const id = Number(req.params.id);
  const enabled = Number(Boolean(req.body?.enabled));

  const target = db.prepare(`
    SELECT id, username
    FROM users
    WHERE id = ?
  `).get(id);

  if (!target) {
    return res.status(404).json({
      success: false,
      error: "Utilisateur introuvable."
    });
  }

  if (target.username === "chilladmin") {
    return res.status(400).json({
      success: false,
      error: "Le compte principal ne peut pas perdre ses droits."
    });
  }

  db.prepare(`
    UPDATE users
    SET admin_panel = ?
    WHERE id = ?
  `).run(enabled, id);

  res.json({
    success: true,
    admin_panel: enabled
  });
});

app.get("/api/admin/users", auth, chilladminOnly, (req, res) => {
  const search = String(req.query.search || "").trim();

  let users;

  if (search) {
    users = db.prepare(`
      SELECT id, username, role, gems, banned, created_at
      FROM users
      WHERE username LIKE ?
      ORDER BY id ASC
    `).all(`%${search}%`);
  } else {
    users = db.prepare(`
      SELECT id, username, role, gems, banned, created_at
      FROM users
      ORDER BY id ASC
    `).all();
  }

  res.json({
    success: true,
    users
  });
});


app.patch("/api/admin/users/:id/ban", auth, chilladminOnly, (req, res) => {
  const userId = Number(req.params.id);
  const banned = Number(req.body?.banned);

  if (!Number.isInteger(userId) || ![0, 1].includes(banned)) {
    return res.status(400).json({
      error: "Paramètres invalides."
    });
  }

  const user = db.prepare(`
    SELECT id, username, role
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!user) {
    return res.status(404).json({
      error: "Utilisateur introuvable."
    });
  }

  if (user.username === "chilladmin") {
    return res.status(403).json({
      error: "Impossible de modifier le compte principal."
    });
  }

  db.prepare(`
    UPDATE users
    SET banned = ?
    WHERE id = ?
  `).run(banned, userId);

  res.json({
    success: true,
    banned
  });
});


app.patch("/api/admin/users/:id/gems", auth, chilladminOnly, (req, res) => {
  const userId = Number(req.params.id);
  const gems = Number(req.body?.gems);

  if (!Number.isInteger(userId) || !Number.isInteger(gems) || gems < 0) {
    return res.status(400).json({
      error: "Nombre de gemmes invalide."
    });
  }

  const user = db.prepare(`
    SELECT id, username
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!user) {
    return res.status(404).json({
      error: "Utilisateur introuvable."
    });
  }

  db.prepare(`
    UPDATE users
    SET gems = ?
    WHERE id = ?
  `).run(gems, userId);

  res.json({
    success: true,
    gems
  });
});


app.delete("/api/admin/users/:id", auth, chilladminOnly, (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId)) {
    return res.status(400).json({
      error: "Identifiant invalide."
    });
  }

  const user = db.prepare(`
    SELECT id, username
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!user) {
    return res.status(404).json({
      error: "Utilisateur introuvable."
    });
  }

  if (user.username === "chilladmin") {
    return res.status(403).json({
      error: "Impossible de supprimer le compte principal."
    });
  }

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM user_items WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM bot_conversations WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM directory_posts WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM public_messages WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });

  transaction();

  res.json({
    success: true,
    message: "Utilisateur supprimé."
  });
});


/* =========================
   API ADMIN - BOUTIQUE
========================= */

app.get("/api/admin/shop/items", auth, chilladminOnly, (req, res) => {
  const items = db.prepare(`
    SELECT id, name, description, item_type, item_data, price, enabled, created_at, code, discount_percent
    FROM shop_items
    ORDER BY id DESC
  `).all();

  res.json({
    success: true,
    items
  });
});


app.post("/api/admin/shop/items", auth, chilladminOnly, (req, res) => {
  const name = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim();
  const itemType = String(req.body?.item_type || "").trim();
  const itemData = String(req.body?.item_data || "{}").trim();
  const code = String(req.body?.code || "").trim();
  const price = Number(req.body?.price);

  if (!name || !description || !itemType) {
    return res.status(400).json({
      error: "Nom, description et type sont obligatoires."
    });
  }

  if (!Number.isInteger(price) || price < 0) {
    return res.status(400).json({
      error: "Prix invalide."
    });
  }

  try {
    JSON.parse(itemData);
  } catch {
    return res.status(400).json({
      error: "item_data doit être un JSON valide."
    });
  }

  const result = db.prepare(`
    INSERT INTO shop_items
      (name, description, item_type, item_data, price, enabled, code, discount_percent)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    name,
    description,
    itemType,
    itemData,
    price,
    code || null,
    0
  );

  const item = db.prepare(`
    SELECT id, name, description, item_type, item_data, price, enabled, created_at, code, discount_percent
    FROM shop_items
    WHERE id = ?
  `).get(result.lastInsertRowid);

  res.json({
    success: true,
    item
  });
});


app.patch("/api/admin/shop/items/:id", auth, chilladminOnly, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({
      error: "Identifiant invalide."
    });
  }

  const existing = db.prepare(`
    SELECT *
    FROM shop_items
    WHERE id = ?
  `).get(id);

  if (!existing) {
    return res.status(404).json({
      error: "Objet introuvable."
    });
  }

  const name = req.body?.name !== undefined
    ? String(req.body.name).trim()
    : existing.name;

  const description = req.body?.description !== undefined
    ? String(req.body.description).trim()
    : existing.description;

  const itemType = req.body?.item_type !== undefined
    ? String(req.body.item_type).trim()
    : existing.item_type;

  const itemData = req.body?.item_data !== undefined
    ? String(req.body.item_data).trim()
    : existing.item_data;

  const code = req.body?.code !== undefined
    ? String(req.body.code).trim()
    : (existing.code || "");

  const price = req.body?.price !== undefined
    ? Number(req.body.price)
    : existing.price;

  const discountPercent = req.body?.discount_percent !== undefined
    ? Number(req.body.discount_percent)
    : Number(existing.discount_percent || 0);

  const enabled = req.body?.enabled !== undefined
    ? Number(req.body.enabled)
    : existing.enabled;

  if (!name || !description || !itemType) {
    return res.status(400).json({
      error: "Nom, description et type sont obligatoires."
    });
  }

  if (!Number.isInteger(price) || price < 0) {
    return res.status(400).json({
      error: "Prix invalide."
    });
  }

  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    return res.status(400).json({
      error: "Réduction invalide. Elle doit être comprise entre 0 et 100 %."
    });
  }

  if (![0, 1].includes(enabled)) {
    return res.status(400).json({
      error: "État invalide."
    });
  }

  try {
    JSON.parse(itemData);
  } catch {
    return res.status(400).json({
      error: "item_data doit être un JSON valide."
    });
  }

  db.prepare(`
    UPDATE shop_items
    SET
      name = ?,
      description = ?,
      item_type = ?,
      item_data = ?,
      price = ?,
      discount_percent = ?,
      enabled = ?,
      code = ?
    WHERE id = ?
  `).run(
    name,
    description,
    itemType,
    itemData,
    price,
    discountPercent,
    enabled,
    code || null,
    id
  );

  const item = db.prepare(`
    SELECT id, name, description, item_type, item_data, price, enabled, created_at, code, discount_percent
    FROM shop_items
    WHERE id = ?
  `).get(id);

  res.json({
    success: true,
    item
  });
});


app.delete("/api/admin/shop/items/:id", auth, chilladminOnly, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({
      error: "Identifiant invalide."
    });
  }

  const item = db.prepare(`
    SELECT id, name
    FROM shop_items
    WHERE id = ?
  `).get(id);

  if (!item) {
    return res.status(404).json({
      error: "Objet introuvable."
    });
  }

  db.prepare(`
    DELETE FROM shop_items
    WHERE id = ?
  `).run(id);

  res.json({
    success: true,
    message: "Objet supprimé."
  });
});


app.patch("/api/admin/shop/items/:id/toggle", auth, chilladminOnly, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({
      error: "Identifiant invalide."
    });
  }

  const item = db.prepare(`
    SELECT id, enabled
    FROM shop_items
    WHERE id = ?
  `).get(id);

  if (!item) {
    return res.status(404).json({
      error: "Objet introuvable."
    });
  }

  const enabled = item.enabled ? 0 : 1;

  db.prepare(`
    UPDATE shop_items
    SET enabled = ?
    WHERE id = ?
  `).run(enabled, id);

  res.json({
    success: true,
    enabled
  });
});


/* =========================
   API ADMIN - CHAT PUBLIC
========================= */

app.get("/api/admin/messages", auth, chilladminOnly, (req, res) => {
  const messages = db.prepare(`
    SELECT id, user_id, username, content, created_at
    FROM public_messages
    ORDER BY id DESC
    LIMIT 200
  `).all();

  res.json({
    success: true,
    messages
  });
});


app.post("/api/admin/announcement", auth, chilladminOnly, (req, res) => {
  const content = String(req.body?.content || "").trim();

  if (!content) {
    return res.status(400).json({
      error: "Le message est vide."
    });
  }

  if (content.length > 500) {
    return res.status(400).json({
      error: "L'annonce ne peut pas dépasser 500 caractères."
    });
  }

  const result = db.prepare(`
    INSERT INTO public_messages
      (user_id, username, content)
    VALUES (?, ?, ?)
  `).run(
    req.user.id,
    "📢 Annonce de l'admin",
    content
  );

  const message = db.prepare(`
    SELECT id, user_id, username, content, created_at
    FROM public_messages
    WHERE id = ?
  `).get(result.lastInsertRowid);

  io.emit("chat:message", message);

  res.json({
    success: true,
    message
  });
});


app.delete("/api/admin/messages/:id", auth, chilladminOnly, (req, res) => {
  const messageId = Number(req.params.id);

  if (!Number.isInteger(messageId)) {
    return res.status(400).json({
      error: "Identifiant invalide."
    });
  }

  const result = db.prepare(`
    DELETE FROM public_messages
    WHERE id = ?
  `).run(messageId);

  if (result.changes === 0) {
    return res.status(404).json({
      error: "Message introuvable."
    });
  }

  io.emit("chat:message_deleted", {
    id: messageId
  });

  res.json({
    success: true
  });
});


app.get("/api/me", auth, (req, res) => {
  const items = db.prepare(`
    SELECT si.item_type, si.item_data
    FROM user_items ui
    JOIN shop_items si ON si.id = ui.item_id
    WHERE ui.user_id = ? AND ui.equipped = 1
  `).all(req.user.id);

  const customization = {};

  for (const item of items) {
    customization[item.item_type] =
      JSON.parse(item.item_data || "{}");
  }

  res.json({
    user: {
      ...req.user,
      customization
    }
  });
});

app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({
      error: "Nom d'utilisateur ou mot de passe invalide."
    });
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(username);

  if (existing) {
    return res.status(409).json({
      error: "Ce nom d'utilisateur existe déjà."
    });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const result = db
    .prepare("INSERT INTO users (username, password) VALUES (?, ?)")
    .run(username, hashedPassword);

  const user = db
    .prepare("SELECT id, username, role, gems, banned, admin_panel FROM users WHERE id = ?")
    .get(result.lastInsertRowid);

  res.cookie("discuteapp_session", createToken(user), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.json({ user });
});

app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({
      error: "Identifiants incorrects."
    });
  }

  if (user.banned) {
    return res.status(403).json({
      error: "Ton compte est banni."
    });
  }

  res.cookie("discuteapp_session", createToken(user), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      gems: user.gems
    }
  });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("discuteapp_session");
  res.json({ success: true });
});

app.get("/api/directory", (req, res) => {
  const posts = db.prepare(`
    SELECT id, user_id, username, title, content, created_at, updated_at
    FROM directory_posts
    ORDER BY id DESC
  `).all();

  res.json({ posts });
});

app.post("/api/directory", auth, (req, res) => {
  const title = String(req.body.title || "").trim();
  const content = String(req.body.content || "").trim();

  if (!title || !content) {
    return res.status(400).json({
      error: "Le titre et la description sont obligatoires."
    });
  }

  if (title.length > 100 || content.length > 2000) {
    return res.status(400).json({
      error: "Le titre ou la description est trop long."
    });
  }

  const result = db.prepare(`
    INSERT INTO directory_posts
    (user_id, username, title, content)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, req.user.username, title, content);

  const post = db.prepare(`
    SELECT id, user_id, username, title, content, created_at, updated_at
    FROM directory_posts
    WHERE id = ?
  `).get(result.lastInsertRowid);

  res.json({ post });
});

app.put("/api/directory/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const title = String(req.body.title || "").trim();
  const content = String(req.body.content || "").trim();

  const post = db
    .prepare("SELECT * FROM directory_posts WHERE id = ?")
    .get(id);

  if (!post) {
    return res.status(404).json({ error: "Publication introuvable." });
  }

  if (post.user_id !== req.user.id && !["owner", "admin"].includes(req.user.role)) {
    return res.status(403).json({
      error: "Tu ne peux pas modifier cette publication."
    });
  }

  if (!title || !content) {
    return res.status(400).json({
      error: "Le titre et la description sont obligatoires."
    });
  }

  db.prepare(`
    UPDATE directory_posts
    SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(title, content, id);

  res.json({ success: true });
});

app.delete("/api/directory/:id", auth, (req, res) => {
  const id = Number(req.params.id);

  const post = db
    .prepare("SELECT * FROM directory_posts WHERE id = ?")
    .get(id);

  if (!post) {
    return res.status(404).json({ error: "Publication introuvable." });
  }

  if (post.user_id !== req.user.id && !["owner", "admin"].includes(req.user.role)) {
    return res.status(403).json({
      error: "Tu ne peux pas supprimer cette publication."
    });
  }

  db.prepare("DELETE FROM directory_posts WHERE id = ?").run(id);

  res.json({ success: true });
});

const DEFAULT_SHOP_ITEMS = [
  // ===== TITRES =====
  {
    name: "BG normal",
    description: "Titre classique BG.",
    item_type: "title",
    item_data: { text: "BG", className: "title-bg" },
    price: 1000
  },
  {
    name: "BG gold shiny",
    description: "Titre BG doré avec effet brillant.",
    item_type: "title",
    item_data: { text: "BG", className: "title-bg-gold" },
    price: 5000
  },
  {
    name: "Chatteur normal",
    description: "Titre pour les grands bavards.",
    item_type: "title",
    item_data: { text: "Chatteur", className: "title-chatteur" },
    price: 3000
  },
  {
    name: "Chatteur gold shiny",
    description: "Titre Chatteur doré et brillant.",
    item_type: "title",
    item_data: { text: "Chatteur", className: "title-chatteur-gold" },
    price: 10000
  },
  {
    name: "Admin jaune",
    description: "Titre Admin jaune.",
    item_type: "title",
    item_data: { text: "Admin", className: "title-admin" },
    price: 15000
  },
  {
    name: "Admin gold shiny",
    description: "Titre Admin doré avec éclat.",
    item_type: "title",
    item_data: { text: "Admin", className: "title-admin-gold" },
    price: 20000
  },
  {
    name: "EXCLUSIF DiscuteApp",
    description: "Titre exclusif avec bordure dorée et effet arc-en-ciel ondulant.",
    item_type: "title",
    item_data: { text: "EXCLUSIF DiscuteApp", className: "title-exclusive" },
    price: 100000
  },

  // ===== IMAGES =====
  {
    name: "Manga animé",
    description: "Avatar manga animé affiché à côté du pseudo.",
    item_type: "avatar",
    item_data: { src: "/shop-assets/manga.svg", className: "avatar-manga" },
    price: 5000
  },
  {
    name: "Vortex spatial bleu",
    description: "Magnifique vortex spatial bleu.",
    item_type: "avatar",
    item_data: { src: "/shop-assets/space-vortex.svg", className: "avatar-vortex" },
    price: 10000
  },
  {
    name: "Couronne diamant Admin",
    description: "Couronne diamant dorée.",
    item_type: "avatar",
    item_data: { src: "/shop-assets/admin-crown.svg", className: "avatar-crown" },
    price: 30000
  },
  {
    name: "EXCLUSIF Diamant arc-en-ciel",
    description: "Diamant arc-en-ciel exclusif avec animation ondulante.",
    item_type: "avatar",
    item_data: { src: "/shop-assets/rainbow-diamond.svg", className: "avatar-rainbow" },
    price: 100000
  },

  // ===== COULEURS =====
  {
    name: "Rouge",
    description: "Couleur rouge pour ton pseudo et tes messages.",
    item_type: "text_color",
    item_data: { color: "#ef4444" },
    price: 10000
  },
  {
    name: "Orange",
    description: "Couleur orange.",
    item_type: "text_color",
    item_data: { color: "#f97316" },
    price: 10000
  },
  {
    name: "Ambre",
    description: "Couleur ambre.",
    item_type: "text_color",
    item_data: { color: "#f59e0b" },
    price: 10000
  },
  {
    name: "Jaune",
    description: "Couleur jaune.",
    item_type: "text_color",
    item_data: { color: "#facc15" },
    price: 10000
  },
  {
    name: "Vert",
    description: "Couleur verte.",
    item_type: "text_color",
    item_data: { color: "#22c55e" },
    price: 10000
  },
  {
    name: "Émeraude",
    description: "Couleur émeraude.",
    item_type: "text_color",
    item_data: { color: "#10b981" },
    price: 10000
  },
  {
    name: "Cyan",
    description: "Couleur cyan.",
    item_type: "text_color",
    item_data: { color: "#06b6d4" },
    price: 10000
  },
  {
    name: "Bleu ciel",
    description: "Couleur bleu ciel.",
    item_type: "text_color",
    item_data: { color: "#38bdf8" },
    price: 10000
  },
  {
    name: "Bleu",
    description: "Couleur bleue.",
    item_type: "text_color",
    item_data: { color: "#3b82f6" },
    price: 10000
  },
  {
    name: "Indigo",
    description: "Couleur indigo.",
    item_type: "text_color",
    item_data: { color: "#6366f1" },
    price: 10000
  },
  {
    name: "Violet",
    description: "Couleur violette.",
    item_type: "text_color",
    item_data: { color: "#8b5cf6" },
    price: 10000
  },
  {
    name: "Fuchsia",
    description: "Couleur fuchsia.",
    item_type: "text_color",
    item_data: { color: "#d946ef" },
    price: 10000
  },
  {
    name: "Rose",
    description: "Couleur rose.",
    item_type: "text_color",
    item_data: { color: "#ec4899" },
    price: 10000
  },
  {
    name: "Rose clair",
    description: "Couleur rose clair.",
    item_type: "text_color",
    item_data: { color: "#f9a8d4" },
    price: 10000
  },
  {
    name: "Blanc",
    description: "Couleur blanche.",
    item_type: "text_color",
    item_data: { color: "#ffffff" },
    price: 10000
  },
  {
    name: "Gris argent",
    description: "Couleur gris argent.",
    item_type: "text_color",
    item_data: { color: "#cbd5e1" },
    price: 10000
  },
  {
    name: "Turquoise",
    description: "Couleur turquoise.",
    item_type: "text_color",
    item_data: { color: "#2dd4bf" },
    price: 10000
  },
  {
    name: "Lime",
    description: "Couleur lime.",
    item_type: "text_color",
    item_data: { color: "#84cc16" },
    price: 10000
  },
  {
    name: "Or",
    description: "Couleur or.",
    item_type: "text_color",
    item_data: { color: "#facc15" },
    price: 10000
  },
  {
    name: "Bleu nuit",
    description: "Couleur bleu nuit.",
    item_type: "text_color",
    item_data: { color: "#60a5fa" },
    price: 10000
  },

  // ===== EFFET =====
  {
    name: "Arc-en-ciel ondulant",
    description: "Texte animé avec un effet arc-en-ciel ondulant.",
    item_type: "text_effect",
    item_data: { effect: "rainbow-wave" },
    price: 50000
  }
];

function seedShopItems() {
  const insert = db.prepare(`
    INSERT INTO shop_items
    (name, description, item_type, item_data, price)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const item of DEFAULT_SHOP_ITEMS) {
      const existing = db.prepare(
        "SELECT id FROM shop_items WHERE name = ? LIMIT 1"
      ).get(item.name);

      if (!existing) {
        insert.run(
          item.name,
          item.description,
          item.item_type,
          JSON.stringify(item.item_data),
          item.price
        );
      }
    }
  });

  transaction();
}

seedShopItems();

app.get("/api/my-gems", auth, (req, res) => {
  const user = db.prepare(`
    SELECT gems
    FROM users
    WHERE id = ?
  `).get(req.user.id);

  if (!user) {
    return res.status(404).json({
      error: "Utilisateur introuvable."
    });
  }

  res.json({
    gems: Number(user.gems || 0)
  });
});

app.get("/api/shop/items", (req, res) => {
  const items = db.prepare(`
    SELECT
      code,
      name,
      description,
      item_type,
      item_data,
      price,
      discount_percent
    FROM shop_items
    WHERE enabled = 1
      AND code IS NOT NULL
      AND code != ''
    ORDER BY price ASC, id ASC
  `).all();

  res.json(items.map(item => ({
    id: item.code,
    name: item.name,
    description: item.description,
    item_type: item.item_type,
    item_data: JSON.parse(item.item_data || "{}"),
    price: Number(item.price),
    discount: Math.min(100, Math.max(0, Number(item.discount_percent) || 0)),
    finalPrice: Math.floor(
      Number(item.price) *
      (100 - Math.min(100, Math.max(0, Number(item.discount_percent) || 0))) / 100
    )
  })));
});

app.get("/api/shop/inventory", auth, (req,res) => {
  const items = db.prepare(`
    SELECT si.id, si.name, si.description, si.item_type, si.item_data,
           si.price, ui.equipped
    FROM user_items ui
    JOIN shop_items si ON si.id = ui.item_id
    WHERE ui.user_id = ?
    ORDER BY ui.id DESC
  `).all(req.user.id);

  res.json({
    items: items.map(item => ({
      ...item,
      item_data: JSON.parse(item.item_data || "{}")
    }))
  });
});

app.post("/api/shop/buy", auth, (req, res) => {
  const code = String(req.body?.itemId || "").trim();
  const extraData = req.body?.data && typeof req.body.data === "object"
    ? req.body.data
    : {};

  const item = db.prepare(`
    SELECT *
    FROM shop_items
    WHERE code = ? AND enabled = 1
  `).get(code);

  if (!item) {
    return res.status(404).json({
      error: "Objet introuvable."
    });
  }

  const alreadyOwned = db.prepare(`
    SELECT id
    FROM user_items
    WHERE user_id = ? AND item_id = ?
  `).get(req.user.id, item.id);

  if (alreadyOwned) {
    return res.status(400).json({
      error: "Tu possèdes déjà cet objet."
    });
  }

  let itemData = {};

  try {
    itemData = JSON.parse(item.item_data || "{}");
  } catch {}

  if (code === "title_custom") {
    const title = String(extraData.title || "").trim();
    const color = String(extraData.color || "").trim();

    if (!title || title.length > 30) {
      return res.status(400).json({
        error: "Titre invalide."
      });
    }

    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({
        error: "Couleur invalide."
      });
    }

    itemData = {
      text: title,
      color,
      className: "title-custom"
    };
  }

  if (code === "image_monster") {
    const monster = String(extraData.monster || "");

    if (!["magma", "ice"].includes(monster)) {
      return res.status(400).json({
        error: "Monstre invalide."
      });
    }

    itemData = {
      monster,
      className: "image-monster"
    };
  }

  if (code === "image_custom") {
    const photo = String(extraData.photo || "");
    const background = String(extraData.background || "");

    if (!/^photo-[0-9]+$/.test(photo)) {
      return res.status(400).json({
        error: "Photo invalide."
      });
    }

    if (!["gold","blue","red","purple","green","space"].includes(background)) {
      return res.status(400).json({
        error: "Fond invalide."
      });
    }

    itemData = {
      photo,
      background,
      className: "image-custom"
    };
  }

  const discountPercent = Math.min(
    100,
    Math.max(0, Number(item.discount_percent) || 0)
  );

  const finalPrice = Math.floor(
    Number(item.price) * (100 - discountPercent) / 100
  );

  const transaction = db.transaction(() => {
    const user = db.prepare(`
      SELECT gems
      FROM users
      WHERE id = ?
    `).get(req.user.id);

    if (!user) {
      throw new Error("Utilisateur introuvable.");
    }

    if ((user.gems || 0) < finalPrice) {
      throw new Error("Tu n'as pas assez de gemmes.");
    }

    db.prepare(`
      UPDATE users
      SET gems = gems - ?
      WHERE id = ?
    `).run(finalPrice, req.user.id);

    db.prepare(`
      INSERT INTO user_items
      (user_id, item_id)
      VALUES (?, ?)
    `).run(req.user.id, item.id);

    const updated = db.prepare(`
      SELECT gems
      FROM users
      WHERE id = ?
    `).get(req.user.id);

    return updated;
  });

  try {
    const updated = transaction();

    db.prepare(`
      UPDATE shop_items
      SET item_data = ?
      WHERE id = ?
    `).run(JSON.stringify(itemData), item.id);

    res.json({
      success: true,
      message: `${item.name} acheté avec succès !`,
      gems: updated.gems
    });
  } catch (error) {
    res.status(400).json({
      error: error.message || "Achat impossible."
    });
  }
});

app.post("/api/shop/equip", auth, (req,res) => {
  const code = String(req.body.itemId || "").trim();
  const equipped = Number(req.body.equipped ?? 1);

  const shopItem = db.prepare(`
    SELECT id
    FROM shop_items
    WHERE (code = ? OR id = ?) AND enabled = 1
  `).get(code, Number(code) || -1);

  if (!shopItem) {
    return res.status(404).json({
      error: "Objet introuvable."
    });
  }

  const itemId = shopItem.id;

  const owned = db.prepare(`
    SELECT ui.id, si.item_type
    FROM user_items ui
    JOIN shop_items si ON si.id = ui.item_id
    WHERE ui.user_id = ? AND ui.item_id = ?
  `).get(req.user.id, itemId);

  if (!owned) {
    return res.status(404).json({error:"Objet non possédé."});
  }

  if (equipped === 0) {
    db.prepare(`
      UPDATE user_items
      SET equipped = 0
      WHERE user_id = ? AND item_id = ?
    `).run(req.user.id, itemId);

    return res.json({success:true, equipped:false});
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE user_items
      SET equipped = 0
      WHERE user_id = ?
        AND item_id IN (
          SELECT id FROM shop_items WHERE item_type = ?
        )
    `).run(req.user.id, owned.item_type);

    db.prepare(`
      UPDATE user_items
      SET equipped = 1
      WHERE user_id = ? AND item_id = ?
    `).run(req.user.id, itemId);
  });

  transaction();

  res.json({success:true, equipped:true});
});

app.post("/api/shop/unequip", auth, (req, res) => {
  const itemId = Number(req.body.itemId);

  db.prepare(`
    UPDATE user_items
    SET equipped = 0
    WHERE user_id = ? AND item_id = ?
  `).run(req.user.id, itemId);

  res.json({ success: true });
});

app.get("/api/profile/:username", (req, res) => {
  const user = db.prepare(`
    SELECT id, username, gems
    FROM users
    WHERE username = ?
  `).get(req.params.username);

  if (!user) {
    return res.status(404).json({ error: "Utilisateur introuvable." });
  }

  const items = db.prepare(`
    SELECT si.item_type, si.item_data
    FROM user_items ui
    JOIN shop_items si ON si.id = ui.item_id
    WHERE ui.user_id = ? AND ui.equipped = 1
  `).all(user.id);

  const customization = {};

  for (const item of items) {
    const data = JSON.parse(item.item_data || "{}");
    customization[item.item_type] = data;
  }

  res.json({
    user: {
      ...user,
      customization
    }
  });
});



db.exec(`
  CREATE TABLE IF NOT EXISTS quiz_themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    enabled INTEGER DEFAULT 1
  )
`);

const QUIZ_THEMES = [
  "Culture générale",
  "Histoire",
  "Géographie",
  "Sciences",
  "Jeux vidéo",
  "Films et séries",
  "Musique",
  "Football",
  "Sports",
  "Animaux",
  "Nature",
  "Cuisine",
  "Jeux et logique",
  "Internet",
  "France",
  "Monde",
  "Espace",
  "Inventions",
  "Culture populaire",
  "Technologie"
];

const insertQuizTheme = db.prepare(`
  INSERT OR IGNORE INTO quiz_themes (name, enabled)
  VALUES (?, 1)
`);

for (const theme of QUIZ_THEMES) {
  insertQuizTheme.run(theme);
}


const QUIZ_QUESTIONS = [
  ["Quelle est la capitale de la France ?", ["Paris", "Lyon", "Marseille", "Nice"], 0],
  ["Combien y a-t-il de continents sur Terre ?", ["5", "6", "7", "8"], 2],
  ["Qui a peint La Joconde ?", ["Van Gogh", "Léonard de Vinci", "Picasso", "Monet"], 1],
  ["Quelle planète est surnommée la planète rouge ?", ["Mars", "Vénus", "Jupiter", "Mercure"], 0],
  ["Dans quel sport utilise-t-on un ballon ovale ?", ["Tennis", "Rugby", "Natation", "Golf"], 1],
  ["Quel est le plus grand océan du monde ?", ["Atlantique", "Indien", "Pacifique", "Arctique"], 2],
  ["Combien font 9 × 8 ?", ["64", "72", "81", "96"], 1],
  ["Quel animal est connu comme le roi de la jungle ?", ["Tigre", "Lion", "Éléphant", "Loup"], 1],
  ["Quel instrument possède généralement 88 touches ?", ["Guitare", "Piano", "Violon", "Flûte"], 1],
  ["Quel pays est célèbre pour les pyramides de Gizeh ?", ["Grèce", "Égypte", "Italie", "Mexique"], 1],
  ["Quelle est la langue officielle du Brésil ?", ["Espagnol", "Portugais", "Français", "Anglais"], 1],
  ["Combien de côtés possède un hexagone ?", ["5", "6", "7", "8"], 1],
  ["Quel est le symbole chimique de l’eau ?", ["CO2", "O2", "H2O", "NaCl"], 2],
  ["Dans quel film trouve-t-on le personnage de Simba ?", ["Toy Story", "Le Roi Lion", "Shrek", "Avatar"], 1],
  ["Quelle est la monnaie du Japon ?", ["Yuan", "Won", "Yen", "Dollar"], 2],
  ["Qui a écrit Les Misérables ?", ["Victor Hugo", "Molière", "Jules Verne", "Émile Zola"], 0],
  ["Quel est le plus grand mammifère ?", ["Éléphant", "Baleine bleue", "Girafe", "Rhinocéros"], 1],
  ["Quelle couleur obtient-on en mélangeant du bleu et du jaune ?", ["Rouge", "Vert", "Orange", "Violet"], 1],
  ["Combien de joueurs composent une équipe de football sur le terrain ?", ["9", "10", "11", "12"], 2],
  ["Quel gaz respirons-nous principalement grâce à nos poumons ?", ["Oxygène", "Hélium", "Hydrogène", "Méthane"], 0]
];

db.exec(`
  CREATE TABLE IF NOT EXISTS quiz_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, question_id)
  )
`);


app.get("/api/admin/quiz/settings", auth, chilladminOnly, (req, res) => {
  const settings = db.prepare(`
    SELECT enabled
    FROM quiz_settings
    WHERE id = 1
  `).get();

  const difficulties = db.prepare(`
    SELECT id, code, name, reward, enabled
    FROM quiz_difficulties
    ORDER BY id
  `).all();

  const questions = QUIZ_QUESTIONS.map((q, index) => {
    const setting = db.prepare(`
      SELECT difficulty, enabled
      FROM quiz_question_settings
      WHERE question_id = ?
    `).get(index);

    return {
      id: index,
      question: q[0],
      difficulty: setting?.difficulty || "easy",
      enabled: setting ? Boolean(setting.enabled) : true
    };
  });

  res.json({
    success: true,
    enabled: Boolean(settings?.enabled),
    difficulties,
    questions
  });
});

app.patch("/api/admin/quiz/settings", auth, chilladminOnly, (req, res) => {
  const enabled = Number(Boolean(req.body?.enabled));

  db.prepare(`
    UPDATE quiz_settings
    SET enabled = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(enabled);

  res.json({
    success: true,
    enabled: Boolean(enabled)
  });
});

app.patch("/api/admin/quiz/difficulties/:code", auth, chilladminOnly, (req, res) => {
  const code = String(req.params.code || "").trim();
  const reward = Math.max(0, Math.floor(Number(req.body?.reward ?? 0)));
  const enabled = Number(Boolean(req.body?.enabled));

  const result = db.prepare(`
    UPDATE quiz_difficulties
    SET reward = ?, enabled = ?
    WHERE code = ?
  `).run(reward, enabled, code);

  if (!result.changes) {
    return res.status(404).json({
      success: false,
      error: "Difficulté introuvable."
    });
  }

  res.json({ success: true });
});

app.patch("/api/admin/quiz/questions/:id", auth, chilladminOnly, (req, res) => {
  const id = Number(req.params.id);
  const difficulty = String(req.body?.difficulty || "easy");
  const enabled = Number(Boolean(req.body?.enabled));

  if (!QUIZ_QUESTIONS[id]) {
    return res.status(404).json({
      success: false,
      error: "Question introuvable."
    });
  }

  db.prepare(`
    INSERT INTO quiz_question_settings
      (question_id, difficulty, enabled)
    VALUES (?, ?, ?)
    ON CONFLICT(question_id)
    DO UPDATE SET
      difficulty = excluded.difficulty,
      enabled = excluded.enabled
  `).run(id, difficulty, enabled);

  res.json({ success: true });
});

app.get("/api/game/quiz", auth, (req, res) => {
  res.json(QUIZ_QUESTIONS.map((q, index) => ({
    id: index,
    question: q[0],
    answers: q[1]
  })));
});





app.get("/api/admin/bot/settings", auth, chilladminOnly, (req, res) => {
  const settings = db.prepare(`
    SELECT mood, style
    FROM bot_settings
    WHERE id = 1
  `).get();

  res.json({
    success: true,
    settings
  });
});

app.patch("/api/admin/bot/settings", auth, chilladminOnly, (req, res) => {
  const mood = String(req.body?.mood || "").trim().slice(0, 200);
  const style = String(req.body?.style || "").trim().slice(0, 300);

  if (!mood || !style) {
    return res.status(400).json({
      success: false,
      error: "L'humeur et le style sont obligatoires."
    });
  }

  db.prepare(`
    UPDATE bot_settings
    SET mood = ?, style = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(mood, style);

  res.json({
    success: true,
    settings: { mood, style }
  });
});

app.post("/api/admin/bot/broadcast", auth, chilladminOnly, (req, res) => {
  const message = String(req.body?.message || "").trim().slice(0, 1000);

  if (!message) {
    return res.status(400).json({
      success: false,
      error: "Message vide."
    });
  }

  const conversations = db.prepare(`
    SELECT id
    FROM bot_conversations
  `).all();

  const insert = db.prepare(`
    INSERT INTO bot_messages
      (conversation_id, sender, message)
    VALUES
      (?, 'admin', ?)
  `);

  const transaction = db.transaction(() => {
    for (const conversation of conversations) {
      insert.run(conversation.id, message);
    }
  });

  transaction();

  if (typeof io !== "undefined") {
    io.emit("discutebot:admin-message", {
      message,
      created_at: new Date().toISOString()
    });
  }

  res.json({
    success: true,
    conversations: conversations.length
  });
});

app.get("/api/discutebot/history", auth, (req, res) => {
  const conversation = db.prepare(`
    SELECT id
    FROM bot_conversations
    WHERE user_id = ?
  `).get(req.user.id);

  if (!conversation) {
    return res.json({
      success: true,
      messages: []
    });
  }

  const messages = db.prepare(`
    SELECT id, sender, message, created_at
    FROM bot_messages
    WHERE conversation_id = ?
    ORDER BY id ASC
    LIMIT 100
  `).all(conversation.id);

  res.json({
    success: true,
    messages
  });
});

app.post("/api/discutebot", auth, async (req, res) => {
  const message = String(req.body?.message || "").trim();

  if (!message) {
    return res.status(400).json({
      error: "Message vide."
    });
  }

  if (message.length > 500) {
    return res.status(400).json({
      error: "Message trop long."
    });
  }

  try {
    // Une conversation privée par utilisateur
    let conversation = db.prepare(`
      SELECT id
      FROM bot_conversations
      WHERE user_id = ?
    `).get(req.user.id);

    if (!conversation) {
      const result = db.prepare(`
        INSERT INTO bot_conversations (user_id)
        VALUES (?)
      `).run(req.user.id);

      conversation = {
        id: result.lastInsertRowid
      };
    }

    // Enregistre le message de l'utilisateur
    db.prepare(`
      INSERT INTO bot_messages
        (conversation_id, sender, message)
      VALUES
        (?, 'user', ?)
    `).run(conversation.id, message);

    // Récupère uniquement l'historique de CET utilisateur
    const history = db.prepare(`
      SELECT sender, message
      FROM bot_messages
      WHERE conversation_id = ?
      ORDER BY id DESC
      LIMIT 50
    `).all(conversation.id).reverse();

    const input = history.map((item) => ({
      role: item.sender === "user" ? "user" : "assistant",
      content: item.message
    }));

    const response = await openai.responses.create({
      model: "gpt-5.6-luna",
      instructions: `
Tu es Discutebot 🤖, l'assistant officiel de DiscuteApp.

Règles :
- Réponds en français sauf si l'utilisateur utilise une autre langue.
- Sois sympathique, naturel et utile.
- Réponds directement à la question.
- Tu peux aider avec DiscuteApp, le code, les jeux, la boutique et des questions générales.
- Ne prétends pas avoir accès à des informations privées auxquelles tu n'as pas accès.
- Ne révèle jamais les conversations d'autres utilisateurs.
- Garde tes réponses assez courtes et faciles à lire.
      `.trim(),
      input
    });

    const reply = response.output_text?.trim();





    if (!reply) {
      throw new Error("Réponse OpenAI vide.");
    }

    // Enregistre la réponse du bot
    db.prepare(`
      INSERT INTO bot_messages
        (conversation_id, sender, message)
      VALUES
        (?, 'bot', ?)
    `).run(conversation.id, reply);

    res.json({
      success: true,
      reply
    });

  } catch (error) {
    console.error("❌ Erreur Discutebot :", error);

    res.status(500).json({
      error: "Impossible de contacter Discutebot pour le moment."
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    app: "DiscuteApp"
  });
});

function getChatCustomization(userId) {
  const items = db.prepare(`
    SELECT si.item_type, si.item_data
    FROM user_items ui
    JOIN shop_items si ON si.id = ui.item_id
    WHERE ui.user_id = ? AND ui.equipped = 1
  `).all(userId);

  const customization = {};

  for (const item of items) {
    const data = JSON.parse(item.item_data || "{}");

    if (item.item_type === "image" || item.item_type === "avatar") {
      if (data.monster) {
        customization.avatar = {
          emoji: data.monster === "magma" ? "🌋" : "❄️",
          className: data.className || ""
        };
      } else if (data.photo) {
        const photos = [
          "🐉","🐺","🦊","🐯","🦁","🐼","🦅","🦈","🐙","🦋",
          "🤖","👾","🦾","⚔️","🧙","🧝","🧛","🧟","👻","💀",
          "🐲","🌋","❄️","⚡","🌑","🌞","🌙","🌌","🪐","🚀",
          "🎮","🏎️","🥷","🛡️","🏹","🪄","👑","🦸","🦹","🤠",
          "🐸","🐰","🐻","🦄","🦖","🦂","🕷️","🦇","🌸","🔥"
        ];
        const index = Number(String(data.photo).replace("photo-", "")) - 1;
        customization.avatar = {
          emoji: photos[index] || "🖼️",
          className: data.className || ""
        };
      } else if (data.className === "image-collection") {
        customization.avatar = {
          emoji: "🎴",
          className: data.className
        };
      } else {
        customization.avatar = data;
      }
    } else if (item.item_type === "text_color") {
      customization.text_color = data;
    } else if (item.item_type === "title") {
      customization.title = data;
    } else if (item.item_type === "text_effect") {
      customization.text_effect = data;
    } else {
      customization[item.item_type] = data;
    }
  }

  return customization;
}

io.on("connection", (socket) => {
  console.log("Utilisateur connecté à Socket.IO :", socket.id);

  socket.on("chat:load", () => {
    const messages = db.prepare(`
      SELECT id, user_id, username, content, created_at
      FROM public_messages
      ORDER BY id DESC
      LIMIT 100
    `).all().reverse();

    const messagesWithCustomization = messages.map(message => ({
      ...message,
      customization: getChatCustomization(message.user_id)
    }));

    socket.emit("chat:history", messagesWithCustomization);
  });

  socket.on("chat:message", (data) => {
    try {
      const token = socket.handshake.headers.cookie
        ?.split(";")
        .map(value => value.trim())
        .find(value => value.startsWith("discuteapp_session="))
        ?.split("=")
        .slice(1)
        .join("=");

      if (!token) {
        socket.emit("chat:error", "Tu dois être connecté.");
        return;
      }

      const decoded = jwt.verify(token, JWT_SECRET);

      const user = db
        .prepare(`
          SELECT id, username, banned
          FROM users
          WHERE id = ?
        `)
        .get(decoded.id);

      if (!user || user.banned) {
        socket.emit("chat:error", "Session invalide.");
        return;
      }

      const content = String(data?.content || "").trim();

      if (!content) return;

      if (content.length > 500) {
        socket.emit("chat:error", "Message trop long.");
        return;
      }

      const result = db.prepare(`
        INSERT INTO public_messages (user_id, username, content)
        VALUES (?, ?, ?)
      `).run(user.id, user.username, content);

      const message = db.prepare(`
        SELECT id, user_id, username, content, created_at
        FROM public_messages
        WHERE id = ?
      `).get(result.lastInsertRowid);

      message.customization = getChatCustomization(user.id);

      io.emit("chat:message", message);

    } catch {
      socket.emit("chat:error", "Tu dois être connecté.");
    }
  });

  socket.on("disconnect", () => {
    console.log("Utilisateur déconnecté :", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`DiscuteApp démarré : http://localhost:${PORT}`);
});


app.get("/api/admin/quiz/themes", auth, chilladminOnly, (req, res) => {
  const themes = db.prepare(`
    SELECT id, name, enabled
    FROM quiz_themes
    ORDER BY id ASC
  `).all();

  res.json({ themes });
});

app.patch("/api/admin/quiz/themes/:id", auth, chilladminOnly, (req, res) => {
  const id = Number(req.params.id);
  const enabled = req.body.enabled ? 1 : 0;

  db.prepare(`
    UPDATE quiz_themes
    SET enabled = ?
    WHERE id = ?
  `).run(enabled, id);

  res.json({ success: true });
});
