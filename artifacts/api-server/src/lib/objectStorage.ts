import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import { mkdir, readFile, stat, writeFile, access } from "fs/promises";
import path from "path";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const LOCAL_STORAGE_BACKEND = "local";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

type StoredObject = File | LocalStoredObject;

interface LocalStoredObject {
  kind: "local";
  filePath: string;
  metadataPath: string;
}

interface LocalObjectMetadata {
  contentType?: string;
  aclPolicy?: ObjectAclPolicy;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  isLocalBackend(): boolean {
    return process.env.STORAGE_BACKEND === LOCAL_STORAGE_BACKEND;
  }

  getLocalStorageRoot(): string {
    return process.env.LOCAL_STORAGE_DIR || path.resolve(process.cwd(), ".local-storage");
  }

  async ensureLocalStorageRoot(): Promise<void> {
    await mkdir(this.getLocalStorageRoot(), { recursive: true });
  }

  private getLocalObjectPaths(objectPath: string): { filePath: string; metadataPath: string } {
    const relativePath = objectPath.replace(/^\/objects\//, "");
    const filePath = path.join(this.getLocalStorageRoot(), relativePath);
    const metadataPath = `${filePath}.metadata.json`;
    return { filePath, metadataPath };
  }

  async searchPublicObject(filePath: string): Promise<StoredObject | null> {
    if (this.isLocalBackend()) {
      const localPath = path.join(this.getLocalStorageRoot(), "public", filePath);
      const metadataPath = `${localPath}.metadata.json`;
      try {
        await access(localPath);
        return { kind: "local", filePath: localPath, metadataPath };
      } catch {
        return null;
      }
    }

    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: StoredObject, cacheTtlSec: number = 3600): Promise<Response> {
    if (isLocalStoredObject(file)) {
      const metadata = await this.readLocalObjectMetadata(file.metadataPath);
      const fileStats = await stat(file.filePath);
      const nodeStream = createReadStream(file.filePath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;
      const isPublic = metadata.aclPolicy?.visibility === "public";

      return new Response(webStream, {
        headers: {
          "Content-Type": metadata.contentType || "application/octet-stream",
          "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
          "Content-Length": String(fileStats.size),
        },
      });
    }

    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    if (this.isLocalBackend()) {
      await this.ensureLocalStorageRoot();
      const objectId = randomUUID();
      return `/api/storage/uploads/local/${objectId}`;
    }

    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObject> {
    if (this.isLocalBackend()) {
      const { filePath, metadataPath } = this.getLocalObjectPaths(objectPath);
      try {
        await access(filePath);
        return { kind: "local", filePath, metadataPath };
      } catch {
        throw new ObjectNotFoundError();
      }
    }

    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (this.isLocalBackend()) {
      const localPrefix = "/api/storage/uploads/local/";
      if (rawPath.startsWith(localPrefix)) {
        return `/objects/uploads/${rawPath.slice(localPrefix.length)}`;
      }
      return rawPath;
    }

    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    if (isLocalStoredObject(objectFile)) {
      const metadata = await this.readLocalObjectMetadata(objectFile.metadataPath);
      metadata.aclPolicy = aclPolicy;
      await this.writeLocalObjectMetadata(objectFile.metadataPath, metadata);
      return normalizedPath;
    }

    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async writeLocalUploadedObject(
    objectPath: string,
    fileBuffer: Buffer,
    contentType?: string
  ): Promise<void> {
    const { filePath, metadataPath } = this.getLocalObjectPaths(objectPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, fileBuffer);

    const metadata = await this.readLocalObjectMetadata(metadataPath);
    metadata.contentType = contentType || metadata.contentType || "application/octet-stream";
    await this.writeLocalObjectMetadata(metadataPath, metadata);
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StoredObject;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    if (isLocalStoredObject(objectFile)) {
      const metadata = await this.readLocalObjectMetadata(objectFile.metadataPath);
      const aclPolicy = metadata.aclPolicy;
      if (!aclPolicy) return false;
      if (aclPolicy.visibility === "public" && (requestedPermission ?? ObjectPermission.READ) === ObjectPermission.READ) {
        return true;
      }
      if (!userId) return false;
      return aclPolicy.owner === userId;
    }

    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((currentPath) => currentPath.trim())
          .filter((currentPath) => currentPath.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  private async readLocalObjectMetadata(metadataPath: string): Promise<LocalObjectMetadata> {
    try {
      const raw = await readFile(metadataPath, "utf-8");
      return JSON.parse(raw) as LocalObjectMetadata;
    } catch {
      return {};
    }
  }

  private async writeLocalObjectMetadata(metadataPath: string, metadata: LocalObjectMetadata): Promise<void> {
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await writeFile(metadataPath, JSON.stringify(metadata), "utf-8");
  }
}

function isLocalStoredObject(file: StoredObject): file is LocalStoredObject {
  return "kind" in file && file.kind === "local";
}

function parseObjectPath(currentPath: string): {
  bucketName: string;
  objectName: string;
} {
  if (!currentPath.startsWith("/")) {
    currentPath = `/${currentPath}`;
  }
  const pathParts = currentPath.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `message: ${await response.text()}`
    );
  }

  const responseData = (await response.json()) as { signed_url?: string };
  if (!responseData.signed_url) {
    throw new Error("Missing signed_url in sidecar response");
  }

  return responseData.signed_url;
}
