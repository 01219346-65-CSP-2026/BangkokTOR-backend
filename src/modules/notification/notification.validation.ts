import {
  asObject,
  parsePageQuery,
  pruneUndefined,
  readBoolean,
  readDate,
  readObjectId,
  readString,
  required,
  requireSomething,
} from "../../shared/utils/parse.ts";

const SORT_FIELDS = ["created_at", "-created_at", "matched_at", "-matched_at"] as const;
export type NotificationSortField = (typeof SORT_FIELDS)[number];

export type CreateNotificationBody = {
  user_id: string;
  tor_id?: string;
  title: string;
  message?: string;
  matched_at?: Date;
};

/**
 * `user_id` is deliberately absent from the update shape.
 *
 * Reassigning a notification to a different user is not an edit, and letting a
 * PATCH body carry it is how a row ends up in someone else's feed.
 */
export type UpdateNotificationBody = {
  title?: string;
  message?: string;
  is_read?: boolean;
};

export type ListNotificationsQuery = {
  page: number;
  limit: number;
  sort: NotificationSortField;
  user_id?: string;
  tor_id?: string;
  is_read?: boolean;
};

export function parseCreateNotification(body: unknown): CreateNotificationBody {
  const src = asObject(body);
  return pruneUndefined({
    user_id: required(readObjectId(src, "user_id"), "user_id"),
    tor_id: readObjectId(src, "tor_id"),
    title: required(readString(src, "title", 200), "title"),
    message: readString(src, "message", 2000),
    matched_at: readDate(src, "matched_at"),
  }) as CreateNotificationBody;
}

export function parseUpdateNotification(body: unknown): UpdateNotificationBody {
  const src = asObject(body);
  return requireSomething(
    pruneUndefined({
      title: readString(src, "title", 200),
      message: readString(src, "message", 2000),
      is_read: readBoolean(src, "is_read"),
    }),
    "notification",
  );
}

export function parseListNotifications(query: unknown): ListNotificationsQuery {
  const src = asObject(query);
  return pruneUndefined({
    ...parsePageQuery(query, SORT_FIELDS, "-created_at"),
    user_id: readObjectId(src, "user_id"),
    tor_id: readObjectId(src, "tor_id"),
    is_read: readBoolean(src, "is_read"),
  }) as ListNotificationsQuery;
}
