// Toujours démarrer avec une session vide
localStorage.removeItem("discuteapp_token");
localStorage.removeItem("discuteapp_user");

let token = null;
let me = null;
let socket = null;
let currentPrivateUser = null;

function headers() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {})
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erreur");
  }

  return data;
}

async function register() {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "Erreur");

    saveSession(data);
  } catch (error) {
    document.getElementById("authError").textContent = error.message;
  }
}

async function login() {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "Erreur");

    saveSession(data);
  } catch (error) {
    document.getElementById("authError").textContent = error.message;
  }
}

function saveSession(data) {
  token = data.token;
  me = data.user;

  localStorage.setItem("discuteapp_token", token);
  localStorage.setItem("discuteapp_user", JSON.stringify(me));

  startApp();
}

function logout() {
  if (socket) socket.disconnect();

  localStorage.removeItem("discuteapp_token");
  localStorage.removeItem("discuteapp_user");

  token = null;
  me = null;

  location.reload();
}

function updateUserDisplay() {
  const currentUser = document.getElementById("currentUser");
  const adminButton = document.getElementById("adminButton");

  if (currentUser && me) {
    currentUser.textContent = `${me.username} (${me.role})`;
  }

  if (adminButton && me) {
    adminButton.classList.toggle(
      "hidden",
      !["owner", "admin"].includes(me.role)
    );
  }
}

function startApp() {
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appScreen").classList.remove("hidden");

  updateUserDisplay();

  if (socket) socket.disconnect();

  socket = io({
    auth: { token }
  });

  socket.on("connect_error", error => {
    if (error.message === "Non autorisé") {
      logout();
    }
  });

  socket.on("public_message", message => {
    const chat = document.getElementById("publicChat");

    if (chat) {
      addMessage("publicChat", message.username, message.content);
    }
  });

  socket.on("private_message", message => {
    const otherId =
      message.fromUserId === me.id
        ? message.toUserId
        : message.fromUserId;

    if (
      currentPrivateUser &&
      currentPrivateUser.id === otherId
    ) {
      const sender =
        message.fromUserId === me.id
          ? me.username
          : currentPrivateUser.username;

      addMessage("privateChat", sender, message.content);
    }
  });

  socket.on("role_updated", data => {
    me.role = data.role;
    localStorage.setItem("discuteapp_user", JSON.stringify(me));

    updateUserDisplay();
    alert(data.message);
  });

  socket.on("force_logout", data => {
    alert(data.message);
    logout();
  });

  socket.on("new_private_request", () => {
    console.log("Nouvelle demande privée reçue.");
  });

  socket.on("conversation_updated", () => {
    loadConversations();
  });

  socket.on("public_messages_cleared", () => {
    const chat = document.getElementById("publicChat");
    if (chat) chat.innerHTML = "";
  });

  socket.on("conversation_left", data => {
    if (
      currentPrivateUser &&
      currentPrivateUser.id === data.otherUserId
    ) {
      currentPrivateUser = null;

      document.getElementById("content").innerHTML = `
        <h1>🚪 Discussion terminée</h1>
        <p>L'autre utilisateur a quitté cette discussion.</p>
      `;
    }

    loadConversations();
  });

  loadConversations();
  showPublic();
}

async function showPublic() {
  currentPrivateUser = null;

  document.getElementById("content").innerHTML = `
    <h1>🌍 Chat public</h1>
    <div id="publicChat" class="chat"></div>
    <div class="row">
      <input id="publicInput" placeholder="Écrire un message..." maxlength="1000">
      <button onclick="sendPublic()">Envoyer</button>
    </div>
  `;

  try {
    const messages = await api("/api/public-messages");

    for (const message of messages) {
      addMessage(
        "publicChat",
        message.username,
        message.content
      );
    }
  } catch (error) {
    alert(error.message);
  }
}

function addMessage(containerId, username, content) {
  const container = document.getElementById(containerId);

  if (!container) return;

  const element = document.createElement("div");
  element.className = "message";

  const name = document.createElement("strong");
  name.textContent = username;

  const text = document.createElement("div");
  text.textContent = content;

  element.append(name, text);
  container.appendChild(element);

  container.scrollTop = container.scrollHeight;
}

function sendPublic() {
  const input = document.getElementById("publicInput");
  const content = input.value.trim();

  if (!content || !socket) return;

  socket.emit("public_message", content);
  input.value = "";
}

