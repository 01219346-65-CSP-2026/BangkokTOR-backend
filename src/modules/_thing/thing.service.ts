import { type FilterQuery } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";
import { ThingModel, type Thing, type ThingLean, type CreateThingInput, type UpdateThingInput, type ThingJSON } from "./thing.model.ts";
import { assertValidId } from "../../shared/utils/assertValidId.ts";
import { type PageResult } from "../../shared/utils/PageResult.ts";
import { type ListQuery } from "../../shared/utils/ListQuery.ts";


type ThingSortField = "title"; // query sort fields
export type PagedThings = PageResult<ThingJSON>;
export type ListThingsQuery = ListQuery<ThingSortField> & {
  // query filter fields
  title?: string;
};

function serialize(doc: ThingLean): ThingJSON {
  const { _id, ...fields } = doc;
  return { id: _id.toString(), ...fields };
}

// ==================================

export async function listThings(query: ListThingsQuery): Promise<PagedThings> {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));

  const filter: FilterQuery<Thing> = {};
  // add query filter fields to filter here
  if (query.title) filter.title = query.title;

  const [docs, total] = await Promise.all([
    ThingModel.find(filter)
      .sort(query.sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<ThingLean[]>()
      .exec(),
    ThingModel.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(serialize),
    total,
    page: page,
    limit: limit,
    pages: Math.ceil(total / limit),
  };
}

export async function getThingById(id: string): Promise<ThingJSON> {
  assertValidId(id);

  const doc = await ThingModel.findById(id).lean<ThingLean>().exec();
  if (!doc) throw new HttpError(404, `${ThingModel.modelName} not found: ${id}`);

  return serialize(doc);
}

export async function createThing(input: CreateThingInput): Promise<ThingJSON> {
  try {
    const doc = await ThingModel.create(input);
    return serialize(doc.toObject<ThingLean>());
  } catch (err) {
    throw err;
  }
}

export async function updateThing(id: string, input: UpdateThingInput): Promise<ThingJSON> {
  assertValidId(id);
  try {
    const doc = await ThingModel.findByIdAndUpdate(
      id,
      { $set: input },
      { new: true, runValidators: true },
    )
      .lean<ThingLean>()
      .exec();

    if (!doc) throw new HttpError(404, `${ThingModel.modelName} not found: ${id}`);
    return serialize(doc);
  } catch (err) {
    throw err;
  }
}

export async function deleteThing(id: string): Promise<void> {
  assertValidId(id);
  const doc = await ThingModel.findByIdAndDelete(id).lean<ThingLean>().exec();
  if (!doc) throw new HttpError(404, `${ThingModel.modelName} not found: ${id}`);
}
