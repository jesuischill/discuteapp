const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_MOI_PAR_UN_VRAI_SECRET";

const db = new Database("discuteapp.db");

// Utilisateurs actuellement connectés
const onlineUsers = new Map();

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS private_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS private_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public_messages_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_message_id INTEGER,
  user_id INTEGER,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  original_created_at TEXT,
  deleted_by INTEGER,
  deleted_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

app.use(express.json());

const cookieParser = require("cookie-parser");
app.use(cookieParser());

app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

function createToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function getUserFromToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function getDbUser(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function auth(req, res, next) {
  const token = req.cookies?.discuteapp_session;

  if (!token) {
    return res.status(401).json({ error: "Non connecté." });
  }

  const decoded = getUserFromToken(token);
  const user = decoded ? getDbUser(decoded.id) : null;

  if (!user) {
    return res.status(401).json({ error: "Session invalide." });
  }

  if (user.banned) {
    return res.status(403).json({ error: "Ton compte est banni." });
  }

  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (!["owner", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Accès admin refusé." });
  }
  next();
}

function addSystemMessage(content) {
  const username = "🛡️ SYSTÈME";

  // L'ancienne base de données exige un user_id.
  // On utilise le propriétaire comme auteur technique du message système.
  const owner = db.prepare(
    "SELECT id FROM users WHERE role = 'owner' LIMIT 1"
  ).get();

  const userId = owner ? owner.id : 1;

  const result = db.prepare(`
    INSERT INTO public_messages (user_id, username, content)
    VALUES (?, ?, ?)
  `).run(userId, username, content);

  const message = {
    id: result.lastInsertRowid,
    user_id: userId,
    username,
    content,
    system: true
  };

  io.emit("public_message", message);
}

function disconnectUser(userId) {
  const sockets = io.sockets.adapter.rooms.get(`user-${userId}`);

  if (sockets) {
    for (const socketId of [...sockets]) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit("force_logout", {
          message: "Ton compte a été banni par l'administration."
        });
        socket.disconnect(true);
      }
    }
  }
}

/* INSCRIPTION */
app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim().slice(0, 30);
  const password = String(req.body.password || "");

  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({
      error: "Pseudo : 3 caractères minimum. Mot de passe : 6 minimum."
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const result = db.prepare(`
      INSERT INTO users (username, password)
      VALUES (?, ?)
    `).run(username, passwordHash);

    const user = getDbUser(result.lastInsertRowid);

    res.cookie("discuteapp_session", createToken(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/"
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch {
    res.status(400).json({ error: "Ce pseudo existe déjà." });
  }
});

/* CONNEXION */
app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const user = db.prepare(
    "SELECT * FROM users WHERE username = ?"
  ).get(username);

  if (!user) {
    return res.status(401).json({ error: "Identifiants incorrects." });
  }

  if (user.banned) {
    return res.status(403).json({ error: "Ton compte est banni." });
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    return res.status(401).json({ error: "Identifiants incorrects." });
  }

  res.cookie("discuteapp_session", createToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  });

  res.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  });
});

/* DÉCONNEXION */
app.get("/api/me", auth, (req, res) => {
  res.json({ user: req.user });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("discuteapp_session", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });

  res.json({ ok: true });
});

