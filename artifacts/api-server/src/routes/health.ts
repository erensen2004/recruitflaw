import { Router, type RequestHandler } from "express";
import { HealthCheckResponse } from "../../../../lib/api-zod/src/generated/api.js";

const router = Router();

const healthHandler: RequestHandler = (_req: any, res: any) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
};

router.get("/healthz", healthHandler);

export default router;
