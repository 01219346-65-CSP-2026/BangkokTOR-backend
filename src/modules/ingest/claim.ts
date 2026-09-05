import type { Model } from "mongoose";
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

// loop:
//     row = claimNext(...)          ← "give me something to do, and mark it mine"
//     if row is null: sleep, continue
//     outcome = do the actual work  ← fetch the zip from process5
//     release(row, outcome)         ← "I'm finished, here's how it went"

// return one claimed row or null if nothing is available
export async function claimNext(model: Model<any>, workerId: string, leaseMs: number) {

    // compute cut off
    // Any claim older than this is a dead worker
    const cutOff = Date.now() - leaseMs

    // get one row
    const row = await model.findOneAndUpdate(
    { $or: [
        { status: "pending" },
        { status: "working", claimedAt: { $lt: new Date(cutOff) } }
    ]},
    { $set: { status: "working", claimedBy: workerId, claimedAt: new Date() },
        $inc: { attempts: 1 } },
    { returnDocument: "after" }
    )

    return row
}

type OutCome = 
    | { ok: true }
    | { ok: false, reason: string | null}

type QueueRow = {
    _id: string,
    projectId: string,
    status: string,
    claimedBy: string,
    claimedAt: Date,
    attempts: number,
    reason: string
}

export async function release(model: Model<any>, row: QueueRow, outcome: OutCome) {

    const MAX_ATTEMPTS = 3
    let res: QueueRow | null;
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