/* UTILISATEURS */
app.get("/api/users", auth, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, banned
    FROM users
    WHERE id != ? AND banned = 0
    ORDER BY username
  `).all(req.user.id);

  const usersWithStatus = users.map(user => ({
    ...user,
    online: onlineUsers.has(user.id)
  }));

  res.json(usersWithStatus);
});




/* BOUTIQUE : achats permanents */
db.exec(`
  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    item_data TEXT DEFAULT '{}',
    price INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, item_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    from_gems INTEGER NOT NULL DEFAULT 0,
    to_gems INTEGER NOT NULL DEFAULT 0,
    from_items TEXT NOT NULL DEFAULT '[]',
    to_items TEXT NOT NULL DEFAULT '[]',
    from_confirmed INTEGER NOT NULL DEFAULT 0,
    to_confirmed INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/* ANNUAIRE : publications */
db.exec(`
  CREATE TABLE IF NOT EXISTS directory_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/* SOLDES GLOBALES DE LA BOUTIQUE */
db.exec(`
  CREATE TABLE IF NOT EXISTS shop_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

db.prepare(`
  INSERT OR IGNORE INTO shop_settings (key, value)
  VALUES ('discount_percent', '0')
`).run();

function getShopDiscount() {
  const row = db.prepare(`
    SELECT value FROM shop_settings
    WHERE key = 'discount_percent'
  `).get();

  const discount = Number(row?.value || 0);
  return Math.max(0, Math.min(100, discount));
}

function getDiscountedPrice(price) {
  const discount = getShopDiscount();
  return Math.max(0, Math.round(price * (100 - discount) / 100));
}

/* SOLDES PAR ARTICLE */
db.exec(`
  CREATE TABLE IF NOT EXISTS shop_item_discounts (
    item_id TEXT PRIMARY KEY,
    discount_percent INTEGER NOT NULL DEFAULT 0
  )
`);

function getItemDiscount(itemId) {
  const row = db.prepare(`
    SELECT discount_percent
    FROM shop_item_discounts
    WHERE item_id = ?
  `).get(itemId);

  return Math.max(0, Math.min(100, Number(row?.discount_percent || 0)));
}

function getDiscountedItemPrice(itemId, price) {
  const discount = getItemDiscount(itemId);
  return Math.max(0, Math.round(price * (100 - discount) / 100));
}




const SHOP_ITEMS = {
  title_bg:       { price: 5000,     type: "title", name: "BG" },
  title_chill:    { price: 1000,     type: "title", name: "Chill" },
  title_admin:    { price: 50000,    type: "title", name: "👑 Admin" },
  title_custom:   { price: 30000,    type: "title", name: "Titre personnalisé" },

  image_ninja:    { price: 1000,     type: "image", name: "Ninja anime" },
  image_gojo:     { price: 5000,     type: "image", name: "Magicien aux yeux bleus" },
  image_monster:  { price: 10000,    type: "image", name: "Monstre" },
  image_custom:   { price: 30000,    type: "image", name: "Image personnalisée" },
  image_collection:{price: 50000,    type: "image", name: "Collection 50 images" },
  image_royal:    { price: 100000,   type: "image", name: "Image Royale" },

  color_red:      { price: 10000,    type: "color", name: "Rouge" },
  color_blue:     { price: 10000,    type: "color", name: "Bleu" },
  color_green:    { price: 10000,    type: "color", name: "Vert" },
  color_purple:   { price: 10000,    type: "color", name: "Violet" },
  color_pink:     { price: 10000,    type: "color", name: "Rose" },
  color_orange:   { price: 10000,    type: "color", name: "Orange" },
  color_cyan:     { price: 10000,    type: "color", name: "Cyan" },
  color_brown:    { price: 10000,    type: "color", name: "Marron" },
  color_black:    { price: 10000,    type: "color", name: "Noir" },
  color_gray:     { price: 10000,    type: "color", name: "Gris" },
  color_gold:     { price: 50000,    type: "color", name: "Doré brillant" },

  admin_panel:    { price: 10000000, type: "admin_panel", name: "Panneau Admin" },
  emoji_pack:     { price: 1000000, type: "emoji_pack", name: "😀 Pack Emoji — 80+ emojis" }
};


/* TITRE EXCLUSIF CHRISTMAS */
if (!SHOP_ITEMS.title_christmas) {
  SHOP_ITEMS.title_christmas = {
    type: "title",
    name: "🎅 Christmas ⭐ Certifié exclusif",
    price: 50000
  };
}


/* IMAGE EXCLUSIVE HALLOWEEN */
if (!SHOP_ITEMS.image_halloween) {
  SHOP_ITEMS.image_halloween = {
    type: "image",
    name: "🎃 Halloween ⭐ Certifié exclusif",
    price: 50000
  };
}


/* COULEUR EXCLUSIVE OR BRILLANT ONDULANT */
if (!SHOP_ITEMS.color_gold_wave) {
  SHOP_ITEMS.color_gold_wave = {
    type: "color",
    name: "✨ Or brillant ondulant ⭐ Certifié exclusif",
    price: 70000
  };
}

app.post("/api/shop/buy", auth, (req, res) => {
  const { itemId, data = {} } = req.body || {};
  const item = SHOP_ITEMS[itemId];

  if (!item) {
    return res.status(400).json({ error: "Objet invalide." });
  }

  const alreadyOwned = db.prepare(`
    SELECT id FROM purchases
    WHERE user_id = ? AND item_id = ?
  `).get(req.user.id, itemId);

  if (alreadyOwned) {
    return res.status(400).json({ error: "Tu possèdes déjà cet objet." });
  }

  const buy = db.transaction(() => {
    const user = db.prepare(`
      SELECT id, username, gems FROM users WHERE id = ?
    `).get(req.user.id);

    if (!user) throw new Error("Utilisateur introuvable.");

    const finalPrice = getDiscountedPrice(item.price);

    if ((user.gems || 0) < finalPrice) {
      throw new Error("Tu n'as pas assez de gemmes.");
    }

    db.prepare(`
      UPDATE users
      SET gems = gems - ?
      WHERE id = ?
    `).run(finalPrice, user.id);

    db.prepare(`
      INSERT INTO purchases
      (user_id, item_id, item_type, item_name, item_data, price)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      itemId,
      item.type,
      item.name,
      JSON.stringify(data),
      finalPrice
    );

    return db.prepare(`
      SELECT gems FROM users WHERE id = ?
    `).get(user.id);
  });

  try {
    const result = buy();

    res.json({
      message: `${item.name} acheté avec succès !`,
      gems: result.gems
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Achat impossible." });
  }
});



/* SOLDES DE LA BOUTIQUE */
app.get("/api/shop/discount", auth, (req, res) => {
  res.json({
    discount: getShopDiscount()
  });
});

/* PANNEAU SOLDES : RÉSERVÉ UNIQUEMENT AU PROPRIÉTAIRE */
app.post("/api/admin/shop/discount", auth, (req, res) => {
  if (req.user.username !== "chilladmin") {
    return res.status(403).json({
      error: "Ce panneau est réservé au propriétaire."
    });
  }

  const discount = Number(req.body?.discount);

  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    return res.status(400).json({
      error: "Le pourcentage doit être entre 0 et 100."
    });
  }

  db.prepare(`
    UPDATE shop_settings
    SET value = ?
    WHERE key = 'discount_percent'
  `).run(String(Math.round(discount)));

  res.json({
    message: Math.round(discount) === 0
      ? "Soldes retirées."
      : `Soldes de ${Math.round(discount)} % activées !`,
    discount: Math.round(discount)
  });
});

/* LISTE DES ARTICLES ET SOLDES */
app.get("/api/shop/items", auth, (req, res) => {
  const items = Object.entries(SHOP_ITEMS).map(([id, item]) => {
    const discount = getItemDiscount(id);

    return {
      id,
      name: item.name,
      price: item.price,
      discount,
      finalPrice: getDiscountedItemPrice(id, item.price)
    };
  });

  res.json(items);
});

/* SOLDES PAR ARTICLE — PROPRIÉTAIRE UNIQUEMENT */
app.post("/api/admin/shop/item-discount", auth, (req, res) => {
  if (req.user.username !== "chilladmin") {
    return res.status(403).json({
      error: "Réservé au propriétaire."
    });
  }

  const itemId = String(req.body?.itemId || "");
  const discount = Math.round(Number(req.body?.discount));

  if (!SHOP_ITEMS[itemId]) {
    return res.status(400).json({
      error: "Article invalide."
    });
  }

  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    return res.status(400).json({
      error: "La solde doit être entre 0 et 100 %."
    });
  }

  db.prepare(`
    INSERT INTO shop_item_discounts (item_id, discount_percent)
    VALUES (?, ?)
    ON CONFLICT(item_id)
    DO UPDATE SET discount_percent = excluded.discount_percent
  `).run(itemId, discount);

  res.json({
    message: discount === 0
      ? `Solde retirée pour ${SHOP_ITEMS[itemId].name}.`
      : `Solde de ${discount} % appliquée à ${SHOP_ITEMS[itemId].name}.`,
    itemId,
    discount
  });
});


/* PACK EMOJI : VÉRIFIER LA POSSESSION */
app.get("/api/shop/emoji-pack-status", auth, (req, res) => {
  const purchase = db.prepare(`
    SELECT id
    FROM purchases
    WHERE user_id = ?
      AND item_id = 'emoji_pack'
  `).get(req.user.id);

  res.json({
    owned: !!purchase
  });
});

/* CLASSEMENT : utilisateurs avec le plus de gemmes */
app.get("/api/rankings/gems", auth, (req, res) => {
  const users = db.prepare(`
    SELECT username, COALESCE(gems, 0) AS gems
    FROM users
    WHERE banned = 0
    ORDER BY gems DESC, username ASC
    LIMIT 50
  `).all();

  res.json(users);
});

/* CLASSEMENT : utilisateurs avec le plus d'accessoires achetés */
app.get("/api/rankings/accessories", auth, (req, res) => {
  const users = db.prepare(`
    SELECT
      u.username,
      COUNT(p.id) AS accessories
    FROM users u
    LEFT JOIN purchases p ON p.user_id = u.id
    WHERE u.banned = 0
    GROUP BY u.id, u.username
    HAVING COUNT(p.id) > 0
    ORDER BY accessories DESC, u.username ASC
    LIMIT 50
  `).all();

  res.json(users);
});

/* ACCESSOIRES : voir les achats */
app.get("/api/accessories", auth, (req, res) => {
  const items = db.prepare(`
    SELECT id, item_id, item_type, item_name, item_data, price, active, created_at
    FROM purchases
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(req.user.id).map(item => ({
    ...item,
    active: Boolean(item.active),
    data: (() => {
      try {
        return JSON.parse(item.item_data || "{}");
      } catch {
        return {};
      }
    })()
  }));

  res.json(items);
});

/* ACCESSOIRES : activer ou désactiver */
app.post("/api/accessories/:id/toggle", auth, (req, res) => {
  const purchaseId = Number(req.params.id);

  const item = db.prepare(`
    SELECT id, item_id, item_type, active
    FROM purchases
    WHERE id = ? AND user_id = ?
  `).get(purchaseId, req.user.id);

  if (!item) {
    return res.status(404).json({ error: "Accessoire introuvable." });
  }

  const newActive = item.active ? 0 : 1;

  const toggle = db.transaction(() => {
    if (newActive && ["title", "image", "color"].includes(item.item_type)) {
      db.prepare(`
        UPDATE purchases
        SET active = 0
        WHERE user_id = ? AND item_type = ?
      `).run(req.user.id, item.item_type);
    }

    db.prepare(`
      UPDATE purchases
      SET active = ?
      WHERE id = ? AND user_id = ?
    `).run(newActive, purchaseId, req.user.id);
  });

  toggle();

  res.json({
    message: newActive ? "Accessoire activé !" : "Accessoire désactivé !",
    active: Boolean(newActive),
    itemId: item.item_id
  });
});

app.get("/api/my-gems", auth, (req, res) => {
  const user = db.prepare(
    "SELECT gems FROM users WHERE id = ?"
  ).get(req.user.id);

  res.json({
    gems: user ? (user.gems || 0) : 0
  });
});

/* ÉCHANGES */
function tradeForUser(trade, userId) {
  const mine = trade.from_user_id === userId ? "from" : "to";
  const other = mine === "from" ? "to" : "from";
  return { ...trade, mine, other, myGems: trade[`${mine}_gems`], myItems: JSON.parse(trade[`${mine}_items`]), myConfirmed: Boolean(trade[`${mine}_confirmed`]), otherConfirmed: Boolean(trade[`${other}_confirmed`]) };
}

app.post("/api/trades/request/:userId", auth, (req, res) => {
  const toUserId = Number(req.params.userId);
  if (!toUserId || toUserId === req.user.id || !getDbUser(toUserId)) return res.status(400).json({ error: "Utilisateur invalide." });
  const trade = db.prepare("INSERT INTO trades (from_user_id, to_user_id) VALUES (?, ?)").run(req.user.id, toUserId);
  io.to(`user-${toUserId}`).emit("trade_updated");
  res.json({ id: trade.lastInsertRowid });
});

app.get("/api/trades", auth, (req, res) => {
  const trades = db.prepare("SELECT t.*, a.username AS from_username, b.username AS to_username FROM trades t JOIN users a ON a.id=t.from_user_id JOIN users b ON b.id=t.to_user_id WHERE (t.from_user_id=? OR t.to_user_id=?) AND t.status IN ('pending','active') ORDER BY t.id DESC").all(req.user.id, req.user.id);
  res.json(trades.map(trade => tradeForUser(trade, req.user.id)));
});

app.post("/api/trades/:id/respond", auth, (req, res) => {
  const trade = db.prepare("SELECT * FROM trades WHERE id=? AND to_user_id=? AND status='pending'").get(Number(req.params.id), req.user.id);
  if (!trade) return res.status(404).json({ error: "Demande introuvable." });
  const status = req.body.action === "accept" ? "active" : "refused";
  db.prepare("UPDATE trades SET status=? WHERE id=?").run(status, trade.id);
  io.to(`user-${trade.from_user_id}`).emit("trade_updated");
  res.json({ status });
});

app.get("/api/trades/:id", auth, (req, res) => {
  const trade = db.prepare("SELECT t.*, a.username AS from_username, b.username AS to_username FROM trades t JOIN users a ON a.id=t.from_user_id JOIN users b ON b.id=t.to_user_id WHERE t.id=? AND (t.from_user_id=? OR t.to_user_id=?)").get(Number(req.params.id), req.user.id, req.user.id);
  if (!trade) return res.status(404).json({ error: "Échange introuvable." });
  res.json(tradeForUser(trade, req.user.id));
});

app.put("/api/trades/:id/offer", auth, (req, res) => {
  const trade = db.prepare("SELECT * FROM trades WHERE id=? AND (from_user_id=? OR to_user_id=?) AND status='active'").get(Number(req.params.id), req.user.id, req.user.id);
  const gems = Math.max(0, Math.floor(Number(req.body.gems) || 0));
  const items = [...new Set((Array.isArray(req.body.itemIds) ? req.body.itemIds : []).map(Number).filter(Number.isInteger))];
  if (!trade) return res.status(404).json({ error: "Échange indisponible." });
  const owned = db.prepare(`SELECT id FROM purchases WHERE user_id=? AND id IN (${items.map(() => "?").join(",") || "NULL"})`).all(req.user.id, ...items);
  if (owned.length !== items.length) return res.status(400).json({ error: "Accessoire invalide." });
  const side = trade.from_user_id === req.user.id ? "from" : "to";
  db.prepare(`UPDATE trades SET ${side}_gems=?, ${side}_items=?, from_confirmed=0, to_confirmed=0 WHERE id=?`).run(gems, JSON.stringify(items), trade.id);
  io.to(`user-${trade.from_user_id}`).emit("trade_updated"); io.to(`user-${trade.to_user_id}`).emit("trade_updated");
  res.json({ success: true });
});

app.post("/api/trades/:id/confirm", auth, (req, res) => {
  const trade = db.prepare("SELECT * FROM trades WHERE id=? AND (from_user_id=? OR to_user_id=?) AND status='active'").get(Number(req.params.id), req.user.id, req.user.id);
  if (!trade) return res.status(404).json({ error: "Échange indisponible." });
  const side = trade.from_user_id === req.user.id ? "from" : "to";
  db.prepare(`UPDATE trades SET ${side}_confirmed=1 WHERE id=?`).run(trade.id);
  const ready = db.prepare("SELECT * FROM trades WHERE id=?").get(trade.id);
  if (!(ready.from_confirmed && ready.to_confirmed)) return res.json({ completed: false });
  try {
    db.transaction(() => {
      const from = db.prepare("SELECT gems FROM users WHERE id=?").get(ready.from_user_id);
      const to = db.prepare("SELECT gems FROM users WHERE id=?").get(ready.to_user_id);
      if (from.gems < ready.from_gems || to.gems < ready.to_gems) throw new Error("Une personne n'a plus assez de gemmes.");
      for (const [ids, owner, recipient] of [[JSON.parse(ready.from_items), ready.from_user_id, ready.to_user_id], [JSON.parse(ready.to_items), ready.to_user_id, ready.from_user_id]]) {
        for (const id of ids) {
          const item = db.prepare("SELECT item_id FROM purchases WHERE id=? AND user_id=?").get(id, owner);
          if (!item || db.prepare("SELECT id FROM purchases WHERE user_id=? AND item_id=?").get(recipient, item.item_id)) throw new Error("Un accessoire ne peut plus être échangé.");
          db.prepare("UPDATE purchases SET user_id=?, active=0 WHERE id=?").run(recipient, id);
        }
      }
      db.prepare("UPDATE users SET gems=gems-?+? WHERE id=?").run(ready.from_gems, ready.to_gems, ready.from_user_id);
      db.prepare("UPDATE users SET gems=gems-?+? WHERE id=?").run(ready.to_gems, ready.from_gems, ready.to_user_id);
      db.prepare("UPDATE trades SET status='completed' WHERE id=?").run(ready.id);
    })();
  } catch (error) { return res.status(400).json({ error: error.message }); }
  io.to(`user-${ready.from_user_id}`).emit("trade_updated"); io.to(`user-${ready.to_user_id}`).emit("trade_updated");
  res.json({ completed: true });
});


/* JEUX ET GEMMES */


/* Sauvegarde l'apparence des accessoires avec chaque message */
try {
  db.prepare("ALTER TABLE public_messages ADD COLUMN accessories TEXT").run();
  console.log("Colonne accessories ajoutée à public_messages.");
} catch (error) {
  if (!String(error.message).includes("duplicate column name")) {
    throw error;
  }
}

const GAME_CONFIG = {
  1: { price: 0, reward: 10 },
  2: { price: 100, reward: 500 },
  3: { price: 5000, reward: 1000 },
  4: { price: 500000, reward: 10000 },
  5: { price: 1000000, reward: 50000 }
};

app.get("/api/games/unlocked", auth, (req, res) => {
  const games = db.prepare(`
    SELECT game_id
    FROM unlocked_games
    WHERE user_id = ?
  `).all(req.user.id);

  res.json({
    unlocked: [1, ...games.map(game => game.game_id)]
  });
});

app.post("/api/games/unlock", auth, (req, res) => {
  const gameId = Number(req.body.gameId);
  const game = GAME_CONFIG[gameId];

  if (!game || gameId === 1) {
    return res.status(400).json({ error: "Jeu invalide." });
  }

  const user = db.prepare(
    "SELECT gems FROM users WHERE id = ?"
  ).get(req.user.id);

  if (!user || (user.gems || 0) < game.price) {
    return res.status(400).json({
      error: "Tu n'as pas assez de gemmes."
    });
  }

  const alreadyUnlocked = db.prepare(`
    SELECT id FROM unlocked_games
    WHERE user_id = ? AND game_id = ?
  `).get(req.user.id, gameId);

  if (alreadyUnlocked) {
    return res.status(400).json({
      error: "Ce jeu est déjà débloqué."
    });
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET gems = gems - ?
      WHERE id = ?
    `).run(game.price, req.user.id);

    db.prepare(`
      INSERT INTO unlocked_games (user_id, game_id)
      VALUES (?, ?)
    `).run(req.user.id, gameId);
  });

  transaction();

  const updated = db.prepare(
    "SELECT gems FROM users WHERE id = ?"
  ).get(req.user.id);

  res.json({
    message: `Jeu ${gameId} débloqué !`,
    gems: updated.gems
  });
});

app.post("/api/games/reward", auth, (req, res) => {
  const gameId = Number(req.body.gameId);
  const game = GAME_CONFIG[gameId];

  if (!game) {
    return res.status(400).json({ error: "Jeu invalide." });
  }

  if (gameId > 1) {
    const unlocked = db.prepare(`
      SELECT id FROM unlocked_games
      WHERE user_id = ? AND game_id = ?
    `).get(req.user.id, gameId);

    if (!unlocked) {
      return res.status(403).json({
        error: "Tu dois d'abord débloquer ce jeu."
      });
    }
  }

  db.prepare(`
    UPDATE users
    SET gems = COALESCE(gems, 0) + ?
    WHERE id = ?
  `).run(game.reward, req.user.id);

  const updated = db.prepare(
    "SELECT gems FROM users WHERE id = ?"
  ).get(req.user.id);

  res.json({
    message: `Tu as gagné ${game.reward} 💎 !`,
    gems: updated.gems
  });
});


/* CLUBS */

app.get("/api/clubs", auth, (req, res) => {
  const clubs = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.description,
      c.creator_id,
      c.created_at,
      (SELECT COUNT(*) FROM club_likes WHERE club_id = c.id) AS likes,
      (SELECT COUNT(*) FROM club_subscriptions WHERE club_id = c.id) AS subscribers,
      (SELECT COUNT(*) FROM club_comments WHERE club_id = c.id) AS comments
    FROM clubs c
    ORDER BY c.created_at DESC
  `).all();

  res.json(clubs);
});

app.post("/api/clubs", auth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();

  if (!name || !description) {
    return res.status(400).json({
      error: "Le nom et la description sont obligatoires."
    });
  }

  try {
    const result = db.prepare(`
      INSERT INTO clubs (name, description, creator_id)
      VALUES (?, ?, ?)
    `).run(name, description, req.user.id);

    const club = db.prepare(`
      SELECT id, name, description, creator_id, created_at
      FROM clubs
      WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(club);
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(400).json({
        error: "Un club avec ce nom existe déjà."
      });
    }

    console.error(error);
    res.status(500).json({ error: "Impossible de créer le club." });
  }
});

app.get("/api/clubs/ranking", auth, (req, res) => {
  const clubs = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.description,
      (SELECT COUNT(*) FROM club_likes WHERE club_id = c.id) AS likes,
      (SELECT COUNT(*) FROM club_subscriptions WHERE club_id = c.id) AS subscribers,
      (SELECT COUNT(*) FROM club_comments WHERE club_id = c.id) AS comments
    FROM clubs c
    ORDER BY likes DESC, subscribers DESC, comments DESC, c.created_at ASC
    LIMIT 50
  `).all();

  res.json(clubs);
});

app.get("/api/clubs/:id", auth, (req, res) => {
  const club = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.description,
      c.creator_id,
      c.created_at,
      (SELECT COUNT(*) FROM club_likes WHERE club_id = c.id) AS likes,
      (SELECT COUNT(*) FROM club_subscriptions WHERE club_id = c.id) AS subscribers
    FROM clubs c
    WHERE c.id = ?
  `).get(req.params.id);

  if (!club) {
    return res.status(404).json({ error: "Club introuvable." });
  }

  res.json(club);
});

app.post("/api/clubs/:id/like", auth, (req, res) => {
  const clubId = Number(req.params.id);

  const club = db.prepare("SELECT id FROM clubs WHERE id = ?").get(clubId);
  if (!club) {
    return res.status(404).json({ error: "Club introuvable." });
  }

  const existing = db.prepare(`
    SELECT id FROM club_likes
    WHERE club_id = ? AND user_id = ?
  `).get(clubId, req.user.id);

  if (existing) {
    db.prepare("DELETE FROM club_likes WHERE id = ?").run(existing.id);
    return res.json({ liked: false });
  }

  db.prepare(`
    INSERT INTO club_likes (club_id, user_id)
    VALUES (?, ?)
  `).run(clubId, req.user.id);

  res.json({ liked: true });
});

app.post("/api/clubs/:id/subscribe", auth, (req, res) => {
  const clubId = Number(req.params.id);

  const club = db.prepare("SELECT id FROM clubs WHERE id = ?").get(clubId);
  if (!club) {
    return res.status(404).json({ error: "Club introuvable." });
  }

  const existing = db.prepare(`
    SELECT id FROM club_subscriptions
    WHERE club_id = ? AND user_id = ?
  `).get(clubId, req.user.id);

  if (existing) {
    db.prepare("DELETE FROM club_subscriptions WHERE id = ?").run(existing.id);
    return res.json({ subscribed: false });
  }

  db.prepare(`
    INSERT INTO club_subscriptions (club_id, user_id)
    VALUES (?, ?)
  `).run(clubId, req.user.id);

  res.json({ subscribed: true });
});

app.get("/api/clubs/:id/messages", auth, (req, res) => {
  const messages = db.prepare(`
    SELECT
      m.id,
      m.club_id,
      m.user_id,
      m.username,
      m.content,
      m.created_at
    FROM club_messages m
    WHERE m.club_id = ?
    ORDER BY m.id ASC
  `).all(req.params.id);

  res.json(messages);
});

app.post("/api/clubs/:id/messages", auth, (req, res) => {
  const clubId = Number(req.params.id);
  const message = String(req.body.content || "").trim();

  if (!message) {
    return res.status(400).json({ error: "Le message est vide." });
  }

  const club = db.prepare("SELECT id FROM clubs WHERE id = ?").get(clubId);
  if (!club) {
    return res.status(404).json({ error: "Club introuvable." });
  }

  db.prepare(`
    INSERT INTO club_messages (club_id, user_id, username, content)
    VALUES (?, ?, ?, ?)
  `).run(clubId, req.user.id, req.user.username, message);

  res.json({ success: true });
});

app.get("/api/clubs/:id/comments", auth, (req, res) => {
  const comments = db.prepare(`
    SELECT
      c.id,
      c.content,
      c.created_at,
      u.username
    FROM club_comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.club_id = ?
    ORDER BY c.id DESC
  `).all(req.params.id);

  res.json(comments);
});

app.post("/api/clubs/:id/comments", auth, (req, res) => {
  const clubId = Number(req.params.id);
  const content = String(req.body.content || "").trim();

  if (!content) {
    return res.status(400).json({ error: "Le commentaire est vide." });
  }

  const club = db.prepare("SELECT id FROM clubs WHERE id = ?").get(clubId);
  if (!club) {
    return res.status(404).json({ error: "Club introuvable." });
  }

  db.prepare(`
    INSERT INTO club_comments (club_id, user_id, content)
    VALUES (?, ?, ?)
  `).run(clubId, req.user.id, content);

  res.status(201).json({ success: true });
});


/* COLONNES FICHIERS ANNUAIRE */
try {
  db.exec("ALTER TABLE directory_posts ADD COLUMN file_name TEXT");
} catch (error) {
  // La colonne existe peut-être déjà
}

try {
  db.exec("ALTER TABLE directory_posts ADD COLUMN file_path TEXT");
} catch (error) {
  // La colonne existe peut-être déjà
}

/* CHAT PUBLIC */
app.get("/api/public-messages", auth, (req, res) => {
  const messages = db.prepare(`
    SELECT id, user_id, username, content, accessories, created_at
    FROM public_messages
    ORDER BY id DESC
    LIMIT 100
  `).all().reverse();

  res.json(messages);
});

/* DEMANDE PRIVÉE */
app.post("/api/private-request/:userId", auth, (req, res) => {
  const toUserId = Number(req.params.userId);

  if (!toUserId || toUserId === req.user.id) {
    return res.status(400).json({ error: "Utilisateur invalide." });
  }

  const target = getDbUser(toUserId);

  if (!target || target.banned) {
    return res.status(404).json({ error: "Utilisateur indisponible." });
  }

  const existing = db.prepare(`
    SELECT id FROM private_requests
    WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
  `).get(req.user.id, toUserId);

  if (existing) {
    return res.status(400).json({ error: "Demande déjà envoyée." });
  }

  db.prepare(`
    INSERT INTO private_requests (from_user_id, to_user_id)
    VALUES (?, ?)
  `).run(req.user.id, toUserId);

  io.to(`user-${toUserId}`).emit("new_private_request");
  res.json({ success: true });
});

/* DEMANDES */
app.get("/api/private-requests", auth, (req, res) => {
  const requests = db.prepare(`
    SELECT private_requests.*, users.username AS from_username
    FROM private_requests
    JOIN users ON users.id = private_requests.from_user_id
    WHERE private_requests.to_user_id = ?
      AND private_requests.status = 'pending'
  `).all(req.user.id);

  res.json(requests);
});

/* ACCEPTER / REFUSER */
app.post("/api/private-request/:id/respond", auth, (req, res) => {
  const id = Number(req.params.id);
  const action = req.body.action;

  const request = db.prepare(`
    SELECT * FROM private_requests
    WHERE id = ? AND to_user_id = ? AND status = 'pending'
  `).get(id, req.user.id);

  if (!request) {
    return res.status(404).json({ error: "Demande introuvable." });
  }

  if (action === "accept") {
    db.prepare(
      "UPDATE private_requests SET status = 'accepted' WHERE id = ?"
    ).run(id);

    io.to(`user-${request.from_user_id}`).emit("conversation_updated");
    io.to(`user-${request.to_user_id}`).emit("conversation_updated");

    return res.json({ success: true, accepted: true });
  }

  /* REFUS = LA DEMANDE DISPARAÎT */
  db.prepare("DELETE FROM private_requests WHERE id = ?").run(id);

  io.to(`user-${request.from_user_id}`).emit("conversation_updated");
  res.json({ success: true, refused: true });
});


/* QUITTER UNE DISCUSSION PRIVÉE */
app.post("/api/private-conversations/:userId/leave", auth, (req, res) => {
  const otherUserId = Number(req.params.userId);

  if (!otherUserId) {
    return res.status(400).json({ error: "Utilisateur invalide." });
  }

  const conversation = db.prepare(`
    SELECT id FROM private_requests
    WHERE status = 'accepted'
      AND (
        (from_user_id = ? AND to_user_id = ?)
        OR
        (from_user_id = ? AND to_user_id = ?)
      )
  `).get(
    req.user.id,
    otherUserId,
    otherUserId,
    req.user.id
  );

  if (!conversation) {
    return res.status(404).json({
      error: "Discussion introuvable."
    });
  }

  db.prepare(`
    DELETE FROM private_requests
    WHERE id = ?
  `).run(conversation.id);

  io.to(`user-${req.user.id}`).emit(
    "conversation_left",
    { otherUserId }
  );

  io.to(`user-${otherUserId}`).emit(
    "conversation_left",
    { otherUserId: req.user.id }
  );

  res.json({ success: true });
});

/* CONVERSATIONS */
app.get("/api/private-conversations", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT *
    FROM private_requests
    WHERE status = 'accepted'
      AND (from_user_id = ? OR to_user_id = ?)
  `).all(req.user.id, req.user.id);

  const conversations = [];

  for (const row of rows) {
    const otherId =
      row.from_user_id === req.user.id
        ? row.to_user_id
        : row.from_user_id;

    const other = db.prepare(`
      SELECT id, username
      FROM users
      WHERE id = ? AND banned = 0
    `).get(otherId);

    if (other) conversations.push(other);
  }

  res.json(conversations);
});


/* HISTORIQUE D'UNE DISCUSSION PRIVÉE */
app.get("/api/private-messages/:userId", auth, (req, res) => {
  const otherUserId = Number(req.params.userId);

  if (!otherUserId) {
    return res.status(400).json({ error: "Utilisateur invalide." });
  }

  const allowed = db.prepare(`
    SELECT id FROM private_requests
    WHERE status = 'accepted'
      AND (
        (from_user_id = ? AND to_user_id = ?)
        OR
        (from_user_id = ? AND to_user_id = ?)
      )
  `).get(
    req.user.id,
    otherUserId,
    otherUserId,
    req.user.id
  );

  if (!allowed) {
    return res.status(403).json({
      error: "Discussion privée non autorisée."
    });
  }

  const messages = db.prepare(`
    SELECT id, from_user_id, to_user_id, content, created_at
    FROM private_messages
    WHERE
      (from_user_id = ? AND to_user_id = ?)
      OR
      (from_user_id = ? AND to_user_id = ?)
    ORDER BY id ASC
  `).all(
    req.user.id,
    otherUserId,
    otherUserId,
    req.user.id
  );

  res.json(messages);
});

/* ADMIN : UTILISATEURS */
app.get("/api/admin/users", auth, adminOnly, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, banned, created_at
    FROM users
    ORDER BY username
  `).all();

  res.json(users);
});

/* PROPRIÉTAIRE : DONNER / RETIRER ADMIN */
app.post("/api/admin/users/:id/role", auth, (req, res) => {
  if (req.user.role !== "owner") {
    return res.status(403).json({
      error: "Seul le propriétaire peut modifier les rôles."
    });
  }

  const id = Number(req.params.id);
  const role = req.body.role;

  if (!["user", "admin"].includes(role)) {
    return res.status(400).json({ error: "Rôle invalide." });
  }

  const target = getDbUser(id);

  if (!target || target.role === "owner") {
    return res.status(400).json({ error: "Utilisateur invalide." });
  }

  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);

  const updatedUser = getDbUser(id);

  io.to(`user-${id}`).emit("role_updated", {
    role: updatedUser.role,
    message:
      role === "admin"
        ? "Tu es maintenant administrateur."
        : "Ton rôle administrateur a été retiré."
  });

  addSystemMessage(
    role === "admin"
      ? `🛡️ ${updatedUser.username} est maintenant administrateur.`
      : `📢 ${updatedUser.username} n'est plus administrateur.`
  );

  res.json({ success: true });
});




/* BOUTIQUE : vérifie le panneau Admin 💎 activé */
function shopAdminOnly(req, res, next) {
  const panel = db.prepare(`
    SELECT id
    FROM purchases
    WHERE user_id = ?
      AND item_id = 'admin_panel'
      AND active = 1
  `).get(req.user.id);

  if (!panel) {
    return res.status(403).json({
      error: "Tu dois acheter et activer le Panneau Admin 💎."
    });
  }

  next();
}

/* ADMIN 💎 : bannir */
app.post("/api/shop-admin/ban", auth, shopAdminOnly, (req, res) => {
  const username = String(req.body.username || "").trim();

  const user = db.prepare(
    "SELECT id, username FROM users WHERE username = ?"
  ).get(username);

  if (!user) {
    return res.status(404).json({ error: "Utilisateur introuvable." });
  }

  if (user.id === req.user.id) {
    return res.status(400).json({ error: "Tu ne peux pas te bannir toi-même." });
  }

  db.prepare(
    "UPDATE users SET banned = 1 WHERE id = ?"
  ).run(user.id);

  addPublicMessage(
    "🛡️ Admin 💎",
    `${req.user.username} a banni ${user.username}.`
  );

  res.json({ message: `${user.username} a été banni.` });
});

/* ADMIN 💎 : débannir */
app.post("/api/shop-admin/unban", auth, shopAdminOnly, (req, res) => {
  const username = String(req.body.username || "").trim();

  const user = db.prepare(
    "SELECT id, username FROM users WHERE username = ?"
  ).get(username);

  if (!user) {
    return res.status(404).json({ error: "Utilisateur introuvable." });
  }

  db.prepare(
    "UPDATE users SET banned = 0 WHERE id = ?"
  ).run(user.id);

  addPublicMessage(
    "🛡️ Admin 💎",
    `${req.user.username} a débanni ${user.username}.`
  );

  res.json({ message: `${user.username} a été débanni.` });
});

/* ADMIN 💎 : supprimer les messages d'un utilisateur */
app.post("/api/shop-admin/delete-messages", auth, shopAdminOnly, (req, res) => {
  const username = String(req.body.username || "").trim();

  const user = db.prepare(
    "SELECT id, username FROM users WHERE username = ?"
  ).get(username);

  if (!user) {
    return res.status(404).json({ error: "Utilisateur introuvable." });
  }

  const result = db.prepare(`
    DELETE FROM public_messages
    WHERE user_id = ? OR username = ?
  `).run(user.id, user.username);

  addPublicMessage(
    "🛡️ Admin 💎",
    `${req.user.username} a supprimé ${result.changes} message(s) de ${user.username}.`
  );

  io.emit("public_messages_cleared");

  res.json({
    message: `${result.changes} message(s) supprimé(s).`
  });
});


/* ADMIN : SUPPRIMER LES MESSAGES D'UN UTILISATEUR */
app.post("/api/admin/public-messages/user", auth, adminOnly, (req, res) => {
  const username = String(req.body.username || "").trim();

  if (!username) {
    return res.status(400).json({
      error: "Entre un pseudo."
    });
  }

  const user = db.prepare(
    "SELECT id, username FROM users WHERE username = ?"
  ).get(username);

  if (!user) {
    return res.status(404).json({
      error: "Utilisateur introuvable."
    });
  }

  const messages = db.prepare(`
    SELECT id, user_id, username, content, created_at
    FROM public_messages
    WHERE user_id = ? OR username = ?
  `).all(user.id, user.username);

  const archive = db.prepare(`
    INSERT INTO public_messages_archive
    (original_message_id, user_id, username, content, original_created_at, deleted_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const message of messages) {
      archive.run(
        message.id,
        message.user_id,
        message.username,
        message.content,
        message.created_at,
        req.user.id
      );
    }

    db.prepare(`
      DELETE FROM public_messages
      WHERE user_id = ? OR username = ?
    `).run(user.id, user.username);
  });

  transaction();

  io.emit("public_messages_user_deleted", {
    userId: user.id,
    username: user.username
  });

  addSystemMessage(
    `🗑️ ${req.user.username}, membre de l'administration, a supprimé les messages publics de ${user.username}.`
  );

  res.json({
    success: true,
    username: user.username,
    deleted: messages.length
  });
});

/* ADMIN : SUPPRIMER LES MESSAGES PUBLICS */
app.post("/api/admin/public-messages/clear", auth, adminOnly, (req, res) => {
  const messages = db.prepare(`
    SELECT id, user_id, username, content, created_at
    FROM public_messages
  `).all();

  const archive = db.prepare(`
    INSERT INTO public_messages_archive
    (original_message_id, user_id, username, content, original_created_at, deleted_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const message of messages) {
      archive.run(
        message.id,
        message.user_id,
        message.username,
        message.content,
        message.created_at,
        req.user.id
      );
    }

    db.prepare("DELETE FROM public_messages").run();
  });

  transaction();

  io.emit("public_messages_cleared");

  addSystemMessage(
    `🗑️ ${req.user.username}, membre de l'administration, a supprimé les messages publics.`
  );

  res.json({
    success: true,
    deleted: messages.length
  });
});

/* BAN */
app.post("/api/admin/users/:id/ban", auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const target = getDbUser(id);

  if (!target) {
    return res.status(404).json({ error: "Utilisateur introuvable." });
  }

  if (target.role === "owner") {
    return res.status(403).json({
      error: "Impossible de bannir le propriétaire."
    });
  }

  db.prepare("UPDATE users SET banned = 1 WHERE id = ?").run(id);

  addSystemMessage(
    `🚫 ${target.username} a été banni par l'administration.`
  );

  disconnectUser(id);

  res.json({ success: true });
});

/* DÉBAN */


function sendAdminGemMessage(content) {
  const owner = db.prepare(
    "SELECT id, username FROM users WHERE role = 'owner' LIMIT 1"
  ).get();

  if (!owner) return;

  const result = db.prepare(`
    INSERT INTO public_messages (user_id, username, content)
    VALUES (?, ?, ?)
  `).run(owner.id, "💎 ADMIN", content);

  io.emit("public_message", {
    id: result.lastInsertRowid,
    user_id: owner.id,
    username: "💎 ADMIN",
    content,
    created_at: new Date().toISOString()
  });
}

app.post("/api/admin/gems/add", auth, adminOnly, (req, res) => {
  const { username, amount } = req.body;
  const gems = Number(amount);

  if (!username || !Number.isInteger(gems) || gems <= 0) {
    return res.status(400).json({ error: "Pseudo ou nombre de gemmes invalide." });
  }

  const user = db.prepare("SELECT id, username, gems FROM users WHERE username = ?")
    .get(username.trim());

  if (!user) {
    return res.status(404).json({ error: "Utilisateur introuvable." });
  }

  db.prepare("UPDATE users SET gems = COALESCE(gems, 0) + ? WHERE id = ?")
    .run(gems, user.id);

  const updated = db.prepare("SELECT username, gems FROM users WHERE id = ?")
    .get(user.id);

  sendAdminGemMessage(
    `${req.user.username} a donné ${gems} 💎 à ${updated.username}.`
  );

  res.json({
    message: `${gems} gemmes ajoutées à ${updated.username}.`,
    gems: updated.gems
  });
});

app.post("/api/admin/gems/remove", auth, adminOnly, (req, res) => {
  const { username, amount } = req.body;
  const gems = Number(amount);

  if (!username || !Number.isInteger(gems) || gems <= 0) {
    return res.status(400).json({ error: "Pseudo ou nombre de gemmes invalide." });
  }

  const user = db.prepare("SELECT id, username, gems FROM users WHERE username = ?")
    .get(username.trim());

  if (!user) {
    return res.status(404).json({ error: "Utilisateur introuvable." });
  }

  db.prepare(`
    UPDATE users
    SET gems = MAX(0, COALESCE(gems, 0) - ?)
    WHERE id = ?
  `).run(gems, user.id);

  const updated = db.prepare("SELECT username, gems FROM users WHERE id = ?")
    .get(user.id);

  sendAdminGemMessage(
    `${req.user.username} a retiré ${gems} 💎 à ${updated.username}.`
  );

  res.json({
    message: `${gems} gemmes retirées à ${updated.username}.`,
    gems: updated.gems
  });
});

app.post("/api/admin/users/:id/unban", auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const target = getDbUser(id);

  if (!target) {
    return res.status(404).json({ error: "Utilisateur introuvable." });
  }

  db.prepare("UPDATE users SET banned = 0 WHERE id = ?").run(id);

  addSystemMessage(
    `✅ ${target.username} a été débanni par l'administration.`
  );

  res.json({ success: true });
});