async function showUsers() {
  try {
    const users = await api("/api/users");

    document.getElementById("content").innerHTML = `
      <h1>👥 Utilisateurs</h1>
      <div id="usersList"></div>
    `;

    const list = document.getElementById("usersList");

    if (!users.length) {
      list.textContent = "Aucun autre utilisateur.";
      return;
    }

    users.forEach(user => {
      const card = document.createElement("div");
      card.className = "card";

      const name = document.createElement("strong");
      name.textContent = user.username;

      const role = document.createElement("p");
      role.textContent =
        user.role === "admin" ? "🛡️ Administrateur" : "👤 Utilisateur";

      const button = document.createElement("button");
      button.textContent = "Envoyer une demande privée";
      button.onclick = () => sendRequest(user.id);

      card.append(name, role, button);
      list.appendChild(card);
    });
  } catch (error) {
    alert(error.message);
  }
}

async function sendRequest(userId) {
  try {
    await api(`/api/private-request/${userId}`, {
      method: "POST"
    });

    alert("Demande envoyée !");
  } catch (error) {
    alert(error.message);
  }
}

async function showRequests() {
  try {
    const requests = await api("/api/private-requests");

    document.getElementById("content").innerHTML = `
      <h1>🔔 Demandes de discussion</h1>
      <div id="requestsList"></div>
    `;

    const list = document.getElementById("requestsList");

    if (!requests.length) {
      list.textContent = "Aucune demande.";
      return;
    }

    requests.forEach(request => {
      const card = document.createElement("div");
      card.className = "card";

      const text = document.createElement("p");
      text.textContent =
        `${request.from_username} veut discuter avec toi en privé.`;

      const accept = document.createElement("button");
      accept.textContent = "Accepter";
      accept.onclick = () =>
        respondRequest(request.id, "accept");

      const refuse = document.createElement("button");
      refuse.textContent = "Refuser";
      refuse.className = "danger";
      refuse.onclick = () =>
        respondRequest(request.id, "refuse");

      card.append(text, accept, refuse);
      list.appendChild(card);
    });
  } catch (error) {
    alert(error.message);
  }
}

async function respondRequest(id, action) {
  try {
    await api(`/api/private-request/${id}/respond`, {
      method: "POST",
      body: JSON.stringify({ action })
    });

    await showRequests();
    await loadConversations();
  } catch (error) {
    alert(error.message);
  }
}

async function loadConversations() {
  if (!token) return;

  try {
    const conversations = await api("/api/private-conversations");
    const container = document.getElementById("conversations");

    if (!container) return;

    container.innerHTML = "";

    conversations.forEach(user => {
      const button = document.createElement("button");
      button.textContent = `💬 ${user.username}`;
      button.onclick = () => openPrivate(user);
      container.appendChild(button);
    });
  } catch (error) {
    console.error(error.message);
  }
}

function openPrivate(user) {
  currentPrivateUser = user;

  document.getElementById("content").innerHTML = "";

  const title = document.createElement("h1");
  title.textContent = `💬 ${user.username}`;

  const chat = document.createElement("div");
  chat.id = "privateChat";
  chat.className = "chat";

  const row = document.createElement("div");
  row.className = "row";

  const input = document.createElement("input");
  input.id = "privateInput";
  input.placeholder = "Message privé...";
  input.maxLength = 1000;

  input.addEventListener("keydown", event => {
    if (event.key === "Enter") sendPrivate();
  });

  const button = document.createElement("button");
  button.textContent = "Envoyer";
  button.onclick = sendPrivate;

  const leaveButton = document.createElement("button");
  leaveButton.textContent = "🚪 Quitter la discussion";
  leaveButton.className = "danger";
  leaveButton.onclick = leavePrivateConversation;

  row.append(input, button);
  document.getElementById("content").append(
    title,
    chat,
    row,
    leaveButton
  );
}

async function leavePrivateConversation() {
  if (!currentPrivateUser) return;

  const username = currentPrivateUser.username;

  if (!confirm(
    `Veux-tu vraiment quitter la discussion avec ${username} ?`
  )) {
    return;
  }

  try {
    await api(
      `/api/private-conversations/${currentPrivateUser.id}/leave`,
      {
        method: "POST"
      }
    );

    currentPrivateUser = null;

    await loadConversations();

    document.getElementById("content").innerHTML = `
      <h1>💬 Discussion quittée</h1>
      <p>
        La discussion avec ${username} a été supprimée.
        Une nouvelle demande sera nécessaire pour recommencer.
      </p>
    `;
  } catch (error) {
    alert(error.message);
  }
}


async function loadPrivateMessages(userId) {
  try {
    const messages = await api(`/api/private-messages/${userId}`);

    const chat = document.getElementById("privateChat");
    if (!chat) return;

    chat.innerHTML = "";

    for (const message of messages) {
      const sender =
        message.from_user_id === me.id
          ? me.username
          : currentPrivateUser.username;

      addMessage("privateChat", sender, message.content);
    }
  } catch (error) {
    console.error(error.message);
  }
}

