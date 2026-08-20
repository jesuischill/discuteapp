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
app.use(express.static(path.join(__dirname, "public")));

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
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Non connecté." });
  }

  const decoded = getUserFromToken(header.slice(7));
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

    res.json({
      token: createToken(user),
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

  res.json({
    token: createToken(user),
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  });
});

/* UTILISATEURS */
app.get("/api/users", auth, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, banned
    FROM users
    WHERE id != ? AND banned = 0
    ORDER BY username
  `).all(req.user.id);

  res.json(users);
});

/* CHAT PUBLIC */
app.get("/api/public-messages", auth, (req, res) => {
  const messages = db.prepare(`
    SELECT id, user_id, username, content, created_at
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
  const token = socket.handshake.auth?.token;
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

  socket.on("public_message", rawContent => {
    const freshUser = getDbUser(socket.user.id);

    if (!freshUser || freshUser.banned) return;

    const content = String(rawContent || "").trim().slice(0, 1000);

    if (!content) return;

    const result = db.prepare(`
      INSERT INTO public_messages (user_id, username, content)
      VALUES (?, ?, ?)
    `).run(freshUser.id, freshUser.username, content);

    io.emit("public_message", {
      id: result.lastInsertRowid,
      user_id: freshUser.id,
      username: freshUser.username,
      content
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
