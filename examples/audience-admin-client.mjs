const baseUrl = (process.env.IROHARNESS_URL || "http://127.0.0.1:4178").replace(/\/+$/, "");
const adminToken = process.env.IROHARNESS_ADMIN_TOKEN || "";

const jsonRequest = async (path, { method = "GET", body = null } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  const payload = text.trim() ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
};

await jsonRequest("/audience/users", {
  method: "POST",
  body: {
    id: "developer_demo",
    displayName: "Demo Developer",
    role: "developer",
    relationship: "core-developer",
    identities: {
      discord: "discord-demo-developer"
    }
  }
});

await jsonRequest("/audience/users/developer_demo/identities", {
  method: "POST",
  body: {
    platform: "youtube",
    platformUserId: "UC-demo-developer",
    displayName: "Demo Developer Channel"
  }
});

await jsonRequest("/audience/users/developer_demo/permissions", {
  method: "POST",
  body: {
    permission: "manage_stream",
    effect: "allow",
    scope: "stream:youtube",
    reason: "demo stream host"
  }
});

await jsonRequest("/audience/stream-sessions", {
  method: "POST",
  body: {
    id: "youtube_demo_stream",
    platform: "youtube",
    platformChannelId: "live-chat-demo",
    title: "IroHarness Demo Stream",
    hostUserId: "developer_demo"
  }
});

const resolved = await jsonRequest(
  "/audience/resolve?platform=youtube&platformUserId=UC-demo-developer&displayName=Demo%20Developer"
);
const snapshot = await jsonRequest("/audience");

console.log(
  JSON.stringify(
    {
      baseUrl,
      resolvedUserId: resolved.user.id,
      resolvedKnown: resolved.known,
      users: snapshot.users.length,
      identities: snapshot.userIdentities.length,
      permissionOverrides: snapshot.permissionOverrides.length,
      streamSessions: snapshot.streamSessions.length
    },
    null,
    2
  )
);
