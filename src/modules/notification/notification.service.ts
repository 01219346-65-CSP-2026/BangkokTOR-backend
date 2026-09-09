import { type FilterQuery } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";
import { NotificationModel, type Notification, type NotificationLean, type CreateNotificationInput, type UpdateNotificationInput, type NotificationJSON } from "./notification.model.ts";
import { assertValidId } from "../../shared/utils/assertValidId.ts";
import { type PageResult } from "../../shared/utils/PageResult.ts";
import { type ListQuery } from "../../shared/utils/ListQuery.ts";


type NotificationSortField = "";
export type PagedNotifications = PageResult<NotificationJSON>;
export type ListNotificationsQuery = ListQuery<NotificationSortField> & {
};

function serialize(doc: NotificationLean): NotificationJSON {
  const { _id, ...fields } = doc;
  return { id: _id.toString(), ...fields };
}

// ==================================

export async function listNotifications(query: ListNotificationsQuery): Promise<PagedNotifications> {
  const filter: FilterQuery<Notification> = {};
  // add query to filter here

  const [docs, total] = await Promise.all([
    NotificationModel.find(filter)
      .sort(query.sort)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<NotificationLean[]>()
      .exec(),
    NotificationModel.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(serialize),
    total,
    page: query.page,
    limit: query.limit,
    pages: Math.ceil(total / query.limit),
  };
}

export async function getNotificationById(id: string): Promise<NotificationJSON> {
  assertValidId(id);

  const doc = await NotificationModel.findById(id).lean<NotificationLean>().exec();
  if (!doc) throw new HttpError(404, `${NotificationModel.modelName} not found: ${id}`);

  return serialize(doc);
}

export async function createNotification(input: CreateNotificationInput): Promise<NotificationJSON> {
  try {
    const doc = await NotificationModel.create(input);
    return serialize(doc.toObject<NotificationLean>());
  } catch (err) {
    throw err;
  }
}

export async function updateNotification(id: string, input: UpdateNotificationInput): Promise<NotificationJSON> {
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
    throw err;
  }
}

export async function deleteNotification(id: string): Promise<void> {
  assertValidId(id);
  const doc = await NotificationModel.findByIdAndDelete(id).lean<NotificationLean>().exec();
  if (!doc) throw new HttpError(404, `${NotificationModel.modelName} not found: ${id}`);
}
