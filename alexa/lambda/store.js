'use strict';
// Where each listener left off: station, track and offset. Alexa-hosted skills get an
// S3 bucket (S3_PERSISTENCE_BUCKET); without one, state lives in memory for the life of
// the process, which is enough for local testing.

const bucket = process.env.S3_PERSISTENCE_BUCKET;
let s3 = null;
if (bucket) {
  const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({});
  s3 = {
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return JSON.parse(await out.Body.transformToString());
      } catch (err) {
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
        console.log('store: read failed:', err.message); return null;
      }
    },
    async put(key, value) {
      try { await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(value), ContentType: 'application/json' })); }
      catch (err) { console.log('store: write failed:', err.message); }
    },
  };
}
const memory = new Map();

const keyFor = envelope => `hifi/${envelope.context?.System?.user?.userId || envelope.session?.user?.userId || 'anonymous'}.json`;

async function load(envelope) {
  const key = keyFor(envelope);
  return (s3 ? await s3.get(key) : memory.get(key)) || {};
}
async function save(envelope, state) {
  const key = keyFor(envelope);
  if (s3) await s3.put(key, state); else memory.set(key, state);
}

module.exports = { load, save };
