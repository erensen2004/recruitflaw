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