function sendPrivate() {
  const input = document.getElementById("privateInput");
  const content = input?.value.trim();

  if (!content || !currentPrivateUser || !socket) return;

  socket.emit("private_message", {
    toUserId: currentPrivateUser.id,
    content
  });

  input.value = "";
}

async function showAdmin() {
  if (!["owner", "admin"].includes(me.role)) {
    alert("Accès refusé.");
    return;
  }

  try {
    const users = await api("/api/admin/users");

    document.getElementById("content").innerHTML = `
      <h1>🛡️ Panneau Admin</h1>
      <div id="adminUsers"></div>
    `;

    const container = document.getElementById("adminUsers");

    const clearButton = document.createElement("button");
    clearButton.textContent = "🗑️ Supprimer les messages publics";
    clearButton.className = "danger";
    clearButton.onclick = clearPublicMessages;

    container.appendChild(clearButton);

    const deleteUserMessagesBox = document.createElement("div");
    deleteUserMessagesBox.className = "card";

    const deleteTitle = document.createElement("strong");
    deleteTitle.textContent = "👤 Supprimer les messages d'un utilisateur";

    const deleteInput = document.createElement("input");
    deleteInput.id = "deleteMessagesUsername";
    deleteInput.placeholder = "Entrer le pseudo";

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "🗑️ Supprimer ses messages";
    deleteButton.className = "danger";
    deleteButton.onclick = deleteUserPublicMessages;

    deleteUserMessagesBox.append(
      deleteTitle,
      deleteInput,
      deleteButton
    );

    container.appendChild(deleteUserMessagesBox);

    users.forEach(user => {
      const card = document.createElement("div");
      card.className = "card";

      const title = document.createElement("strong");
      title.textContent =
        `${user.username} — ${user.role}` +
        (user.banned ? " 🚫 BANNI" : "");

      card.appendChild(title);

      if (me.role === "owner" && user.role !== "owner") {
        const roleButton = document.createElement("button");

        roleButton.textContent =
          user.role === "admin"
            ? "➖ Retirer Admin"
            : "➕ Donner Admin";

        roleButton.onclick = () =>
          changeRole(
            user.id,
            user.role === "admin" ? "user" : "admin"
          );

        card.appendChild(roleButton);
      }

      if (user.role !== "owner") {
        const banButton = document.createElement("button");

        banButton.textContent =
          user.banned ? "✅ Débannir" : "🚫 Bannir";

        banButton.className =
          user.banned ? "success" : "danger";

        banButton.onclick = () =>
          user.banned
            ? unbanUser(user.id)
            : banUser(user.id);

        card.appendChild(banButton);
      }

      container.appendChild(card);
    });
  } catch (error) {
    alert(error.message);
  }
}



async function deleteUserPublicMessages() {
  const input = document.getElementById("deleteMessagesUsername");
  const username = input?.value.trim();

  if (!username) {
    alert("Entre un pseudo.");
    return;
  }

  if (!confirm(
    `Voulez-vous supprimer tous les messages publics de ${username} ?`
  )) {
    return;
  }

  try {
    const result = await api(
      "/api/admin/public-messages/user",
      {
        method: "POST",
        body: JSON.stringify({ username })
      }
    );

    input.value = "";

    alert(
      `${result.deleted} message(s) de ${result.username} supprimé(s).`
    );
  } catch (error) {
    alert(error.message);
  }
}

async function clearPublicMessages() {
  if (!confirm(
    "Voulez-vous supprimer tous les messages du chat public ?"
  )) {
    return;
  }

  try {
    const result = await api(
      "/api/admin/public-messages/clear",
      { method: "POST" }
    );

    alert(`${result.deleted} message(s) supprimé(s).`);
  } catch (error) {
    alert(error.message);
  }
}

async function changeRole(id, role) {
  try {
    await api(`/api/admin/users/${id}/role`, {
      method: "POST",
      body: JSON.stringify({ role })
    });

    await showAdmin();
  } catch (error) {
    alert(error.message);
  }
}

async function banUser(id) {
  if (!confirm("Voulez-vous vraiment bannir cet utilisateur ?")) return;

  try {
    await api(`/api/admin/users/${id}/ban`, {
      method: "POST"
    });

    await showAdmin();
  } catch (error) {
    alert(error.message);
  }
}

async function unbanUser(id) {
  try {
    await api(`/api/admin/users/${id}/unban`, {
      method: "POST"
    });

    await showAdmin();
  } catch (error) {
    alert(error.message);
  }
}

if (token && me) {
  startApp();
}
