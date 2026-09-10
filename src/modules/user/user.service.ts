import { type FilterQuery } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";
import { UserModel, type User, type UserLean, type CreateUserInput, type UpdateUserInput, type UserJSON } from "./user.model.ts";
import { assertValidId } from "../../shared/utils/assertValidId.ts";
import { type PageResult } from "../../shared/utils/PageResult.ts";
import { type ListQuery } from "../../shared/utils/ListQuery.ts";


type UserSortField = ""; // query sort fields
export type PagedUsers = PageResult<UserJSON>;
export type ListUsersQuery = ListQuery<UserSortField> & {
  // query filter fields
};

function serialize(doc: UserLean): UserJSON {
  const { _id, ...fields } = doc;
  return { id: _id.toString(), ...fields };
}

// ==================================

export async function listUsers(query: ListUsersQuery): Promise<PagedUsers> {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));

  const filter: FilterQuery<User> = {};
  // add query filter fields to filter here

  const [docs, total] = await Promise.all([
    UserModel.find(filter)
      .sort(query.sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<UserLean[]>()
      .exec(),
    UserModel.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(serialize),
    total,
    page: page,
    limit: limit,
    pages: Math.ceil(total / limit),
  };
}

export async function getUserById(id: string): Promise<UserJSON> {
  assertValidId(id);

  const doc = await UserModel.findById(id).lean<UserLean>().exec();
  if (!doc) throw new HttpError(404, `${UserModel.modelName} not found: ${id}`);

  return serialize(doc);
}

export async function createUser(input: CreateUserInput): Promise<UserJSON> {
  try {
    const doc = await UserModel.create(input);
    return serialize(doc.toObject<UserLean>());
  } catch (err) {
    throw err;
  }
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<UserJSON> {
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
    throw err;
  }
}

export async function deleteUser(id: string): Promise<void> {
  assertValidId(id);
  const doc = await UserModel.findByIdAndDelete(id).lean<UserLean>().exec();
  if (!doc) throw new HttpError(404, `${UserModel.modelName} not found: ${id}`);
}
