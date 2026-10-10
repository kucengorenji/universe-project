import test from 'node:test';
import assert from 'node:assert/strict';
import { callJev, JEV_MODEL } from '../tools/jev/callJev.mjs';
import { parseCsv, triage, CATEGORIES } from '../tools/jev/triage-feedback.mjs';

const reply = choice => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ choice }) } }] }) });

test('callJev sends the options as a strict enum and returns the pick', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, init }; return reply('bug'); };
  const out = await callJev({ question: 'q', options: ['bug', 'lainnya'], input: 'x', apiKey: 'k', fetchImpl });
  assert.deepEqual(out, { choice: 'bug' });
  const body = JSON.parse(sent.init.body);
  assert.equal(body.model, JEV_MODEL);
  assert.deepEqual(body.response_format.json_schema.schema.properties.choice.enum, ['bug', 'lainnya']);
  assert.equal(sent.init.headers.Authorization, 'Bearer k');
});

test('callJev refuses to run without a key and rejects answers outside the options', async () => {
  await assert.rejects(callJev({ question: 'q', options: ['a', 'b'], input: 'x', apiKey: '' }), /OPENROUTER_API_KEY/);
  await assert.rejects(callJev({ question: 'q', options: ['a', 'b'], input: 'x', apiKey: 'k', fetchImpl: async () => reply('c') }), /not one of the options/);
});

test('parseCsv handles quoted commas and escaped quotes', () => {
  const rows = parseCsv('id,pesan\n1,"a, b"\n2,"say ""hi"""\n');
  assert.deepEqual(rows, [{ id: '1', pesan: 'a, b' }, { id: '2', pesan: 'say "hi"' }]);
});

test('triage keeps going when one call fails', async () => {
  const jev = async ({ input, options }) => { assert.deepEqual(options, CATEGORIES); if (input === 'boom') throw new Error('down'); return { choice: 'saran' }; };
  const out = await triage([{ id: '1', pesan: 'ide' }, { id: '2', pesan: 'boom' }], jev);
  assert.equal(out[0].kategori, 'saran');
  assert.equal(out[1].error, 'down');
});
