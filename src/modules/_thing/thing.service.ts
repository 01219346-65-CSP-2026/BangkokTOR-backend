import { type FilterQuery } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";
import { ThingModel, type Thing, type ThingLean, type CreateThingInput, type UpdateThingInput, type ThingJSON } from "./thing.model.ts";
import { assertValidId } from "../../shared/utils/assertValidId.ts";
import { type PageResult } from "../../shared/utils/PageResult.ts";
import { type ListQuery } from "../../shared/utils/ListQuery.ts";


// I just copied pagination from the example template;

type ThingSortField = "";
export type PagedThings = PageResult<ThingJSON>;
export type ListThingsQuery = ListQuery<ThingSortField> & {
  //title?: string;
};

function serialize(doc: ThingLean): ThingJSON {
  const { _id, ...fields } = doc;
  return { id: _id.toString(), ...fields };
}

// ==================================

export async function listThings(query: ListThingsQuery): Promise<PagedThings> {
  const filter: FilterQuery<Thing> = {};
  // add query to filter here

  const [docs, total] = await Promise.all([
    ThingModel.find(filter)
      .sort(query.sort)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<ThingLean[]>()
      .exec(),
    ThingModel.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(serialize),
    total,
    page: query.page,
    limit: query.limit,
    pages: Math.ceil(total / query.limit),
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
