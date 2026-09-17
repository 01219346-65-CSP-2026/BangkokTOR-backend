import { type QueryFilter } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";
import { UserModel, type User, type UserLean, type UserJSON } from "./user.model.ts";
import { assertValidId } from "../../shared/utils/assertValidId.ts";
import { isDuplicateKey } from "../../shared/utils/parse.ts";
import { type PageResult } from "../../shared/utils/PageResult.ts";
import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateUserBody,
} from "./user.validation.ts";

export type PagedUsers = PageResult<UserJSON>;

function serialize(doc: UserLean): UserJSON {
  const { _id, ...fields } = doc;
  return { id: _id.toString(), ...fields };
}

// ==================================

export async function listUsers(query: ListUsersQuery): Promise<PagedUsers> {
  const { page, limit, sort } = query;

  const filter: QueryFilter<User> = {};
  if (query.email) filter.email = query.email;
  if (query.role) filter.role = query.role;

  const [docs, total] = await Promise.all([
    UserModel.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<UserLean[]>()
      .exec(),
    UserModel.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(serialize),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

export async function getUserById(id: string): Promise<UserJSON> {
  assertValidId(id);

  const doc = await UserModel.findById(id).lean<UserLean>().exec();
  if (!doc) throw new HttpError(404, `${UserModel.modelName} not found: ${id}`);

  return serialize(doc);
}

export async function createUser(input: CreateUserBody): Promise<UserJSON> {
  try {
    const doc = await UserModel.create(input);
    return serialize(doc.toObject<UserLean>());
  } catch (err) {
    // `email` and `google_id` are both unique. Without this branch the E11000
    // misses the instanceof check in the error handler and a predictable
    // conflict surfaces as "Internal server error".
    if (isDuplicateKey(err)) {
      throw new HttpError(409, `That email or Google account is already registered`);
    }
    throw err;
  }
}

/**
 * Note what this CANNOT change: `role`.
 *
 * `input` is a validated UpdateUserBody, and that type has no `role` key —
 * see the note in user.validation.ts. Before that, `req.body` was spread
 * straight into `$set`, so a caller could promote themselves to admin.
 */
export async function updateUser(id: string, input: UpdateUserBody): Promise<UserJSON> {
  assertValidId(id);

  try {
    const doc = await UserModel.findByIdAndUpdate(
      id,
      { $set: input },
      { new: true, runValidators: true },
    )
      .lean<UserLean>()
      .exec();

    if (!doc) throw new HttpError(404, `${UserModel.modelName} not found: ${id}`);
    return serialize(doc);
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new HttpError(409, `That email is already registered`);
    }
    throw err;
  }
}

export async function deleteUser(id: string): Promise<void> {
  assertValidId(id);
  const doc = await UserModel.findByIdAndDelete(id).lean<UserLean>().exec();
  if (!doc) throw new HttpError(404, `${UserModel.modelName} not found: ${id}`);
}
