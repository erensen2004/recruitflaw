import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import auth from "./auth.js";
import companies from "./companies.js";
import users from "./users.js";
import roles from "./roles.js";
import candidates from "./candidates.js";
import contracts from "./contracts.js";
import timesheets from "./timesheets.js";
import storageRouter from "./storage.js";
import notesRouter from "./notes.js";
import analyticsRouter from "./analytics.js";
import cvParseRouter from "./cv-parse.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", auth);
router.use("/companies", companies);
router.use("/users", users);
router.use("/roles", roles);
router.use("/candidates", candidates);
router.use("/candidates/:id/notes", notesRouter);
router.use("/contracts", contracts);
router.use("/timesheets", timesheets);
router.use("/analytics", analyticsRouter);
router.use("/cv-parse", cvParseRouter);
router.use(storageRouter);

export default router;
