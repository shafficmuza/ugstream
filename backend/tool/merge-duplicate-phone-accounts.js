#!/usr/bin/env node
/**
 * Merge accounts that are the same person written differently.
 *
 * Before phone numbers were normalised to E.164 (see src/auth/phone.util.ts),
 * `0772878614`, `+256772878614` and `+256772 878614` each created their own
 * account with its own subscription and history. Normalisation stops new ones
 * appearing; this repairs the rows that already exist.
 *
 * Within a group the canonical account is the privileged one if there is one,
 * otherwise the oldest. Everything owned by the others is reassigned to it and
 * the duplicate rows are deleted. Two tables are keyed on (user_id, ...) and
 * can collide — watch_history and my_list_items — so those are merged rather
 * than moved: the furthest playback position wins, since that is the one the
 * viewer would expect to resume from.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   node tool/merge-duplicate-phone-accounts.js            # report only
 *   node tool/merge-duplicate-phone-accounts.js --apply
 */
const { PrismaClient } = require('@prisma/client');
// Uses the same normalisation the running application does, so the grouping
// here can never disagree with what login will resolve a number to.
const { toE164OrNull } = require('../dist/src/auth/phone.util');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/**
 * Tables owning rows by user, as [table, column]. The column is not always
 * `user_id` — notifications record their author in `created_by` — and a merge
 * that silently skips a table would strand rows on an account about to be
 * deleted, so each is named explicitly rather than discovered.
 */
const REASSIGN = [
  ['sessions', 'user_id'],
  ['subscriptions', 'user_id'],
  ['payments', 'user_id'],
  ['purchases', 'user_id'],
  ['devices', 'user_id'],
  ['activity_logs', 'user_id'],
  ['stream_leases', 'user_id'],
  ['notifications', 'created_by'],
];

function plan(users) {
  const groups = new Map();
  for (const u of users) {
    const norm = toE164OrNull(u.phone);
    if (!norm) continue;
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm).push(u);
  }

  const merges = [];
  const renames = [];
  for (const [norm, rows] of groups) {
    if (rows.length > 1) {
      const rank = (r) => (r.role === 'admin' ? 0 : r.role === 'editor' ? 1 : 2);
      const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || Number(a.id - b.id));
      merges.push({ norm, keep: sorted[0], drop: sorted.slice(1) });
    } else if (rows[0].phone !== norm) {
      renames.push({ user: rows[0], to: norm });
    }
  }
  return { merges, renames };
}

/**
 * All of one account's belongings move, or none do. Without the transaction a
 * failure partway leaves rows split across two accounts with no record of how
 * far it got — and the first run of this script did fail partway.
 */
async function mergeOne(keepId, dropId) {
  return prisma.$transaction(async (tx) => {
    const moved = {};

    for (const [table, column] of REASSIGN) {
      const n = await tx.$executeRawUnsafe(
        `UPDATE "${table}" SET "${column}" = $1 WHERE "${column}" = $2`,
        keepId,
        dropId,
      );
      if (n) moved[table] = n;
    }

    // Keyed on (user_id, episode_id): take the furthest position, and treat
    // the episode as completed if either account finished it.
    const wh = await tx.$executeRaw`
      INSERT INTO watch_history (user_id, episode_id, position_secs, completed, updated_at)
      SELECT ${keepId}::bigint, episode_id, position_secs, completed, updated_at
      FROM watch_history WHERE user_id = ${dropId}::bigint
      ON CONFLICT (user_id, episode_id) DO UPDATE SET
        position_secs = GREATEST(watch_history.position_secs, EXCLUDED.position_secs),
        completed     = watch_history.completed OR EXCLUDED.completed,
        updated_at    = GREATEST(watch_history.updated_at, EXCLUDED.updated_at)`;
    if (wh) moved.watch_history = wh;
    await tx.$executeRaw`DELETE FROM watch_history WHERE user_id = ${dropId}::bigint`;

    const ml = await tx.$executeRaw`
      INSERT INTO my_list_items (user_id, title_id, created_at)
      SELECT ${keepId}::bigint, title_id, created_at
      FROM my_list_items WHERE user_id = ${dropId}::bigint
      ON CONFLICT (user_id, title_id) DO NOTHING`;
    if (ml) moved.my_list_items = ml;
    await tx.$executeRaw`DELETE FROM my_list_items WHERE user_id = ${dropId}::bigint`;

    await tx.$executeRaw`DELETE FROM users WHERE id = ${dropId}::bigint`;
    return moved;
  });
}

(async () => {
  const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
  const { merges, renames } = plan(users);

  console.log(`${users.length} accounts; ${merges.length} duplicate group(s), ${renames.length} to renormalise.\n`);

  for (const m of merges) {
    console.log(`${m.norm}`);
    console.log(`  keep  #${m.keep.id} ${JSON.stringify(m.keep.phone)} (${m.keep.role})`);
    for (const d of m.drop) console.log(`  merge #${d.id} ${JSON.stringify(d.phone)} (${d.role})`);
    if (APPLY) {
      for (const d of m.drop) {
        const moved = await mergeOne(m.keep.id, d.id);
        const summary = Object.entries(moved).map(([t, n]) => `${t}:${n}`).join(' ') || 'nothing to move';
        console.log(`        → ${summary}`);
      }
    }
    console.log();
  }

  for (const r of renames) {
    console.log(`renormalise #${r.user.id} ${JSON.stringify(r.user.phone)} → ${r.to}`);
    if (APPLY) {
      await prisma.user.update({ where: { id: r.user.id }, data: { phone: r.to } });
    }
  }

  console.log(APPLY ? '\nApplied.' : '\nDry run — nothing written. Pass --apply to commit.');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
