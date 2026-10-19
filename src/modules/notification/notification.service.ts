import { type QueryFilter } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";
import {
  NotificationModel,
  type Notification,
  type NotificationLean,
  type NotificationJSON,
} from "./notification.model.ts";
import { assertValidId } from "../../shared/utils/assertValidId.ts";
import { type PageResult } from "../../shared/utils/PageResult.ts";
import { isDuplicateKey } from "../../shared/utils/parse.ts";
import type {
  CreateNotificationBody,
  ListNotificationsQuery,
  UpdateNotificationBody,
} from "./notification.validation.ts";


export type PagedNotifications = PageResult<NotificationJSON>;

function serialize(doc: NotificationLean): NotificationJSON {
  const { _id, ...fields } = doc;
  return { id: _id.toString(), ...fields };
}

// ==================================

export async function listNotifications(query: ListNotificationsQuery): Promise<PagedNotifications> {
  const { page, limit, sort } = query;

  const filter: QueryFilter<Notification> = {};
  // add query filter fields to filter here
  if (query.user_id) {
    assertValidId(query.user_id);
    filter.user_id = query.user_id;
  }
  if (query.tor_id) {
    assertValidId(query.tor_id);
    filter.tor_id = query.tor_id;
  }
  if (query.is_read !== undefined) filter.is_read = query.is_read;

  const [docs, total] = await Promise.all([
    NotificationModel.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<NotificationLean[]>()
      .exec(),
    NotificationModel.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(serialize),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

export async function getNotificationById(id: string): Promise<NotificationJSON> {
  assertValidId(id);

  const doc = await NotificationModel.findById(id).lean<NotificationLean>().exec();
  if (!doc) throw new HttpError(404, `${NotificationModel.modelName} not found: ${id}`);

  return serialize(doc);
}

export async function createNotification(input: CreateNotificationBody): Promise<NotificationJSON> {
  try {
    const doc = await NotificationModel.create(input);
    return serialize(doc.toObject<NotificationLean>());
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new HttpError(409, "That notification already exists");
    }
    throw err;
  }
}

export async function updateNotification(id: string, input: UpdateNotificationBody): Promise<NotificationJSON> {
  assertValidId(id);
  try {
    const doc = await NotificationModel.findByIdAndUpdate(
      id,
      { $set: input },
      { new: true, runValidators: true },
    )
      .lean<NotificationLean>()
      .exec();

    if (!doc) throw new HttpError(404, `${NotificationModel.modelName} not found: ${id}`);
    return serialize(doc);
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new HttpError(409, "That notification already exists");
    }
    throw err;
  }
}

// ── The signed-in reader's own feed (/api/me/notifications). userId comes from
// requireUser, never the request, and every query filters on it (NFR-08).

/** Newest first. `limit` is clamped to 1–100 so a caller can't ask for everything. */
export async function listMyNotifications(userId: string, limit = 50): Promise<NotificationJSON[]> {
  const n = Math.min(100, Math.max(1, Math.trunc(limit) || 50));
  const docs = await NotificationModel.find({ user_id: userId })
    .sort({ created_at: -1 })
    .limit(n)
    .lean<NotificationLean[]>()
    .exec();
  return docs.map(serialize);
}

/**
 * Someone else's id answers 404, same as a missing one: a 403 would confirm
 * the id exists.
 */
export async function markMyNotificationRead(userId: string, id: string): Promise<NotificationJSON> {
  assertValidId(id);
  const doc = await NotificationModel.findOneAndUpdate(
    { _id: id, user_id: userId },
    { $set: { is_read: true } },
    { new: true },
  )
    .lean<NotificationLean>()
    .exec();
  if (!doc) throw new HttpError(404, `${NotificationModel.modelName} not found: ${id}`);
  return serialize(doc);
}

export async function deleteNotification(id: string): Promise<void> {
  assertValidId(id);
  const doc = await NotificationModel.findByIdAndDelete(id).lean<NotificationLean>().exec();
  if (!doc) throw new HttpError(404, `${NotificationModel.modelName} not found: ${id}`);
}
