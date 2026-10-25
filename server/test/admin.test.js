import assert from 'node:assert/strict';
import { createRepository } from '../src/db.js';
import { hashPassword, provisionAdminAccount, verifyPassword } from '../src/auth.js';
import { readConfig } from '../src/config.js';

// The administrator is named by variable, so the two values are read as given. The
// email is trimmed because a pasted address often carries a space; the password is
// not, because a password that ends in a space is a different secret.
const configured = readConfig({ ADMIN_EMAIL: ' Boss@Example.com ', ADMIN_PASSWORD: ' spaced secret ' });
assert.equal(configured.adminEmail, 'Boss@Example.com');
assert.equal(configured.adminPassword, ' spaced secret ');
assert.equal(readConfig({}).adminEmail, '');
assert.equal(readConfig({}).adminPassword, '');

/**
 * Stands in for the real repository. Its ensureAdminAccount mirrors the SQL: an
 * empty hash keeps whatever the row already held.
 */
function fakeRepository(seed = null) {
  const state = { record: seed };
  const calls = [];
  return {
    state,
    calls,
    async findUserByEmail() {
      return state.record ? { user: state.record.user, passwordHash: state.record.passwordHash } : null;
    },
    async ensureAdminAccount({ email, passwordHash }) {
      calls.push({ email, passwordHash });
      const kept = passwordHash === '' ? state.record?.passwordHash ?? null : passwordHash;
      state.record = { user: { id: 'admin-1', email, isAdmin: true, displayName: '' }, passwordHash: kept };
      return state.record.user;
    },
  };
}

// First boot: the account is created, the flag is on and only a hash is stored.
const fresh = fakeRepository();
const first = await provisionAdminAccount({ repository: fresh, email: 'Boss@Example.com', password: 'correct horse battery' });
assert.equal(first.created, true);
assert.equal(first.user.isAdmin, true);
assert.equal(first.user.email, 'boss@example.com', 'the address is normalised before it is stored');
assert.equal(first.passwordSet, true);
assert.equal(fresh.calls.length, 1);
assert.equal(await verifyPassword('correct horse battery', fresh.calls[0].passwordHash), true);
assert.equal(await verifyPassword('wrong password', fresh.calls[0].passwordHash), false);
assert.ok(!JSON.stringify(first).includes('correct horse battery'), 'the password never travels back out');

// A later boot with the variable still set rotates the password, because the
// variable is the source of truth for it.
const rotated = fakeRepository({ user: { id: 'admin-1', email: 'boss@example.com', isAdmin: true }, passwordHash: await hashPassword('the old password') });
const second = await provisionAdminAccount({ repository: rotated, email: 'boss@example.com', password: 'a brand new secret' });
assert.equal(second.created, false, 'the existing account is promoted, not replaced');
assert.equal(await verifyPassword('a brand new secret', rotated.state.record.passwordHash), true);
assert.equal(await verifyPassword('the old password', rotated.state.record.passwordHash), false);

// Removing ADMIN_PASSWORD must not lock out an account that already has a password:
// an empty hash reaches the repository, which keeps the stored one.
const kept = fakeRepository({ user: { id: 'admin-1', email: 'boss@example.com', isAdmin: false }, passwordHash: await hashPassword('still valid') });
const third = await provisionAdminAccount({ repository: kept, email: 'boss@example.com', password: '' });
assert.equal(third.created, false);
assert.equal(third.passwordSet, true);
assert.equal(kept.calls[0].passwordHash, '');
assert.equal(await verifyPassword('still valid', kept.state.record.passwordHash), true);

// Every refusal is reported instead of thrown, because the server has to keep
// booting, and none of the messages repeat a secret.
const badEmail = fakeRepository();
assert.match((await provisionAdminAccount({ repository: badEmail, email: 'not an email' })).skipped, /ADMIN_EMAIL/);
assert.equal(badEmail.calls.length, 0);
assert.match((await provisionAdminAccount({ repository: fakeRepository() })).skipped, /ADMIN_EMAIL/);
const shortPassword = fakeRepository();
const short = await provisionAdminAccount({ repository: shortPassword, email: 'boss@example.com', password: 'abc' });
assert.match(short.skipped, /ADMIN_PASSWORD/);
assert.ok(!short.skipped.includes('abc'), 'the message names the variable, not the value');
assert.equal(shortPassword.calls.length, 0);
assert.match((await provisionAdminAccount({ repository: {}, email: 'boss@example.com' })).skipped, /cannot store an administrator/);
assert.match((await provisionAdminAccount({ email: 'boss@example.com' })).skipped, /cannot store an administrator/);

// The database side: one statement creates or promotes, and the new account gets
// the subscription a session needs.
const queries = [];
const client = {
  async query(text, values = []) {
    queries.push({ text, values });
    if (text.startsWith('INSERT INTO users')) {
      return { rows: [{ id: 'admin-1', email: values[0], is_admin: true, password_hash: values[1], status: 'active' }] };
    }
    return { rows: [], rowCount: 1 };
  },
  release() {},
};
const repository = createRepository({ connect: async () => client });
const stored = await repository.ensureAdminAccount({ email: 'boss@example.com', passwordHash: 'scrypt$hash' });
const insert = queries.find((entry) => entry.text.startsWith('INSERT INTO users'));
assert.match(insert.text, /VALUES \(\$1, NULLIF\(\$2, ''\), TRUE\)/, 'a new account is created as an administrator');
assert.match(insert.text, /ON CONFLICT \(email\) DO UPDATE SET is_admin = TRUE/, 'an existing account is promoted');
assert.match(insert.text, /COALESCE\(NULLIF\(\$2, ''\), users\.password_hash\)/, 'an empty password keeps the stored hash');
assert.deepEqual(insert.values, ['boss@example.com', 'scrypt$hash']);
assert.ok(queries.some((entry) => entry.text.startsWith('INSERT INTO subscriptions')), 'the account can resolve a session');
assert.equal(queries[0].text, 'BEGIN');
assert.equal(queries.at(-1).text, 'COMMIT');
assert.equal(stored.isAdmin, true);
assert.equal(stored.email, 'boss@example.com');

console.log('PASS admin provisioning');
