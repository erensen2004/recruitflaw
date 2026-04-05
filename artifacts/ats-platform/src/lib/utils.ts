import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const MAX_CV_UPLOAD_BYTES = 4_000_000;
export const ALLOWED_RESUME_EXTENSIONS = [".pdf", ".docx", ".jpg", ".jpeg", ".png", ".webp"];
export const ALLOWED_RESUME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(amount);
}

export function getPrivateObjectUrl(objectPath?: string | null) {
  if (!objectPath) return null;
  if (objectPath.startsWith("/api/storage")) return objectPath;
  if (objectPath.startsWith("/objects/")) return `/api/storage${objectPath}`;
  return `/api/storage/objects/${objectPath.replace(/^\/+/, "")}`;
}

function getCvLoadingMarkup() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RecruitFlow | Preparing CV</title>
    <style>
      :root {
        color-scheme: light;
        --bg-a: #f8fafc;
        --bg-b: #eef2ff;
        --card: rgba(255, 255, 255, 0.88);
        --border: rgba(148, 163, 184, 0.18);
        --text: #0f172a;
        --muted: #64748b;
        --accent: #2563eb;
        --accent-soft: rgba(37, 99, 235, 0.14);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(59, 130, 246, 0.16), transparent 34%),
          radial-gradient(circle at bottom right, rgba(14, 165, 233, 0.12), transparent 32%),
          linear-gradient(180deg, var(--bg-a), var(--bg-b));
        color: var(--text);
        padding: 24px;
      }

      .shell {
        width: min(420px, 100%);
        border-radius: 28px;
        border: 1px solid var(--border);
        background: var(--card);
        backdrop-filter: blur(18px);
        box-shadow:
          0 24px 80px rgba(15, 23, 42, 0.12),
          inset 0 1px 0 rgba(255, 255, 255, 0.8);
        padding: 32px 28px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid rgba(148, 163, 184, 0.16);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 6px var(--accent-soft);
      }

      h1 {
        margin: 18px 0 0;
        font-size: 26px;
        line-height: 1.1;
      }

      p {
        margin: 12px 0 0;
        font-size: 14px;
        line-height: 1.7;
        color: var(--muted);
      }

      .progress {
        margin-top: 28px;
        height: 10px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(148, 163, 184, 0.14);
      }

      .progress > span {
        display: block;
        width: 38%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #2563eb, #38bdf8);
        animation: slide 1.35s ease-in-out infinite;
      }

      .hint {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 16px;
        font-size: 12px;
        color: var(--muted);
      }

      @keyframes slide {
        0% { transform: translateX(-105%); }
        60% { transform: translateX(170%); }
        100% { transform: translateX(170%); }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <div class="badge">
        <span class="dot"></span>
        RecruitFlow
      </div>
      <h1>Preparing candidate CV</h1>
      <p>
        We are securely fetching the original file and opening it in a new tab.
        This usually takes just a moment.
      </p>
      <div class="progress" aria-hidden="true">
        <span></span>
      </div>
      <div class="hint">
        <span>Loading document preview</span>
        <span>Please wait</span>
      </div>
    </main>
  </body>
</html>`;
}

export async function openPrivateObject(objectPath?: string | null, options?: { token?: string | null }) {
  const url = getPrivateObjectUrl(objectPath);
  if (!url) {
    throw new Error("CV file is not available.");
  }

  const token = options?.token ?? (typeof window !== "undefined" ? localStorage.getItem("ats_token") : null);
  if (!token) {
    throw new Error("Please sign in again to open private CV files.");
  }

  const popup = typeof window !== "undefined" ? window.open("", "_blank") : null;
  if (popup) {
    popup.document.open();
    popup.document.write(getCvLoadingMarkup());
    popup.document.close();
  }

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      let errorMessage = `Failed to open CV (${response.status})`;
      const contentType = response.headers.get("content-type") ?? "";
      try {
        if (contentType.includes("application/json")) {
          const body = await response.json() as { message?: string; error?: string };
          errorMessage = body.message || body.error || errorMessage;
        } else {
          const body = await response.text();
          if (body.trim()) errorMessage = body.trim();
        }
      } catch {
        // Keep the fallback status-based message.
      }

      if (popup && !popup.closed) popup.close();
      throw new Error(errorMessage);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    if (popup && !popup.closed) {
      popup.location.replace(blobUrl);
    } else if (typeof window !== "undefined") {
      window.open(blobUrl, "_blank");
    }

    window.setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 60_000);
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    throw error;
  }
}

export function validatePdfResumeFile(file: File) {
  return validateResumeFile(file, { pdfOnly: true });
}

export function validateResumeFile(file: File, options?: { pdfOnly?: boolean }) {
  const lowerName = file.name.toLowerCase();
  const extensionAllowed = ALLOWED_RESUME_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  const typeAllowed = ALLOWED_RESUME_TYPES.some((type) => file.type === type);

  if (options?.pdfOnly) {
    const isPdf = file.type.includes("pdf") || lowerName.endsWith(".pdf");
    if (!isPdf) {
      return "Please select a PDF file.";
    }
  } else if (!(extensionAllowed && (typeAllowed || file.type === ""))) {
    return "Please upload a PDF, DOCX, JPG, PNG, or WEBP resume.";
  }

  if (file.size > MAX_CV_UPLOAD_BYTES) {
    return "Resume files must be 4MB or smaller.";
  }

  return null;
}
