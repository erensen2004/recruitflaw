import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const MAX_CV_UPLOAD_BYTES = 4_000_000;

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
  const isPdf = file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return "Please select a PDF file.";
  }

  if (file.size > MAX_CV_UPLOAD_BYTES) {
    return "PDF files must be 4MB or smaller.";
  }

  return null;
}
