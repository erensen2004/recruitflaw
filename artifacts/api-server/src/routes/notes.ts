import { Router } from "express";
import { db, candidateNotesTable, usersTable, companiesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { requireRole, resolveCandidateAccess } from "../lib/authz.js";
import { validate } from "../middlewares/validate.js";
import { CreateNoteSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const router = Router({ mergeParams: true });

router.get("/", requireAuth, requireRole("admin", "client", "vendor"), async (req, res) => {
  try {
    const candidateId = Number(req.params.id);

    const access = await resolveCandidateAccess(req, res, candidateId);
    if (!access) return;

    const notes = await db
      .select()
      .from(candidateNotesTable)
      .where(eq(candidateNotesTable.candidateId, candidateId))
      .orderBy(desc(candidateNotesTable.createdAt));

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
        .select({ name: usersTable.name, role: usersTable.role, companyId: usersTable.companyId })
        .from(usersTable)
        .where(eq(usersTable.id, userId));

      let authorName = "Review team";
      if (userRow) {
        if (userRow.role === "admin") {
          authorName = "Admin team";
        } else if (userRow.companyId) {
          const [company] = await db
            .select({ name: companiesTable.name })
            .from(companiesTable)
            .where(eq(companiesTable.id, userRow.companyId));
          authorName = company?.name ?? (userRow.role === "client" ? "Client team" : "Vendor team");
        } else {
          authorName = userRow.role === "client" ? "Client team" : "Vendor team";
        }
      }

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
