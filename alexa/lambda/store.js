'use strict';
// Where each listener left off: station, track and offset. On Railway the state lives as
// small JSON files on the service's volume (STATE_DIR); on Alexa-hosted Lambda in the S3
// bucket it provides (S3_PERSISTENCE_BUCKET); otherwise in memory, enough for local tests.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

let backend;
const dir = process.env.STATE_DIR;
const bucket = process.env.S3_PERSISTENCE_BUCKET;
if (dir) {
  backend = {
    async get(key) {
      try { return JSON.parse(await fs.readFile(path.join(dir, key), 'utf8')); }
      catch (err) { if (err.code !== 'ENOENT') console.log('store: read failed:', err.message); return null; }
    },
    async put(key, value) {
      try { await fs.mkdir(dir, { recursive: true }); const tmp = path.join(dir, `${key}.${process.pid}.tmp`); await fs.writeFile(tmp, JSON.stringify(value)); await fs.rename(tmp, path.join(dir, key)); }
      catch (err) { console.log('store: write failed:', err.message); }
    },
  };
} else if (bucket) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({});
  backend = {
    async get(key) {
      try { const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `hifi/${key}` })); return JSON.parse(await out.Body.transformToString()); }
      catch (err) { if (err.name !== 'NoSuchKey') console.log('store: read failed:', err.message); return null; }
    },
    async put(key, value) {
      try { await client.send(new PutObjectCommand({ Bucket: bucket, Key: `hifi/${key}`, Body: JSON.stringify(value), ContentType: 'application/json' })); }
      catch (err) { console.log('store: write failed:', err.message); }
    },
  };
} else {
  const memory = new Map();
  backend = { async get(key) { return memory.get(key) || null; }, async put(key, value) { memory.set(key, value); } };
}

// One file per Alexa user; the id is hashed so the store never holds the raw identifier.
const keyFor = envelope => crypto.createHash('sha256')
  .update(envelope.context?.System?.user?.userId || envelope.session?.user?.userId || 'anonymous').digest('hex').slice(0, 32) + '.json';

const load = async envelope => (await backend.get(keyFor(envelope))) || {};
const save = (envelope, state) => backend.put(keyFor(envelope), state);

module.exports = { load, save };
