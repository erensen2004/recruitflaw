import { ZodSchema, ZodError } from "zod";
import { Errors } from "../lib/errors.js";

export function validate(schema: ZodSchema) {
  return (req: any, res: any, next: any): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      Errors.validation(res, (result.error as ZodError).flatten());
      return;
    }
    req.body = result.data;
    next();
  };
}
