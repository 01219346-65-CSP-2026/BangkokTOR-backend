import { isValidObjectId } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";

 export function assertValidId(id: string): void {
  // Without this, Mongo throws a CastError that surfaces as an ugly 500.
  if (!isValidObjectId(id)) throw new HttpError(400, `Invalid object id: ${id}`);
}