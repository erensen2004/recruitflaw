import type { Storage, File } from "@google-cloud/storage";
import { get as getBlob, head as headBlob, put as putBlob } from "@vercel/blob";
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
const VERCEL_BLOB_BACKEND = "vercel-blob";

async function createReplitStorageClient(): Promise<Storage> {
  const { Storage } = await import("@google-cloud/storage");
  return new Storage({
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
}

let replitStorageClientPromise: Promise<Storage> | null = null;

async function getReplitStorageClient(): Promise<Storage> {
  replitStorageClientPromise ??= createReplitStorageClient();
  return replitStorageClientPromise;
}

type StoredObject = File | LocalStoredObject | BlobStoredObject;

interface LocalStoredObject {
  kind: "local";
  filePath: string;
  metadataPath: string;
}

interface BlobStoredObject {
  kind: "blob";
  pathname: string;
  url: string;
  contentType?: string | null;
  size?: number | null;
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

  private getEnv(name: string): string {
    return process.env[name]?.trim() || "";
  }

  isLocalBackend(): boolean {
    return this.getEnv("STORAGE_BACKEND") === LOCAL_STORAGE_BACKEND;
  }

  isBlobBackend(): boolean {
    const storageBackend = this.getEnv("STORAGE_BACKEND");
    const blobToken = this.getEnv("BLOB_READ_WRITE_TOKEN");
    return (
      storageBackend === VERCEL_BLOB_BACKEND ||
      (!storageBackend && Boolean(blobToken))
    );
  }

  getLocalStorageRoot(): string {
    return this.getEnv("LOCAL_STORAGE_DIR") || path.resolve(process.cwd(), ".local-storage");
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

    if (this.isBlobBackend()) {
      const normalizedFilePath = filePath.replace(/^\/+/, "");
      const prefixes = this.getBlobPublicPrefixes();

      for (const prefix of prefixes) {
        const pathname = prefix ? `${prefix}/${normalizedFilePath}` : normalizedFilePath;
        const object = await this.getBlobObject(pathname).catch((error) => {
          if (isBlobNotFoundError(error)) {
            return null;
          }
          throw error;
        });

        if (object) {
          return object;
        }
      }

      return null;
    }

    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const storageClient = await getReplitStorageClient();
      const bucket = storageClient.bucket(bucketName);
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

    if (isBlobStoredObject(file)) {
      const response = await getBlob(file.pathname, {
        access: "private",
        token: this.getBlobToken(),
      });

      if (!response) {
        throw new ObjectNotFoundError();
      }

      const headers: Record<string, string> = {
        "Content-Type": file.contentType || response.blob.contentType || "application/octet-stream",
        "Cache-Control": `private, max-age=${cacheTtlSec}`,
      };

      const contentLength = response.headers.get("content-length") || (file.size ? String(file.size) : null);
      if (contentLength) {
        headers["Content-Length"] = contentLength;
      }

      return new Response(response.stream as ReadableStream, { headers });
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

    if (this.isBlobBackend()) {
      const objectId = randomUUID();
      return `/api/storage/uploads/blob/${objectId}`;
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

    if (this.isBlobBackend()) {
      const pathname = this.getBlobPathFromObjectPath(objectPath);
      return this.getBlobObject(pathname);
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
    const storageClient = await getReplitStorageClient();
    const bucket = storageClient.bucket(bucketName);
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

    if (this.isBlobBackend()) {
      const blobPrefix = "/api/storage/uploads/blob/";
      if (rawPath.startsWith(blobPrefix)) {
        return `/objects/uploads/${rawPath.slice(blobPrefix.length)}`;
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

    if (this.isBlobBackend()) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    if (isLocalStoredObject(objectFile)) {
      const metadata = await this.readLocalObjectMetadata(objectFile.metadataPath);
      metadata.aclPolicy = aclPolicy;
      await this.writeLocalObjectMetadata(objectFile.metadataPath, metadata);
      return normalizedPath;
    }

    if (isBlobStoredObject(objectFile)) {
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

  async writeBlobUploadedObject(
    objectPath: string,
    fileBuffer: Buffer,
    contentType?: string
  ): Promise<void> {
    const pathname = this.getBlobPathFromObjectPath(objectPath);
    await putBlob(pathname, fileBuffer, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: contentType || "application/octet-stream",
      token: this.getBlobToken(),
    });
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

    if (isBlobStoredObject(objectFile)) {
      return Boolean(userId) && (requestedPermission ?? ObjectPermission.READ) === ObjectPermission.READ;
    }

    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = this.getEnv("PUBLIC_OBJECT_SEARCH_PATHS");
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

  getBlobPublicPrefixes(): Array<string> {
    const pathsStr = this.getEnv("PUBLIC_OBJECT_SEARCH_PATHS");
    return Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((currentPath) => currentPath.trim().replace(/^\/+|\/+$/g, ""))
          .filter(Boolean)
      )
    );
  }

  getPrivateObjectDir(): string {
    const dir = this.getEnv("PRIVATE_OBJECT_DIR");
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

  private getBlobToken(): string {
    const token = this.getEnv("BLOB_READ_WRITE_TOKEN");
    if (!token) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN not set. Connect a Vercel Blob store and expose the token.",
      );
    }
    return token;
  }

  private getBlobPathFromObjectPath(objectPath: string): string {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const pathname = objectPath.slice("/objects/".length).replace(/^\/+/, "");
    if (!pathname) {
      throw new ObjectNotFoundError();
    }
    return pathname;
  }

  private async getBlobObject(pathname: string): Promise<BlobStoredObject> {
    try {
      const metadata = await headBlob(pathname, { token: this.getBlobToken() });
      return {
        kind: "blob",
        pathname,
        url: metadata.url,
        contentType: metadata.contentType ?? null,
        size: metadata.size ?? null,
      };
    } catch (error) {
      if (isBlobNotFoundError(error)) {
        throw new ObjectNotFoundError();
      }
      throw error;
    }
  }
}

function isLocalStoredObject(file: StoredObject): file is LocalStoredObject {
  return "kind" in file && file.kind === "local";
}

function isBlobStoredObject(file: StoredObject): file is BlobStoredObject {
  return "kind" in file && file.kind === "blob";
}

function isBlobNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as { status?: number; message?: string; code?: string };
  return (
    candidate.status === 404 ||
    candidate.code === "not_found" ||
    /not found|does not exist|requested blob does not exist/i.test(candidate.message || "")
  );
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
