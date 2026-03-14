import { Router, type Request, type Response } from "express";
import { z } from "zod";

const router = Router();
const HealthCheckResponse = z.object({ status: z.string() });

router.get("/healthz", (_req: Request, res: Response) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
