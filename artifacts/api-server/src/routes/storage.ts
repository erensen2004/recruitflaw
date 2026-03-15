import { Router, type Request, type Response } from "express";
import { Readable } from "stream";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { ObjectPermission } from "../lib/objectAcl.js";
import { requireAuth } from "../lib/auth.js";
import { validate } from "../middlewares/validate.js";
import { RequestUploadUrlSchema, ConfirmUploadSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";
import { db, candidatesTable, jobRolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveCandidateAccess } from "../lib/authz.js";

const router = Router();
const objectStorageService = new ObjectStorageService();
const MAX_VERCEL_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || "4000000");
const ALLOWED_RESUME_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ALLOWED_RESUME_EXTENSIONS = [".pdf", ".docx", ".jpg", ".jpeg", ".png", ".webp"];

function isAllowedResumeUpload(name: string, contentType: string): boolean {
  const normalizedName = name.trim().toLowerCase();
  const normalizedType = contentType.trim().toLowerCase();
  const extensionAllowed = ALLOWED_RESUME_EXTENSIONS.some((extension) => normalizedName.endsWith(extension));
  const typeAllowed = ALLOWED_RESUME_CONTENT_TYPES.has(normalizedType);
  return extensionAllowed && typeAllowed;
}

async function readRequestBody(req: Request, maxBytes?: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  req.on("data", (chunk: Buffer) => {
    total += chunk.length;
    if (maxBytes && total > maxBytes) {
      req.destroy(new Error(`Payload exceeds ${maxBytes} bytes`));
      return;
    }
    chunks.push(chunk);
  });

  await new Promise<void>((resolve, reject) => {
    req.on("end", resolve);
    req.on("error", reject);
  });

  return Buffer.concat(chunks);
}

router.put("/storage/uploads/local/:objectId", requireAuth, async (req: Request, res: Response) => {
  if (!objectStorageService.isLocalBackend()) {
    Errors.notFound(res, "Local upload endpoint is disabled");
    return;
  }

  try {
    const objectId = req.params.objectId;
    const fileBuffer = await readRequestBody(req);
    if (!fileBuffer.length) {
      Errors.badRequest(res, "Upload body is empty");
      return;
    }

    const objectPath = `/objects/uploads/${objectId}`;
    await objectStorageService.writeLocalUploadedObject(
      objectPath,
      fileBuffer,
      typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined,
    );

    res.status(204).end();
  } catch (error) {
    console.error("Error storing local upload:", error);
    Errors.internal(res, "Failed to store uploaded file");
  }
});

router.put("/storage/uploads/blob/:objectId", requireAuth, async (req: Request, res: Response) => {
  if (!objectStorageService.isBlobBackend()) {
    Errors.notFound(res, "Vercel Blob upload endpoint is disabled");
    return;
  }

  try {
    const objectId = req.params.objectId;
    const fileBuffer = await readRequestBody(req, MAX_VERCEL_UPLOAD_BYTES);
    if (!fileBuffer.length) {
      Errors.badRequest(res, "Upload body is empty");
      return;
    }

    const objectPath = `/objects/uploads/${objectId}`;
    await objectStorageService.writeBlobUploadedObject(
      objectPath,
      fileBuffer,
      typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined,
    );

    res.status(204).end();
  } catch (error) {
    if (error instanceof Error && error.message.includes("Payload exceeds")) {
      res.status(413).json({
        error: `Uploads must be ${Math.floor(MAX_VERCEL_UPLOAD_BYTES / 1_000_000)}MB or smaller on Vercel Blob server uploads`,
        code: "BAD_REQUEST",
      });
      return;
    }

    console.error("Error storing Vercel Blob upload:", error);
    Errors.internal(res, "Failed to store uploaded file");
  }
});

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload. Requires authentication.
 * Stores ACL metadata (owner, companyId, visibility=private) on the object.
 */
router.post(
  "/storage/uploads/request-url",
  requireAuth,
  validate(RequestUploadUrlSchema),
  async (req: Request, res: Response) => {
    try {
      const { name, size, contentType } = req.body;
      const { userId, companyId } = req.user!;

      if (!isAllowedResumeUpload(name, contentType)) {
        Errors.badRequest(
          res,
          "Only PDF, DOCX, JPG, PNG, and WEBP resume uploads are allowed.",
        );
        return;
      }

      if (objectStorageService.isBlobBackend() && size > MAX_VERCEL_UPLOAD_BYTES) {
        Errors.badRequest(
          res,
          `Uploads must be ${Math.floor(MAX_VERCEL_UPLOAD_BYTES / 1_000_000)}MB or smaller on Vercel Blob server uploads`,
        );
        return;
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      await objectStorageService.trySetObjectEntityAclPolicy(uploadURL, {
        owner: String(userId),
        visibility: "private",
      }).catch((err) => {
        console.warn("Could not set ACL on upload (object may not exist yet):", err.message);
      });

      res.json({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType, ownerId: userId, companyId },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      Errors.internal(res, "Failed to generate upload URL");
    }
  }
);

/**
 * POST /storage/uploads/confirm
 *
 * Called after a file upload completes, to write final ACL metadata.
 */
router.post(
  "/storage/uploads/confirm",
  requireAuth,
  validate(ConfirmUploadSchema),
  async (req: Request, res: Response) => {
    try {
      const { objectPath } = req.body;
      const { userId } = req.user!;

      await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
        owner: String(userId),
        visibility: "private",
      });

      res.json({ success: true, objectPath });
    } catch (error) {
      console.error("Error confirming upload:", error);
      Errors.internal(res, "Failed to confirm upload");
    }
  }
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets. No authentication required.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);

    if (!file) {
      Errors.notFound(res, "File not found");
      return;
    }

    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Error serving public object:", error);
    Errors.internal(res, "Failed to serve public object");
  }
});

/**
 * Helper: Find candidateId by matching cvUrl/objectPath
 * This allows us to align file access with candidate authorization.
 */
async function findCandidateByObjectPath(objectPath: string): Promise<number | null> {
  const [row] = await db
    .select({ id: candidatesTable.id })
    .from(candidatesTable)
    .where(eq(candidatesTable.cvUrl, objectPath))
    .limit(1);
  return row?.id ?? null;
}

/**
 * GET /storage/objects/*
 *
 * Serve private objects (e.g. CVs). Requires authentication + candidate-level authorization.
 *
 * Access rules (aligned with candidate authorization):
 * - admin → always allowed
 * - client → can access CV if they're authorized to view the candidate
 *           (candidate's role belongs to their company)
 * - vendor → can access CV if they're authorized to view the candidate
 *           (they submitted the candidate)
 * - others → 403 forbidden
 *
 * Implementation:
 * 1. Resolve objectPath → candidateId (by matching cvUrl in DB)
 * 2. Use candidate-level authorization (resolveCandidateAccess)
 * 3. Serve file if authorized
 */
router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Admin always has access
    if (req.user!.role === "admin") {
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
      } else {
        res.end();
      }
      return;
    }

    // For non-admins: resolve objectPath → candidateId and check candidate authorization
    const candidateId = await findCandidateByObjectPath(objectPath);
    if (!candidateId) {
      Errors.notFound(res, "File not found");
      return;
    }

    // Use candidate-level authorization
    const access = await resolveCandidateAccess(req, res, candidateId);
    if (!access) {
      // resolveCandidateAccess already sent the error response
      return;
    }

    // Authorization passed, fetch and serve the file
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      Errors.notFound(res, "Object not found");
      return;
    }
    console.error("Error serving object:", error);
    Errors.internal(res, "Failed to serve object");
  }
});

export default router;
