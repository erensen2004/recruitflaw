import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { Errors } from "../lib/errors.js";

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      Errors.validation(res, (result.error as ZodError).flatten());
      return;
    }
    req.body = result.data;
    next();
  };
}
