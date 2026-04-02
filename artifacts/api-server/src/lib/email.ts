const RESEND_API_URL = "https://api.resend.com/emails";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} is not configured`);
  }
  return value.trim();
}

export async function sendPasswordResetEmail(input: {
  to: string;
  name: string;
  resetUrl: string;
  expiresAt: string;
}) {
  const apiKey = requireEnv("RESEND_API_KEY");
  const from = requireEnv("RESEND_FROM_EMAIL");

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: "Reset your RecruitFlow password",
      text: [
        `Hello ${input.name},`,
        "",
        "We received a request to reset your RecruitFlow password.",
        `Reset your password: ${input.resetUrl}`,
        `This link expires at ${input.expiresAt}.`,
        "",
        "If you did not request this change, you can ignore this email.",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:560px">
          <h2 style="margin:0 0 16px">Reset your RecruitFlow password</h2>
          <p>Hello ${escapeHtml(input.name)},</p>
          <p>We received a request to reset your RecruitFlow password.</p>
          <p style="margin:24px 0">
            <a href="${input.resetUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">
              Reset password
            </a>
          </p>
          <p>This link expires at ${escapeHtml(input.expiresAt)}.</p>
          <p>If you did not request this change, you can ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Resend request failed: ${response.status} ${payload}`);
  }

  const payload = await response.json().catch(() => null) as { id?: string } | null;
  return {
    id: payload?.id ?? null,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
