import { nextSlot } from "../src/lib/http/politeClient.ts";

const t0 = Date.now();
const at = () => `${Date.now() - t0}ms`;

console.log(at(), "worker 1 fetched");

// TEST 1, same host, 4 callers fired in the SAME tick
console.log("\nTEST 1 — 4 callers, same host, all started at once (delay 400)");

await Promise.all(
    [1,2,3,4].map(async (n) => {
        await nextSlot("google.com", 400);
        console.log(`  ${at()}  worker ${n} may fetch`);
    })
)

// TEST 2
console.log("\nTEST 2 — 2 hosts interleaved (delay 300). Each host queues alone.");
const t1 = Date.now();
const at1 = () => String(Date.now() - t1).padStart(5) + "ms";

await Promise.all([
  ...[1, 2].map(async (n) => {
    await nextSlot("host-A.example", 300);
    console.log(`  ${at1()}  A${n}`);
  }),
  ...[1, 2].map(async (n) => {
    await nextSlot("host-B.example", 300);
    console.log(`  ${at1()}  B${n}`);
  }),]
)

// TEST 3: poisoned-chain
// Caller 1 FAILS but Caller 2 still get its turn
console.log("\nTEST 3 — caller 1 fails; caller 2 must still get a turn");
const t2 = Date.now();
const at2 = () => String(Date.now() - t2).padStart(5) + "ms";

const failing = nextSlot("host-C.example", 200).then(() => {
  console.log(`  ${at2()}  C1 took its turn, now throwing`);
  throw new Error("simulated fetch failure");    
})
failing.catch(() => {});

const second = nextSlot("host-C.example", 200).then(() => {
  console.log(`  ${at2()}  C2 got its turn  <-- chain survived`);
});

await Promise.allSettled([failing, second]);

// TEST 4
console.log("\nTEST 4 — returned promise stays honest about rejection");
const mine = nextSlot("host-D.example", 50).then(() => {
  throw new Error("boom");
});
try {
  await mine;
  console.log("  no error surfaced  <-- WRONG, the caller was lied to");
} catch (e) {
  console.log(`  caught: ${(e as Error).message}  <-- correct`);
}

console.log("");

