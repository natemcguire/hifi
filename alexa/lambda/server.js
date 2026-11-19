'use strict';
// HIFI radio for Alexa as an HTTPS endpoint (Railway). The adapter checks every request's
// Alexa signature and timestamp before the skill sees it.

const express = require('express');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const { skill } = require('./index');
const { exitOnSignal } = require('./shutdown');

const app = express();
app.disable('x-powered-by');
app.get('/', (req, res) => res.type('text').send('HIFI radio for Alexa'));
app.get('/health', (req, res) => res.json({ ok: true }));
app.post('/alexa', new ExpressAdapter(skill, true, true).getRequestHandlers());

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => console.log(`HIFI radio for Alexa listening on ${port}`));

exitOnSignal(server, { name: 'HIFI radio for Alexa' });
