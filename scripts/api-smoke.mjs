const BASE_URL = (process.env.SMOKE_BASE_URL || "http://localhost:8080").replace(/\/$/, "");

const DEFAULT_USERS = [
  {
    label: "admin",
    email: process.env.SMOKE_ADMIN_EMAIL || "admin@ats.com",
    password: process.env.SMOKE_ADMIN_PASSWORD || "admin123",
  },
  {
    label: "client",
    email: process.env.SMOKE_CLIENT_EMAIL || "hr@techcorp.com",
    password: process.env.SMOKE_CLIENT_PASSWORD || "client123",
  },
  {
    label: "vendor",
    email: process.env.SMOKE_VENDOR_EMAIL || "vendor@staffingpro.com",
    password: process.env.SMOKE_VENDOR_PASSWORD || "vendor123",
  },
];

async function api(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // keep raw text
  }

  return { status: response.status, ok: response.ok, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function login(user) {
  const response = await api("/api/auth/login", {
    method: "POST",
    body: { email: user.email, password: user.password },
  });

  assert(response.ok, `${user.label} login failed: ${response.status}`);
  assert(response.payload?.token, `${user.label} login returned no token`);
  return response.payload.token;
}

async function main() {
  const health = await api("/api/healthz");
  assert(health.ok && health.payload?.status === "ok", "health check failed");

  const tokens = {};
  for (const user of DEFAULT_USERS) {
    tokens[user.label] = await login(user);
  }

  const adminRoles = await api("/api/roles", { token: tokens.admin });
  assert(adminRoles.ok && Array.isArray(adminRoles.payload), "admin roles listing failed");

  const clientCandidates = await api("/api/candidates", { token: tokens.client });
  assert(clientCandidates.ok && Array.isArray(clientCandidates.payload), "client candidates listing failed");
  assert(clientCandidates.payload.length > 0, "client candidate list is empty");

  const vendorCandidates = await api("/api/candidates", { token: tokens.vendor });
  assert(vendorCandidates.ok && Array.isArray(vendorCandidates.payload), "vendor candidates listing failed");

  const targetCandidate = clientCandidates.payload[0];
  const history = await api(`/api/candidates/${targetCandidate.id}/history`, { token: tokens.admin });
  assert(history.ok && Array.isArray(history.payload), "candidate history failed");

  if (process.env.SMOKE_ALLOW_MUTATION === "1") {
    const originalStatus = targetCandidate.status;
    const nextStatus = originalStatus === "rejected" ? "submitted" : "rejected";

    const updated = await api(`/api/candidates/${targetCandidate.id}/status`, {
      method: "PATCH",
      token: tokens.admin,
      body: { status: nextStatus, reason: "Automated smoke test" },
    });
    assert(updated.ok, `status update failed: ${updated.status}`);
    assert(updated.payload?.status === nextStatus, "status update did not persist");

    const reverted = await api(`/api/candidates/${targetCandidate.id}/status`, {
      method: "PATCH",
      token: tokens.admin,
      body: { status: originalStatus, reason: "Automated smoke test revert" },
    });
    assert(reverted.ok, `status revert failed: ${reverted.status}`);
    assert(reverted.payload?.status === originalStatus, "status revert did not persist");
  }

  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        users: DEFAULT_USERS.map(({ label }) => label),
        candidatesChecked: clientCandidates.payload.length,
        mutationTested: process.env.SMOKE_ALLOW_MUTATION === "1",
        result: "ok",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[smoke] failure:", error instanceof Error ? error.message : error);
  process.exit(1);
});
