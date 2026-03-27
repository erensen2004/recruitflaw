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
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function getPrivateObjectUrl(objectPath?: string | null) {
  if (!objectPath) return null;
  if (objectPath.startsWith("/api/storage")) return objectPath;
  if (objectPath.startsWith("/objects/")) return `/api/storage${objectPath}`;
  return `/api/storage/objects/${objectPath.replace(/^\/+/, "")}`;
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
    popup.document.title = "Opening CV...";
    popup.document.body.innerHTML = "<p style=\"font-family: sans-serif; padding: 24px;\">Opening CV...</p>";
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
