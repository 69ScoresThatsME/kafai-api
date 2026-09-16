// Explicitly invoked maintenance client. Never runs during startup/deployment.
require('dotenv').config();
const { parseArgs } = require('node:util');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { migrationPlan } = require('../lib/meter');
require('dns').setServers(['8.8.8.8', '1.1.1.1']);
const { values } = parseArgs({ options: {
  username: { type: 'string' }, anchor: { type: 'string' }, at: { type: 'string' },
  correction: { type: 'string', multiple: true }, apply: { type: 'boolean', default: false },
  'accept-listed-total': { type: 'boolean', default: false },
  api: { type: 'string', default: 'https://kafai-api.vercel.app/api' },
} });
async function main() {
  if (!values.username || !values.anchor || !values.at) throw new Error('Required: --username --anchor --at; default is read-only preview');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const user = await mongoose.connection.collection('Users').findOne({ username: values.username }, { projection: { _id: 1, username: 1 } });
  if (!user) throw new Error('Account not found');
  const records = await mongoose.connection.collection('kafai').find({ userId: user._id }).toArray();
  const dateCorrections = Object.fromEntries((values.correction || []).map(s => s.split('=')));
  for (const key of Object.keys(dateCorrections)) if (!records.some(r => String(r._id) === key)) throw new Error('Correction record is not owned by selected user');
  const body = { mode: 'usage_days', anchorAt: values.at, anchorReading: Number(values.anchor), modulus: 10000, dateCorrections, acceptListedUsageTotal: values['accept-listed-total'], fingerprint: JSON.stringify(records.map(r=>`${r._id}:${r.updatedAt?.toISOString() || ''}`).sort()) };
  const plan = migrationPlan(records, body);
  console.log(JSON.stringify({ username: user.username, mode: values.apply ? 'apply' : 'preview', oldCount: records.length, newCount: plan.entries.length, totalKwh: plan.total, first: plan.entries[0], last: plan.entries.slice(-3), gaps: plan.gaps, warning: plan.warning }, null, 2));
  if (!values.apply) return;
  const url = new URL(values.api);
  if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('HTTPS required');
  const version = await fetch(`${values.api}/version`).then(r=>r.json());
  if (version.version !== 2) throw new Error('New backend must be deployed before migration');
  const token = jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const response = await fetch(`${values.api}/kafai/migration/commit`, { method: 'POST', headers: { 'Content-Type':'application/json', 'X-Kafai-Version':'2', Authorization:`Bearer ${token}` }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`API ${response.status}: ${result.error}`);
  console.log(JSON.stringify({ result }));
  const saved = await mongoose.connection.collection('kafai').find({ userId: user._id }).sort({ recordedAt: 1 }).toArray();
  if (saved.length !== plan.entries.length || saved.at(-1).meterReading !== Number(values.anchor) || saved.some(r=>'targetDate' in r)) throw new Error('Post-migration verification failed; archive available, do not rerun');
  // Only obsolete targetDate indexes are removed; original documents remain in the archive.
  const indexes = await mongoose.connection.collection('kafai').indexes();
  for (const index of indexes) if (Object.hasOwn(index.key,'targetDate')) await mongoose.connection.collection('kafai').dropIndex(index.name);
  console.log(JSON.stringify({ verified: true, count: saved.length, latest: saved.at(-1).meterReading, migrationId: result.migrationId }));
}
main().catch(e=>{ console.error(e.message?.includes('mongodb') ? 'Database connection failed (credentials not logged)' : e.message); process.exitCode=1; }).finally(()=>mongoose.disconnect());