/* SOCKET */
io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || "";
  const cookies = Object.fromEntries(
    cookieHeader
      .split(";")
      .map(part => part.trim().split("="))
      .filter(([key, value]) => key && value)
  );

  const token = cookies.discuteapp_session;
  const decoded = getUserFromToken(token);
  const user = decoded ? getDbUser(decoded.id) : null;

  if (!user || user.banned) {
    return next(new Error("Non autorisé"));
  }

  socket.user = user;
  next();
});

io.on("connection", socket => {
  socket.join(`user-${socket.user.id}`);

  // Marquer l'utilisateur comme connecté
  const userId = socket.user.id;
  onlineUsers.set(userId, (onlineUsers.get(userId) || 0) + 1);

  // Prévenir tous les clients
  io.emit("user_status_changed", {
    userId,
    online: true
  });

  socket.on("disconnect", () => {
    const count = (onlineUsers.get(userId) || 1) - 1;

    if (count <= 0) {
      onlineUsers.delete(userId);
      io.emit("user_status_changed", {
        userId,
        online: false
      });
    } else {
      onlineUsers.set(userId, count);
    }
  });

  socket.on("public_message", rawContent => {
    const freshUser = getDbUser(socket.user.id);

    if (!freshUser || freshUser.banned) return;

    const content = String(rawContent || "").trim().slice(0, 1000);

    if (!content) return;

    const accessories = db.prepare(`
      SELECT item_id, item_type, item_name, item_data
      FROM purchases
      WHERE user_id = ? AND active = 1
    `).all(freshUser.id);

    const activeAccessories = {};

    for (const item of accessories) {
      let data = {};

      try {
        data = JSON.parse(item.item_data || "{}");
      } catch {
        data = {};
      }

      activeAccessories[item.item_type] = {
        itemId: item.item_id,
        name: item.item_name,
        data
      };
    }

    const result = db.prepare(`
      INSERT INTO public_messages
      (user_id, username, content, accessories)
      VALUES (?, ?, ?, ?)
    `).run(
      freshUser.id,
      freshUser.username,
      content,
      JSON.stringify(activeAccessories)
    );

    io.emit("public_message", {
      id: result.lastInsertRowid,
      user_id: freshUser.id,
      username: freshUser.username,
      content,
      accessories: activeAccessories
    });
  });

  socket.on("private_message", ({ toUserId, content }) => {
    const freshUser = getDbUser(socket.user.id);

    if (!freshUser || freshUser.banned) return;

    const cleanContent = String(content || "").trim().slice(0, 1000);
    const targetId = Number(toUserId);

    if (!cleanContent || !targetId) return;

    const allowed = db.prepare(`
      SELECT id FROM private_requests
      WHERE status = 'accepted'
        AND (
          (from_user_id = ? AND to_user_id = ?)
          OR
          (from_user_id = ? AND to_user_id = ?)
        )
    `).get(freshUser.id, targetId, targetId, freshUser.id);

    if (!allowed) return;

    const result = db.prepare(`
      INSERT INTO private_messages (from_user_id, to_user_id, content)
      VALUES (?, ?, ?)
    `).run(freshUser.id, targetId, cleanContent);

    const message = {
      id: result.lastInsertRowid,
      fromUserId: freshUser.id,
      toUserId: targetId,
      content: cleanContent
    };

    io.to(`user-${freshUser.id}`).emit("private_message", message);
    io.to(`user-${targetId}`).emit("private_message", message);
  });
});

server.listen(PORT, () => {
  console.log(`DiscuteApp démarré : http://localhost:${PORT}`);
});
