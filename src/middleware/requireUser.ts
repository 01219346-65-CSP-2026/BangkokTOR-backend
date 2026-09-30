import type { RequestHandler } from "express";
import { env } from "../config/env.ts";
import { HttpError } from "./errors.ts";
import { verifyHs256, type InternalClaims } from "../shared/utils/jwt.ts";
import { isDuplicateKey } from "../shared/utils/parse.ts";
import { UserModel } from "../modules/user/user.model.ts";

/**
 * Identifies the signed-in user for the `/api/me` routes (NFR-08: data scoped
 * to the authenticated user).
 *
 * The browser never calls these routes. The frontend's server does, with a
 * 60-second HS256 token carrying the Google `sub` and email — so the trust
 * boundary is INTERNAL_JWT_SECRET, which only the two servers hold.
 *
 * On success `res.locals.userId` is the Mongo `_id` as a string. The row
 * usually already exists (the frontend calls `POST /api/user/sync` on every
 * sign-in); if that sync failed, it is created here from the token.
 *
 * Unlike requireAdminToken this never opens up in dev. A route that answers
 * "whose data is this" cannot have a no-config default.
 */
export const requireUser: RequestHandler = async (req, res, next) => {
  if (!env.internalJwtSecret) {
    throw new HttpError(401, "INTERNAL_JWT_SECRET is not configured on the backend — see .env.example");
  }

  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) throw new HttpError(401, "Sign in required");

  const claims = verifyHs256(token, env.internalJwtSecret);

  // The frontend signs "anonymous" when there is no session. Its route should
  // have stopped that already; this is the backstop.
  if (claims.sub === "anonymous") throw new HttpError(401, "Sign in required");

  const user = (await findUser(claims)) ?? (await createFromClaims(claims));
  if (!user) throw new HttpError(401, "User not synced — sign out and sign in again");

  res.locals.userId = user._id.toString();
  next();
};

async function findUser(claims: InternalClaims) {
  // google_id first: an email can change on the Google side, the subject can't.
  return (
    (await UserModel.findOne({ google_id: claims.sub }, { _id: 1 }).lean().exec()) ??
    (claims.email
      ? await UserModel.findOne({ email: claims.email.toLowerCase() }, { _id: 1 }).lean().exec()
      : null)
  );
}

/**
 * The row is normally created by `POST /api/user/sync` at sign-in — but the
 * frontend swallows a failed sync so a backend hiccup never blocks login (see
 * its auth.ts). Without this, one missed sync would leave the user with a
 * working session and a profile page that 401s until they sign in again.
 *
 * Safe because the claims are already verified: only the frontend's server
 * holds the secret, and it only signs for a session Google authenticated.
 * The next successful sync fills in name, avatar and the rest.
 */
async function createFromClaims(claims: InternalClaims) {
  if (!claims.email) return null;

  try {
    const doc = await UserModel.create({ google_id: claims.sub, email: claims.email.toLowerCase() });
    return { _id: doc._id };
  } catch (err) {
    // Two first requests racing: the other one inserted the row.
    if (isDuplicateKey(err)) return findUser(claims);
    throw err;
  }
}
