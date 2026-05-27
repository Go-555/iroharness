const avatar = document.querySelector("#avatar");
const speech = document.querySelector("#speech");
const mode = document.querySelector("#mode");
const events = document.querySelector("#events");
const form = document.querySelector("#turn-form");
const text = document.querySelector("#text");
const modality = document.querySelector("#modality");
const adminStatus = document.querySelector("#admin-status");
const adminTokenForm = document.querySelector("#admin-token-form");
const adminToken = document.querySelector("#admin-token");
const audienceTable = document.querySelector("#audience-table");
const userForm = document.querySelector("#user-form");
const identityForm = document.querySelector("#identity-form");
const resolveForm = document.querySelector("#resolve-form");
const resolveResult = document.querySelector("#resolve-result");
const permissionForm = document.querySelector("#permission-form");
const streamForm = document.querySelector("#stream-form");
const params = new URLSearchParams(window.location.search);
const overlay = params.get("view") === "overlay" || params.get("obs") === "1";
const admin = params.get("view") === "admin" || params.get("admin") === "1";
const actor = {
  platform: params.get("platform") || "browser",
  platformUserId: params.get("user") || "browser-guest",
  displayName: params.get("name") || "Browser Guest"
};

if (overlay) {
  document.body.classList.add("overlay");
}
if (admin) {
  document.body.classList.add("admin");
}

const appendEvent = (label, value) => {
  const row = document.createElement("div");
  row.className = "event";
  row.textContent = `${new Date().toLocaleTimeString()} ${label} ${JSON.stringify(value)}`;
  events.prepend(row);
};

const renderState = (state) => {
  avatar.dataset.mode = state.mode;
  mode.textContent = `${state.mode} / ${state.emotion}`;
  if (state.speechText) {
    speech.textContent = state.speechText;
  }
  if (state.mode === "idle" && !state.speechText) {
    speech.textContent = "IroHarness";
  }
};

const connectEvents = () => {
  const source = new EventSource("/events");
  source.addEventListener("state", (event) => {
    const payload = JSON.parse(event.data);
    renderState(payload.state);
    appendEvent("state", payload.state);
  });
  source.addEventListener("speech", (event) => {
    const payload = JSON.parse(event.data);
    speech.textContent = payload.text;
    appendEvent("speech", { text: payload.text, brainId: payload.brainId });
  });
  source.addEventListener("task", (event) => {
    const payload = JSON.parse(event.data);
    appendEvent("task", {
      status: payload.status,
      ticketId: payload.ticketId,
      harnessId: payload.harnessId
    });
  });
  source.onerror = () => appendEvent("stream", "reconnecting");
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = text.value.trim();
  if (!value) {
    return;
  }
  await fetch("/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: value,
      modality: modality.value,
      source: actor.platform,
      actor
    })
  });
  text.value = "";
});

const getAdminToken = () => adminToken?.value.trim() || params.get("token") || "";

const adminHeaders = () => ({
  "content-type": "application/json",
  ...(getAdminToken() ? { authorization: `Bearer ${getAdminToken()}` } : {})
});

const adminRequest = async (path, { method = "GET", body = null } = {}) => {
  const response = await fetch(path, {
    method,
    headers: adminHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  }
  return payload;
};

const setAdminStatus = (value) => {
  if (adminStatus) {
    adminStatus.textContent = value;
  }
};

const appendText = (parent, tagName, text, className = "") => {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (className) {
    element.className = className;
  }
  parent.append(element);
  return element;
};

const renderAudience = (snapshot) => {
  if (!audienceTable) {
    return;
  }
  const users = snapshot.users || [];
  const streams = snapshot.streamSessions || [];
  audienceTable.replaceChildren();

  const userList = document.createElement("div");
  userList.className = "audience-list";
  users.forEach((user) => {
    const row = document.createElement("article");
    row.className = "audience-row";
    const identities = Object.entries(user.identities || {})
      .map(([platform, id]) => `${platform}:${id}`)
      .join(" / ");
    appendText(row, "strong", user.displayName);
    appendText(row, "span", `${user.id} / ${user.role} / ${user.relationship}`);
    appendText(row, "code", identities || "no identities");
    userList.append(row);
  });

  const streamList = document.createElement("div");
  streamList.className = "audience-list";
  streams.forEach((stream) => {
    const row = document.createElement("article");
    row.className = "audience-row";
    appendText(row, "strong", stream.title || stream.id);
    appendText(row, "span", `${stream.platform}:${stream.platformChannelId} / ${stream.status}`);
    appendText(row, "code", stream.id);
    streamList.append(row);
  });

  const usersTitle = document.createElement("h2");
  usersTitle.textContent = "Users";
  const streamsTitle = document.createElement("h2");
  streamsTitle.textContent = "Streams";
  audienceTable.append(usersTitle, userList, streamsTitle, streamList);
};

const loadAudience = async () => {
  if (!admin) {
    return;
  }
  try {
    const snapshot = await adminRequest("/audience");
    renderAudience(snapshot);
    setAdminStatus(`${snapshot.users.length} users / ${snapshot.streamSessions.length} streams`);
  } catch (error) {
    setAdminStatus(error.message);
  }
};

adminTokenForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadAudience();
});

userForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await adminRequest("/audience/users", {
    method: "POST",
    body: {
      id: document.querySelector("#user-id").value.trim(),
      displayName: document.querySelector("#user-name").value.trim(),
      role: document.querySelector("#user-role").value,
      relationship: document.querySelector("#user-relationship").value.trim()
    }
  });
  await loadAudience();
});

identityForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userId = document.querySelector("#identity-user-id").value.trim();
  await adminRequest(`/audience/users/${encodeURIComponent(userId)}/identities`, {
    method: "POST",
    body: {
      platform: document.querySelector("#identity-platform").value,
      platformUserId: document.querySelector("#identity-platform-user-id").value.trim(),
      displayName: document.querySelector("#identity-display-name").value.trim()
    }
  });
  await loadAudience();
});

resolveForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const platform = document.querySelector("#resolve-platform").value;
  const platformUserId = document.querySelector("#resolve-platform-user-id").value.trim();
  const displayName = document.querySelector("#resolve-display-name").value.trim();
  const query = new URLSearchParams({
    platform,
    platformUserId,
    ...(displayName ? { displayName } : {})
  });
  const resolved = await adminRequest(`/audience/resolve?${query}`);
  if (resolveResult) {
    resolveResult.textContent = resolved.known
      ? `${resolved.user.id} / ${resolved.user.role} / ${resolved.user.relationship}`
      : `anonymous / ${resolved.identity.platform}:${resolved.identity.platformUserId}`;
  }
});

permissionForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userId = document.querySelector("#permission-user-id").value.trim();
  await adminRequest(`/audience/users/${encodeURIComponent(userId)}/permissions`, {
    method: "POST",
    body: {
      permission: document.querySelector("#permission-name").value,
      effect: document.querySelector("#permission-effect").value,
      scope: document.querySelector("#permission-scope").value.trim()
    }
  });
  await loadAudience();
});

streamForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await adminRequest("/audience/stream-sessions", {
    method: "POST",
    body: {
      id: document.querySelector("#stream-id").value.trim(),
      platform: document.querySelector("#stream-platform").value,
      platformChannelId: document.querySelector("#stream-channel-id").value.trim(),
      title: document.querySelector("#stream-title").value.trim()
    }
  });
  await loadAudience();
});

const loadInitialState = async () => {
  const response = await fetch("/state");
  renderState(await response.json());
};

await loadInitialState();
connectEvents();
await loadAudience();
