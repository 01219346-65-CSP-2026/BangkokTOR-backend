import { type FilterQuery } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";
import { TechstackModel, type Techstack, type TechstackLean, type CreateTechstackInput, type UpdateTechstackInput, type TechstackJSON } from "./techstack.model.ts";
import { assertValidId } from "../../shared/utils/assertValidId.ts";
import { type PageResult } from "../../shared/utils/PageResult.ts";
import { type ListQuery } from "../../shared/utils/ListQuery.ts";


type TechstackSortField = ""; // query sort fields
export type PagedTechstacks = PageResult<TechstackJSON>;
export type ListTechstacksQuery = ListQuery<TechstackSortField> & {
  // query filter fields
  user_id?: string,
  tor_id?: string
};

function serialize(doc: TechstackLean): TechstackJSON {
  const { _id, ...fields } = doc;
  return { id: _id.toString(), ...fields };
}

// ==================================

export async function listTechstacks(query: ListTechstacksQuery): Promise<PagedTechstacks> {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));

  const filter: FilterQuery<Techstack> = {};
  // add query filter fields to filter here
  if (query.user_id) {
    assertValidId(query.user_id);
    filter.user_id = query.user_id;
  }
  if (query.tor_id) {
    assertValidId(query.tor_id);
    filter.tor_id = query.tor_id;
  }

  const [docs, total] = await Promise.all([
    TechstackModel.find(filter)
      .sort(query.sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<TechstackLean[]>()
      .exec(),
    TechstackModel.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(serialize),
    total,
    page: page,
    limit: limit,
    pages: Math.ceil(total / limit),
  };
}

export async function getTechstackById(id: string): Promise<TechstackJSON> {
  assertValidId(id);

  const doc = await TechstackModel.findById(id).lean<TechstackLean>().exec();
  if (!doc) throw new HttpError(404, `${TechstackModel.modelName} not found: ${id}`);

  return serialize(doc);
}

export async function createTechstack(input: CreateTechstackInput): Promise<TechstackJSON> {
  try {
    const doc = await TechstackModel.create(input);
    return serialize(doc.toObject<TechstackLean>());
  } catch (err) {
    throw err;
  }
}

export async function updateTechstack(id: string, input: UpdateTechstackInput): Promise<TechstackJSON> {
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
    throw err;
  }
}

export async function deleteTechstack(id: string): Promise<void> {
  assertValidId(id);
  const doc = await TechstackModel.findByIdAndDelete(id).lean<TechstackLean>().exec();
  if (!doc) throw new HttpError(404, `${TechstackModel.modelName} not found: ${id}`);
}
