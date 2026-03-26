import { Router } from "express";
import {
  db,
  reviewThreadsTable,
  reviewThreadMessagesTable,
  usersTable,
  companiesTable,
} from "@workspace/db";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole } from "../lib/authz.js";
import { validate } from "../middlewares/validate.js";
import {
  AddReviewThreadMessageSchema,
  CreateReviewThreadSchema,
  UpdateReviewThreadSchema,
} from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";
import {
  canSeeReviewVisibility,
  canActorAccessReviewScope,
  describeReviewScope,
  getReviewThreadStatusLabel,
  getReviewVisibilityLabel,
  normalizeReviewVisibility,
  normalizeReviewThreadStatus,
  resolveReviewActor,
  resolveReviewScope,
  type ReviewThreadVisibility,
} from "../lib/review-threads.js";

const router = Router();

function parseOptionalScopeQuery(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatMessage(message: {
  id: number;
  authorUserId: number;
  authorName: string;
  authorRole: string;
  authorCompanyId: number | null;
  message: string;
  createdAt: Date;
}) {
  return {
    id: message.id,
    authorUserId: message.authorUserId,
    authorName: message.authorName,
    authorRole: message.authorRole,
    authorCompanyId: message.authorCompanyId,
    message: message.message,
    createdAt: message.createdAt.toISOString(),
  };
}

async function formatThread(
  thread: typeof reviewThreadsTable.$inferSelect,
  scopeLabel: string,
  includeMessages = false,
) {
  const base = {
    id: thread.id,
    scopeType: thread.scopeType,
    scopeId: thread.scopeId,
    status: thread.status,
    visibility: thread.visibility,
    createdByUserId: thread.createdByUserId,
    createdByName: thread.createdByName,
    createdByRole: thread.createdByRole,
    createdByCompanyId: thread.createdByCompanyId,
    resolvedAt: thread.resolvedAt ? thread.resolvedAt.toISOString() : null,
    resolvedByUserId: thread.resolvedByUserId,
    resolvedByName: thread.resolvedByName,
    resolvedByRole: thread.resolvedByRole,
    statusLabel: getReviewThreadStatusLabel(thread.status),
    visibilityLabel: getReviewVisibilityLabel(thread.visibility as ReviewThreadVisibility, thread.scopeType),
    scopeLabel,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    lastMessageAt: thread.lastMessageAt.toISOString(),
  };

  const messageRows = includeMessages
    ? await db
        .select()
        .from(reviewThreadMessagesTable)
        .where(eq(reviewThreadMessagesTable.threadId, thread.id))
        .orderBy(reviewThreadMessagesTable.createdAt)
    : [];

  return {
    ...base,
    messages: includeMessages ? messageRows.map(formatMessage) : undefined,
  };
}

async function getThreadMessageCountMap(threadIds: number[]) {
  if (!threadIds.length) return new Map<number, number>();

  const counts = await db
    .select({
      threadId: reviewThreadMessagesTable.threadId,
      count: count(),
    })
    .from(reviewThreadMessagesTable)
    .where(inArray(reviewThreadMessagesTable.threadId, threadIds))
    .groupBy(reviewThreadMessagesTable.threadId);

  return new Map(counts.map((row) => [row.threadId, Number(row.count)]));
}

async function getReviewThreadById(threadId: number) {
  const [thread] = await db
    .select()
    .from(reviewThreadsTable)
    .where(eq(reviewThreadsTable.id, threadId));

  return thread ?? null;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const scopeType = typeof req.query.scopeType === "string" ? req.query.scopeType : undefined;
    const scopeId = parseOptionalScopeQuery(req.query.scopeId);
    const visibilityFilter = typeof req.query.visibility === "string" ? req.query.visibility : undefined;

    if (scopeType && scopeId == null) {
      Errors.badRequest(res, "scopeId must be a positive integer when scopeType is provided");
      return;
    }

    const actor = await resolveReviewActor(req.user!.userId);
    if (!actor) {
      Errors.unauthorized(res);
      return;
    }

    if (scopeType && scopeId != null) {
      const scope = await resolveReviewScope(req, res, scopeType, scopeId);
      if (!scope) return;

      const threads = await db
        .select()
        .from(reviewThreadsTable)
        .where(
          and(
            eq(reviewThreadsTable.scopeType, scope.scopeType),
            eq(reviewThreadsTable.scopeId, scope.scopeId),
          ),
        )
        .orderBy(desc(reviewThreadsTable.lastMessageAt));

      const visibleThreads = threads.filter((thread) => {
        if (visibilityFilter && thread.visibility !== visibilityFilter) return false;
        return canSeeReviewVisibility(actor.role, thread.visibility as ReviewThreadVisibility);
      });

      const results = await Promise.all(
        visibleThreads.map(async (thread) => {
          const scopeLabel = scope.label;
          return formatThread(thread, scopeLabel, true);
        }),
      );
      res.json({ scope, items: results });
      return;
    }

    const threads = await db
      .select()
      .from(reviewThreadsTable)
      .orderBy(desc(reviewThreadsTable.lastMessageAt))
      .limit(100);

    const filteredThreads = [];
    for (const thread of threads) {
      if (visibilityFilter && thread.visibility !== visibilityFilter) continue;
      if (!canSeeReviewVisibility(actor.role, thread.visibility as ReviewThreadVisibility)) continue;

      const scope = await describeReviewScope(thread.scopeType, thread.scopeId);
      if (!scope) continue;
      if (!canActorAccessReviewScope(actor, scope)) continue;
      filteredThreads.push({ thread, scope });
    }

    const messageCountMap = await getThreadMessageCountMap(filteredThreads.map(({ thread }) => thread.id));
    res.json({
      items: filteredThreads.map(({ thread, scope }) => ({
        id: thread.id,
        scopeType: thread.scopeType,
        scopeId: thread.scopeId,
        status: thread.status,
        visibility: thread.visibility,
        createdByUserId: thread.createdByUserId,
        createdByName: thread.createdByName,
        createdByRole: thread.createdByRole,
        createdByCompanyId: thread.createdByCompanyId,
        resolvedAt: thread.resolvedAt ? thread.resolvedAt.toISOString() : null,
        resolvedByUserId: thread.resolvedByUserId,
        resolvedByName: thread.resolvedByName,
        resolvedByRole: thread.resolvedByRole,
        statusLabel: getReviewThreadStatusLabel(thread.status),
        visibilityLabel: getReviewVisibilityLabel(thread.visibility as ReviewThreadVisibility, thread.scopeType),
        scopeLabel: scope.label,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
        lastMessageAt: thread.lastMessageAt.toISOString(),
        messageCount: messageCountMap.get(thread.id) ?? 0,
      })),
    });
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.post(
  "/",
  requireAuth,
  requireRole("admin", "client", "vendor"),
  validate(CreateReviewThreadSchema),
  async (req, res) => {
    try {
      const actor = await resolveReviewActor(req.user!.userId);
      if (!actor) {
        Errors.unauthorized(res);
        return;
      }

      const { scopeType, scopeId, message } = req.body;
      const scope = await resolveReviewScope(req, res, scopeType, scopeId);
      if (!scope) return;

      const visibility = normalizeReviewVisibility(req.body.visibility, actor.role);
      if (!canSeeReviewVisibility(actor.role, visibility)) {
        Errors.forbidden(res, "Visibility is not allowed for this role");
        return;
      }

      const [userRow] = await db
        .select({
          name: usersTable.name,
          role: usersTable.role,
          companyId: usersTable.companyId,
          companyName: companiesTable.name,
        })
        .from(usersTable)
        .leftJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
        .where(eq(usersTable.id, req.user!.userId));

      const authorName = userRow?.companyName ?? userRow?.name ?? (actor.role === "admin" ? "Admin team" : "Review team");
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const [existingThread] = await tx
          .select()
          .from(reviewThreadsTable)
          .where(
            and(
              eq(reviewThreadsTable.scopeType, scopeType),
              eq(reviewThreadsTable.scopeId, scopeId),
              eq(reviewThreadsTable.visibility, visibility),
            ),
          );

        const thread =
          existingThread ??
          (await tx
            .insert(reviewThreadsTable)
            .values({
              scopeType,
              scopeId,
              visibility,
              status: "open",
              createdByUserId: req.user!.userId,
              createdByName: authorName,
              createdByRole: actor.role,
              createdByCompanyId: actor.companyId,
              lastMessageAt: now,
              updatedAt: now,
            })
            .returning()
            .then((rows) => rows[0]));

        if (!thread) {
          throw new Error("Thread could not be created");
        }

        const [createdMessage] = await tx
          .insert(reviewThreadMessagesTable)
          .values({
            threadId: thread.id,
            authorUserId: req.user!.userId,
            authorName,
            authorRole: actor.role,
            authorCompanyId: actor.companyId,
            message: message.trim(),
          })
          .returning();

        await tx
          .update(reviewThreadsTable)
          .set({
            status: "open",
            resolvedAt: null,
            resolvedByUserId: null,
            resolvedByName: null,
            resolvedByRole: null,
            lastMessageAt: createdMessage.createdAt,
            updatedAt: createdMessage.createdAt,
          })
          .where(eq(reviewThreadsTable.id, thread.id));

        return { thread, createdMessage, created: existingThread == null };
      });

      const updatedThread = await getReviewThreadById(result.thread.id);
      if (!updatedThread) {
        Errors.internal(res);
        return;
      }

      res.status(result.created ? 201 : 200).json(await formatThread(updatedThread, scope.label, true));
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  },
);

router.get("/workload", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const threads = await db
      .select({
        total: count(),
      })
      .from(reviewThreadsTable);

    const threadMessages = await db
      .select({
        total: count(),
      })
      .from(reviewThreadMessagesTable);

    const visibilityRows = await db
      .select({
        visibility: reviewThreadsTable.visibility,
        count: count(),
      })
      .from(reviewThreadsTable)
      .groupBy(reviewThreadsTable.visibility);

    const statusRows = await db
      .select({
        status: reviewThreadsTable.status,
        count: count(),
      })
      .from(reviewThreadsTable)
      .groupBy(reviewThreadsTable.status);

    const scopeRows = await db
      .select({
        scopeType: reviewThreadsTable.scopeType,
        count: count(),
      })
      .from(reviewThreadsTable)
      .groupBy(reviewThreadsTable.scopeType);

    res.json({
      totalThreads: Number(threads[0]?.total ?? 0),
      totalMessages: Number(threadMessages[0]?.total ?? 0),
      byVisibility: visibilityRows.map((row) => ({
        visibility: row.visibility,
        count: Number(row.count),
      })),
      byStatus: statusRows.map((row) => ({
        status: row.status,
        count: Number(row.count),
      })),
      byScopeType: scopeRows.map((row) => ({
        scopeType: row.scopeType,
        count: Number(row.count),
      })),
    });
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const threadId = Number(req.params.id);
    if (!Number.isInteger(threadId) || threadId <= 0) {
      Errors.badRequest(res, "Invalid thread id");
      return;
    }

    const [thread] = await db
      .select()
      .from(reviewThreadsTable)
      .where(eq(reviewThreadsTable.id, threadId));

    if (!thread) {
      Errors.notFound(res, "Thread not found");
      return;
    }

    const scope = await resolveReviewScope(req, res, thread.scopeType, thread.scopeId);
    if (!scope) return;

    const actor = await resolveReviewActor(req.user!.userId);
    if (!actor) {
      Errors.unauthorized(res);
      return;
    }

    if (!canSeeReviewVisibility(actor.role, thread.visibility as ReviewThreadVisibility)) {
      Errors.notFound(res, "Thread not found");
      return;
    }

    const messages = await db
      .select()
      .from(reviewThreadMessagesTable)
      .where(eq(reviewThreadMessagesTable.threadId, thread.id))
      .orderBy(reviewThreadMessagesTable.createdAt);

    res.json({
      ...await formatThread(thread, scope.label, false),
      scope,
      messages: messages.map(formatMessage),
    });
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.post(
  "/:id/messages",
  requireAuth,
  requireRole("admin", "client", "vendor"),
  validate(AddReviewThreadMessageSchema),
  async (req, res) => {
    try {
      const threadId = Number(req.params.id);
      if (!Number.isInteger(threadId) || threadId <= 0) {
        Errors.badRequest(res, "Invalid thread id");
        return;
      }

      const [thread] = await db
        .select()
        .from(reviewThreadsTable)
        .where(eq(reviewThreadsTable.id, threadId));

      if (!thread) {
        Errors.notFound(res, "Thread not found");
        return;
      }

      const scope = await resolveReviewScope(req, res, thread.scopeType, thread.scopeId);
      if (!scope) return;

      const actor = await resolveReviewActor(req.user!.userId);
      if (!actor) {
        Errors.unauthorized(res);
        return;
      }

      if (!canSeeReviewVisibility(actor.role, thread.visibility as ReviewThreadVisibility)) {
        Errors.notFound(res, "Thread not found");
        return;
      }

      const message = req.body.message.trim();
      const now = new Date();

      const [createdMessage] = await db
        .insert(reviewThreadMessagesTable)
        .values({
          threadId: thread.id,
          authorUserId: req.user!.userId,
          authorName: actor.companyName ?? actor.name,
          authorRole: actor.role,
          authorCompanyId: actor.companyId,
          message,
        })
        .returning();

      await db
        .update(reviewThreadsTable)
        .set({
          status: "open",
          resolvedAt: null,
          resolvedByUserId: null,
          resolvedByName: null,
          resolvedByRole: null,
          lastMessageAt: now,
          updatedAt: now,
        })
        .where(eq(reviewThreadsTable.id, thread.id));

      const updatedThread = await getReviewThreadById(thread.id);
      if (!updatedThread) {
        Errors.internal(res);
        return;
      }

      res.status(201).json({
        ...(await formatThread(updatedThread, scope.label, false)),
        scope,
        message: formatMessage(createdMessage),
      });
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  },
);

router.patch(
  "/:id",
  requireAuth,
  requireRole("admin", "client", "vendor"),
  validate(UpdateReviewThreadSchema),
  async (req, res) => {
    try {
      const threadId = Number(req.params.id);
      if (!Number.isInteger(threadId) || threadId <= 0) {
        Errors.badRequest(res, "Invalid thread id");
        return;
      }

      const [thread] = await db
        .select()
        .from(reviewThreadsTable)
        .where(eq(reviewThreadsTable.id, threadId));

      if (!thread) {
        Errors.notFound(res, "Thread not found");
        return;
      }

      const scope = await resolveReviewScope(req, res, thread.scopeType, thread.scopeId);
      if (!scope) return;

      const actor = await resolveReviewActor(req.user!.userId);
      if (!actor) {
        Errors.unauthorized(res);
        return;
      }

      if (!canSeeReviewVisibility(actor.role, thread.visibility as ReviewThreadVisibility)) {
        Errors.notFound(res, "Thread not found");
        return;
      }

      const nextStatus = normalizeReviewThreadStatus(req.body.status);
      const now = new Date();

      await db
        .update(reviewThreadsTable)
        .set(
          nextStatus === "resolved"
            ? {
                status: nextStatus,
                resolvedAt: now,
                resolvedByUserId: req.user!.userId,
                resolvedByName: actor.companyName ?? actor.name,
                resolvedByRole: actor.role,
                updatedAt: now,
              }
            : {
                status: nextStatus,
                resolvedAt: null,
                resolvedByUserId: null,
                resolvedByName: null,
                resolvedByRole: null,
                updatedAt: now,
              },
        )
        .where(eq(reviewThreadsTable.id, thread.id));

      const [updatedThread] = await db
        .select()
        .from(reviewThreadsTable)
        .where(eq(reviewThreadsTable.id, thread.id));

      if (!updatedThread) {
        Errors.internal(res);
        return;
      }

      res.json(await formatThread(updatedThread, scope.label, true));
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  },
);

export default router;
