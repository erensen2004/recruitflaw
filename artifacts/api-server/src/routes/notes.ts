import { Router } from "express";
import { db, candidateNotesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole, resolveCandidateAccess } from "../lib/authz.js";
import { validate } from "../middlewares/validate.js";
import { CreateNoteSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const router = Router({ mergeParams: true });

router.get("/", requireAuth, requireRole("admin", "client"), async (req, res) => {
  try {
    const candidateId = Number(req.params.id);

    const access = await resolveCandidateAccess(req, res, candidateId);
    if (!access) return;

    const notes = await db
      .select()
      .from(candidateNotesTable)
      .where(eq(candidateNotesTable.candidateId, candidateId))
      .orderBy(candidateNotesTable.createdAt);

    res.json(
      notes.map((n) => ({
        id: n.id,
        candidateId: n.candidateId,
        userId: n.userId,
        authorName: n.authorName,
        content: n.content,
        createdAt: n.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    console.error(err);
    Errors.internal(res);
  }
});

router.post(
  "/",
  requireAuth,
  requireRole("admin", "client"),
  validate(CreateNoteSchema),
  async (req, res) => {
    try {
      const candidateId = Number(req.params.id);
      const { content } = req.body;

      const access = await resolveCandidateAccess(req, res, candidateId);
      if (!access) return;

      const userId = req.user!.userId;
      const [userRow] = await db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, userId));

      const authorName = userRow?.name ?? "Unknown";

      const [note] = await db
        .insert(candidateNotesTable)
        .values({ candidateId, userId, authorName, content: content.trim() })
        .returning();

      res.status(201).json({
        id: note.id,
        candidateId: note.candidateId,
        userId: note.userId,
        authorName: note.authorName,
        content: note.content,
        createdAt: note.createdAt.toISOString(),
      });
    } catch (err) {
      console.error(err);
      Errors.internal(res);
    }
  }
);

export default router;
