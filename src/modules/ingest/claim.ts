import type { Model } from "mongoose";
import { env } from "../../config/env.ts";
import type { QueueDoc } from "./queue.model.ts";

//         ┌──────────────────────────────┐
//         │   Mongo: the queue rows      │
//         │                              │
//         │  { projectId, status,        │
//         │    claimedBy, claimedAt,     │
//         │    attempts, reason }        │
//         └──────────────────────────────┘
//             ▲       ▲       ▲
//  claimNext  │       │       │  release
//             │       │       │
//      ┌──────┴─┐ ┌───┴────┐ ┌┴───────┐
//      │worker 1│ │worker 2│ │worker 3│
//      └────────┘ └────────┘ └────────┘
//
// loop:
//     row = claimNext(...)          ← "give me something to do, and mark it mine"
//     if row is null: sleep, continue
//     outcome = do the actual work  ← fetch the zip from process5
//     release(row, outcome)         ← "I'm finished, here's how it went"

// ═════════════════════════════════════════════════════════════════════════════
// CHUNK 1 — claimNext
//
//   export async function claimNext(
//     model: Model<any>,
//     workerId: string,
//     leaseMs: number,
//   ): Promise<QueueDoc | null>
//
// Return ONE row, marked as yours, or null when there's nothing to do.
//
// ── The syntax you need ─────────────────────────────────────────────────────
//
//   await model.findOneAndUpdate(
//     { /* filter: which row */ },
//     { $set: { ... }, $inc: { ... } },
//     { returnDocument: "after" },
//   )
//
// findOneAndUpdate finds and updates as ONE atomic operation — no other worker
// can slip between the find and the write. That is the entire reason this is
// safe to run eight-up. `returnDocument: "after"` gives you the row as it looks
// post-update (so `attempts` is already incremented when you read it).
// It returns null when the filter matches nothing.
//
// $set replaces fields; $inc adds to a number.
//
// ── What the filter has to match ────────────────────────────────────────────
//
// TWO kinds of row are available to claim, and you want either:
//
//   (a) a row nobody has taken yet
//   (b) a row someone took but has since DIED holding
//
// For (b): a crashed worker runs no cleanup. Nothing marks its row as
// abandoned. So "abandoned" has to be INFERABLE FROM THE ROW ITSELF — and the
// only evidence available is how long ago it was claimed. That is what
// claimedAt is for, and why leaseMs is a parameter.
//
// Syntax for "either of these": { $or: [ {...}, {...} ] }
// Syntax for "older than": { claimedAt: { $lt: someDate } }
//
// YOUR DECISIONS:
//   (a) Compute the cutoff. If the lease is 15 minutes, which claims count as
//       dead — ones claimed BEFORE or AFTER (now - leaseMs)?
//   (b) The cutoff must be computed and compared INSIDE the query you send to
//       Mongo. Why can't you read the row first, check the time in JS, then
//       write? (Think about what two workers do between the read and the write.)
//   (c) What do you $set to mark it yours, and what do you $inc?
//       Three fields change on a claim. One of them is what makes retry limits
//       possible later.
// ═════════════════════════════════════════════════════════════════════════════

export async function claimNext(
    model: Model<any>,
    workerId: string,
    leaseMs: number,
): Promise<QueueDoc | null> {
    // compute cut off
    // Any claim older than this is a dead worker
    const cutOff = Date.now() - leaseMs

    const row = await model.findOneAndUpdate(
        { $or: [
            {status: "pending"},
            {status: "working", claimedAt: { $lt: new Date(cutOff)}}
        ]},
        { $set: { status: "working", claimedBy: workerId, claimedAt: new Date()},
            $inc: { attempts: 1 },
        },
        { returnDocument: "after" }
    )
    return row
}

// ═════════════════════════════════════════════════════════════════════════════
// CHUNK 2 — the outcome type
//
//   export type OutCome =
//     | { ok: true }
//     | { ok: false; reason: string }
//
// Same discriminated-union shape as FetchOutcome, much smaller. The worker
// hands this back to say how the row went. Write it as-is.
// ═════════════════════════════════════════════════════════════════════════════

export type OutCome =
| { ok: true }
| { ok: false; reason: string }

// ═════════════════════════════════════════════════════════════════════════════
// CHUNK 3 — release
//
//   export async function release(
//     model: Model<any>,
//     row: QueueDoc,
//     outcome: OutCome,
//   ): Promise<QueueDoc | null>
//
// The worker finished. Three possible endings, and you branch on two things:
// whether it succeeded, and how many attempts the row has already burned.
// env.workerMaxAttempts is the ceiling.
//
//   succeeded            -> terminal success
//   failed, tries left   -> back in the pool for someone to retry
//   failed, out of tries -> terminal failure, and RECORD WHY
//
// All three do a findOneAndUpdate on this row by _id.
//
// YOUR DECISIONS:
//   (a) What status does each of the three write, and which one also needs to
//       store outcome.reason? (A dead row with no reason is unactionable in the
//       admin panel — FR-07.)
//   (b) claimedBy and claimedAt were set when you claimed it. What should they
//       be now that you're done, in ALL three branches, and why does it matter
//       for the row that goes back to pending?
//   (c) THE SUBTLE ONE. Your filter should be { _id: row._id, status: "working" }
//       — not just { _id: row._id }. Consider: your fetch took 20 minutes, the
//       15-minute lease expired, another worker legitimately claimed the row and
//       is working on it right now. You then call release. What happens with
//       each filter? Which one is correct, and what does the extra clause
//       actually protect?
//
// When it typechecks, tell me and I'll review.
// ═════════════════════════════════════════════════════════════════════════════

export async function release(
    model: Model<any>,
    row: QueueDoc,
    outcome: OutCome,
): Promise<QueueDoc | null> {

    const MAX_ATTEMPTS = env.workerMaxAttempts
    let res: QueueDoc | null;
    // outcome -> { ok: true } or { ok: false, reason: string }
    if (outcome.ok) {
        res = await model.findOneAndUpdate(
            {
                status: "working", _id: row._id
            },
            {
                $set: { status: "done", claimedBy: null, claimedAt: null }
            },
            { returnDocument: "after"},
        )
    } else if (row.attempts < MAX_ATTEMPTS) {
        res = await model.findOneAndUpdate(
        { 
            status: "working", _id: row._id ,
        },
        { 
            $set: { status: "pending", claimedBy: null, claimedAt: null },
        },
        { returnDocument: "after" }
        )
    } else {
        res = await model.findOneAndUpdate(
            { 
                status: "working", _id: row._id,
            },
            { 
                $set: { status: "failed", claimedBy: null, claimedAt: null, reason: outcome.reason },
            },
            { returnDocument: "after" }  
        )
    }

    return res
}