import { isValidObjectId, type FilterQuery } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";
import { ExampleModel, type Example, type ExampleLean } from "./example.model.ts";
import type {
  CreateExampleInput,
  ListExamplesQuery,
  UpdateExampleInput,
} from "./example.validation.ts";

/**
 * The SERVICE layer holds the business logic and is the ONLY place that talks
 * to the model. It takes plain arguments and returns plain data — no `req`, no
 * `res`, no status codes leaking in. That is what makes it callable from a CLI
 * script, a cron job, or a test without spinning up Express.
 *
 * It signals failure by throwing HttpError; the error middleware turns that
 * into a response.
 */

/** The public API shape: `id` instead of `_id`, nothing Mongo-specific. */
export type ExampleJSON = Omit<Example, never> & { id: string };

export type PagedExamples = {
  items: ExampleJSON[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};

function serialize(doc: ExampleLean): ExampleJSON {
  const { _id, ...fields } = doc;
  return { id: _id.toString(), ...fields };
}

function assertValidId(id: string): void {
  // Without this, Mongo throws a CastError that surfaces as an ugly 500.
  if (!isValidObjectId(id)) throw new HttpError(400, `Invalid id: ${id}`);
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

export async function listExamples(query: ListExamplesQuery): Promise<PagedExamples> {
  const filter: FilterQuery<Example> = {};
  if (query.tag) filter.tags = query.tag;
  if (query.published !== undefined) filter.isPublished = query.published;
  if (query.search) filter.$text = { $search: query.search };

  // Two independent round trips — run them concurrently instead of awaiting in turn.
  const [docs, total] = await Promise.all([
    ExampleModel.find(filter)
      .sort(query.sort)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<ExampleLean[]>()
      .exec(),
    ExampleModel.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(serialize),
    total,
    page: query.page,
    limit: query.limit,
    pages: Math.ceil(total / query.limit),
  };
}

export async function getExampleById(id: string): Promise<ExampleJSON> {
  assertValidId(id);

  // `.lean()` skips hydrating a full mongoose document — noticeably faster and
  // all we need for a read that nobody is going to mutate.
  const doc = await ExampleModel.findById(id).lean<ExampleLean>().exec();
  if (!doc) throw new HttpError(404, `Example not found: ${id}`);

  return serialize(doc);
}

export async function createExample(input: CreateExampleInput): Promise<ExampleJSON> {
  try {
    const doc = await ExampleModel.create(input);
    return serialize(doc.toObject<ExampleLean>());
  } catch (err) {
    if (isDuplicateKey(err)) throw new HttpError(409, `Slug already in use: ${input.slug}`);
    throw err;
  }
}

export async function updateExample(id: string, input: UpdateExampleInput): Promise<ExampleJSON> {
  assertValidId(id);

  try {
    const doc = await ExampleModel.findByIdAndUpdate(
      id,
      { $set: input },
      // `new` returns the document AFTER the write; `runValidators` re-applies
      // the schema rules, which update queries skip by default.
      { new: true, runValidators: true },
    )
      .lean<ExampleLean>()
      .exec();

    if (!doc) throw new HttpError(404, `Example not found: ${id}`);
    return serialize(doc);
  } catch (err) {
    if (isDuplicateKey(err)) throw new HttpError(409, `Slug already in use: ${input.slug}`);
    throw err;
  }
}

export async function deleteExample(id: string): Promise<void> {
  assertValidId(id);

  const doc = await ExampleModel.findByIdAndDelete(id).lean<ExampleLean>().exec();
  if (!doc) throw new HttpError(404, `Example not found: ${id}`);
}
