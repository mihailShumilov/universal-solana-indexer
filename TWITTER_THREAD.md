# Twitter/X Thread Draft

---

**1/8**
I built a Universal Solana Indexer that automatically adapts to ANY Anchor IDL.

No manual table definitions. No program-specific code. Just point it at an IDL and a program ID, and it indexes everything.

Here's what I learned building it.

---

**2/8**
The core challenge: how do you make a database schema that works for any Anchor program without knowing the program's data model ahead of time?

My answer: a hybrid approach.

Fixed relational tables for universal data (txs, slots, signers) + JSONB columns for IDL-specific decoded data + a metadata registry that describes what each IDL defines.

---

**3/8**
Instruction decoding was interesting.

The indexer uses @coral-xyz/anchor's BorshCoder for primary decoding, with discriminator-based fallback when that fails. It handles outer and inner instructions, serializes BN/PublicKey to JSON, and persists everything atomically with the transaction record.

---

**4/8**
Account state decoding:

After processing instructions, the indexer identifies writable program-owned accounts, batch-fetches them, matches 8-byte discriminators against the IDL's account types, and stores decoded snapshots.

Trade-off: current state, not historical reconstruction (that needs Geyser).

---

**5/8**
Real-time mode has cold-start recovery:

1. Read last checkpoint
2. Calculate the gap
3. Backfill missed txs using `until: lastSignature`
4. Switch to live `onLogs` subscription
5. Every write atomically advances the checkpoint

Zero missed transactions on restart.

---

**6/8**
Reliability things that matter in production:

- Exponential backoff with jitter on all RPC calls
- Retryable error classification (429, timeouts, connection resets)
- Graceful SIGINT/SIGTERM with LIFO cleanup
- Atomic DB transactions (data + checkpoint together)
- Idempotent inserts everywhere

---

**7/8**
The REST API supports:
- Multi-parameter filtering (instruction + signer + time + slot + success)
- Instruction count aggregations grouped by hour/day
- Full program statistics
- Schema introspection (what does this IDL define?)
- Pagination, sorting, Zod validation

---

**8/8**
Stack: TypeScript, Fastify, PostgreSQL, pino, Zod, Vitest
One `docker compose up --build` to run everything.

Biggest lesson: the JSONB-based hybrid schema is a great 80/20 solution. You get universality at the cost of some query performance, which you can recover with views later.

Code: [link]

---
