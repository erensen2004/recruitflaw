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

async function requestUploadUrl(file: File, token: string | null) {
  const response = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type,
    }),
  });

  if (!response.ok) {
    const message = await getErrorMessage(response);
    const error = new Error(message);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return (await response.json()) as { uploadURL: string; objectPath: string };
}

async function confirmUpload(objectPath: string, token: string | null) {
  const response = await fetch("/api/storage/uploads/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ objectPath }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }
}

export async function uploadResumeFile(file: File, options: UploadResumeFileOptions): Promise<string> {
  const { token, maxAttempts = 2 } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { uploadURL, objectPath } = await requestUploadUrl(file, token);
      const uploadHeaders: Record<string, string> = { "Content-Type": file.type || "application/octet-stream" };
      if (token && uploadURL.startsWith("/api/")) {
        uploadHeaders.Authorization = `Bearer ${token}`;
      }

      const uploadResponse = await fetch(uploadURL, {
        method: "PUT",
        headers: uploadHeaders,
        body: file,
      });

      if (!uploadResponse.ok) {
        const message = uploadResponse.status === 0 ? "File upload failed" : await getErrorMessage(uploadResponse);
        const error = new Error(message);
        (error as Error & { status?: number }).status = uploadResponse.status;
        throw error;
      }

      await confirmUpload(objectPath, token);
      return objectPath;
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
