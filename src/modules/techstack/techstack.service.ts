import { type QueryFilter } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";
import {
  TechstackModel,
  type Techstack,
  type TechstackLean,
  type TechstackJSON,
} from "./techstack.model.ts";
import { assertValidId } from "../../shared/utils/assertValidId.ts";
import { isDuplicateKey } from "../../shared/utils/parse.ts";
import { type PageResult } from "../../shared/utils/PageResult.ts";
import type {
  CreateTechstackBody,
  ListTechstacksQuery,
  UpdateTechstackBody,
} from "./techstack.validation.ts";

export type PagedTechstacks = PageResult<TechstackJSON>;

function serialize(doc: TechstackLean): TechstackJSON {
  const { _id, ...fields } = doc;
  return { id: _id.toString(), ...fields };
}

// ==================================

export async function listTechstacks(
  query: ListTechstacksQuery,
): Promise<PagedTechstacks> {
  const { page, limit, sort } = query;

  const filter: QueryFilter<Techstack> = {};
  if (query.search) {
    // Anchored, so the {name:1} unique index can still serve the prefix.
    filter.name = { $regex: `^${escapeRegex(query.search)}`, $options: "i" };
  }

  const [docs, total] = await Promise.all([
    TechstackModel.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<TechstackLean[]>()
      .exec(),
    TechstackModel.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(serialize),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

/** A user-supplied search term is not a pattern. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getTechstackById(id: string): Promise<TechstackJSON> {
  assertValidId(id);

  const doc = await TechstackModel.findById(id).lean<TechstackLean>().exec();
  if (!doc) throw new HttpError(404, `${TechstackModel.modelName} not found: ${id}`);

  return serialize(doc);
}

export async function createTechstack(
  input: CreateTechstackBody,
): Promise<TechstackJSON> {
  try {
    const doc = await TechstackModel.create(input);
    return serialize(doc.toObject<TechstackLean>());
  } catch (err) {
    // `name` is unique. Without this the E11000 misses the instanceof check in
    // the error handler and surfaces as a 500.
    if (isDuplicateKey(err)) {
      throw new HttpError(409, `Tech stack already exists: ${input.name}`);
    }
    throw err;
  }
}

export async function updateTechstack(
  id: string,
  input: UpdateTechstackBody,
): Promise<TechstackJSON> {
  assertValidId(id);

  try {
    const doc = await TechstackModel.findByIdAndUpdate(
      id,
      { $set: input },
      { new: true, runValidators: true },
    )
      .lean<TechstackLean>()
      .exec();

    if (!doc) throw new HttpError(404, `${TechstackModel.modelName} not found: ${id}`);
    return serialize(doc);
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new HttpError(409, `Tech stack already exists: ${input.name}`);
    }
    throw err;
  }
}

export async function deleteTechstack(id: string): Promise<void> {
  assertValidId(id);
  const doc = await TechstackModel.findByIdAndDelete(id).lean<TechstackLean>().exec();
  if (!doc) throw new HttpError(404, `${TechstackModel.modelName} not found: ${id}`);
}
