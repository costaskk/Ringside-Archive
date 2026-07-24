import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.INTEGRATION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
const { encryptJson, decryptJson, signValue, verifySignedValue } = await import('../api/_lib/crypto.js?cloud-smoke=1');

const sample = {
  provider: 'plex',
  token: 'never-plaintext-in-database',
  nested: { accessToken: 'trakt-token', items: Array.from({ length: 20 }, (_, i) => ({ i, title: `Item ${i}` })) }
};
const encrypted = encryptJson(sample);
if (!encrypted.startsWith('v1.') || encrypted.includes(sample.token)) throw new Error('Integration encryption did not produce an opaque v1 payload.');
const roundTrip = decryptJson(encrypted);
if (JSON.stringify(roundTrip) !== JSON.stringify(sample)) throw new Error('Integration encryption round-trip failed.');
const expiry = Date.now() + 60000, signedValue = 'user|server|/library/metadata/1/thumb/1', signature = signValue(signedValue, expiry);
if (!verifySignedValue(signedValue, expiry, signature) || verifySignedValue(`${signedValue}-tampered`, expiry, signature)) throw new Error('Signed Plex artwork URL validation failed.');

const required = [
  'src/cloud.js', 'supabase/schema.sql',
  'api/_lib/account.js', 'api/_lib/crypto.js', 'api/_lib/providers.js',
  'api/account/integrations.js', 'api/plex/view-state.js', 'api/plex/image.js',
  'api/trakt/refresh.js'
];
for (const file of required) await fs.access(path.join(root, file));

const schema = await fs.readFile(path.join(root, 'supabase/schema.sql'), 'utf8');
for (const fragment of [
  'alter table public.archive_state enable row level security',
  'auth.uid()',
  'create table if not exists public.integration_vault',
  'revoke all on table public.integration_vault from anon, authenticated'
]) if (!schema.toLowerCase().includes(fragment.toLowerCase())) throw new Error(`Supabase schema is missing: ${fragment}`);

const accountSource = await fs.readFile(path.join(root, 'api/_lib/account.js'), 'utf8');
if (!accountSource.includes("secretKey.split('.').length === 3")) throw new Error('Supabase new/legacy secret-key compatibility guard is missing.');
if (!accountSource.includes("...(isLegacyJwt ? { Authorization:")) throw new Error('Legacy service_role Authorization handling is missing.');

const cloudSource = await fs.readFile(path.join(root, 'src/cloud.js'), 'utf8');
for (const fragment of ['consumeCloudAuthRedirect', 'updateCloudPassword', 'archive_state', 'X-Ringside-Account-Token']) {
  if (!cloudSource.includes(fragment)) throw new Error(`Cloud client is missing ${fragment}.`);
}

console.log('Cloud smoke passed: encryption, RLS schema, account APIs and Supabase key compatibility validated.');
