import { type FilterQuery } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";
import { TechstackModel, type Techstack, type TechstackLean, type CreateTechstackInput, type UpdateTechstackInput, type TechstackJSON } from "./techstack.model.ts";
import { assertValidId } from "../../shared/utils/assertValidId.ts";
import { type PageResult } from "../../shared/utils/PageResult.ts";
import { type ListQuery } from "../../shared/utils/ListQuery.ts";


type TechstackSortField = "";
export type PagedTechstacks = PageResult<TechstackJSON>;
export type ListTechstacksQuery = ListQuery<TechstackSortField> & {
};

function serialize(doc: TechstackLean): TechstackJSON {
  const { _id, ...fields } = doc;
  return { id: _id.toString(), ...fields };
}

// ==================================

export async function listTechstacks(query: ListTechstacksQuery): Promise<PagedTechstacks> {
  const filter: FilterQuery<Techstack> = {};
  // add query to filter here

  const [docs, total] = await Promise.all([
    TechstackModel.find(filter)
      .sort(query.sort)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<TechstackLean[]>()
      .exec(),
    TechstackModel.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(serialize),
    total,
    page: query.page,
    limit: query.limit,
    pages: Math.ceil(total / query.limit),
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
