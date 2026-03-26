import { getErrorMessage } from "@/lib/resume-parse";

type UploadResumeFileOptions = {
  token: string | null;
  maxAttempts?: number;
};

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status: number) {
  return RETRYABLE_STATUS_CODES.has(status);
}

export async function uploadResumeFile(file: File, options: UploadResumeFileOptions): Promise<string> {
  const { token, maxAttempts = 2 } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const uploadResponse = await fetch("/api/storage/uploads/direct", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Upload-Name": encodeURIComponent(file.name),
          "X-Upload-Size": String(file.size),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        const message = uploadResponse.status === 0 ? "File upload failed" : await getErrorMessage(uploadResponse);
        const error = new Error(message);
        (error as Error & { status?: number }).status = uploadResponse.status;
        throw error;
      }

      const payload = (await uploadResponse.json()) as { objectPath?: string };
      if (!payload.objectPath) {
        throw new Error("Upload completed but no file path was returned");
      }
      return payload.objectPath;
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : null;
      const canRetry = attempt < maxAttempts && (status == null || shouldRetryStatus(status));
      if (!canRetry) {
        throw error instanceof Error ? error : new Error("File upload failed");
      }
      await sleep(350 * attempt);
    }
  }

  throw new Error("File upload failed");
}
