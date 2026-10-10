import test from 'node:test';
import assert from 'node:assert/strict';
import { callJev, JEV_MODEL, JEV_URL } from '../tools/jev/callJev.mjs';
import { parseCsv, triage, OPTIONS, REVIEW_BELOW } from '../tools/jev/triage-feedback.mjs';

const reply = answer => ({ ok: true, json: async () => ({ answers: { decision: { type: 'choice', ...answer } } }) });
const OPTS = { bug: 'rusak', lainnya: 'lain' };

test('callJev posts a choice question to the Decisions endpoint and returns the pick', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, init }; return reply({ choice: 'bug', confidence: 0.9, probabilities: { bug: 0.95, lainnya: 0.05 } }); };
  const out = await callJev({ question: 'q', options: OPTS, input: 'x', apiKey: 'k', fetchImpl });
  assert.deepEqual(out, { choice: 'bug', confidence: 0.9, probabilities: { bug: 0.95, lainnya: 0.05 } });
  assert.equal(sent.url, JEV_URL);
  const body = JSON.parse(sent.init.body);
  assert.equal(body.model, JEV_MODEL);
  assert.equal(body.state, 'x');
  assert.deepEqual(body.questions.decision, { type: 'choice', instructions: 'q', criteria: OPTS });
  assert.equal(sent.init.headers.Authorization, 'Bearer k');
});

test('callJev refuses to run without a key and rejects unexpected answers', async () => {
  await assert.rejects(callJev({ question: 'q', options: OPTS, input: 'x', apiKey: '' }), /OPENROUTER_API_KEY/);
  await assert.rejects(callJev({ question: 'q', options: OPTS, input: 'x', apiKey: 'k', fetchImpl: async () => reply({ choice: 'c' }) }), /not one of the options/);
  const odd = async () => ({ ok: true, json: async () => ({ something: 'else' }) });
  await assert.rejects(callJev({ question: 'q', options: OPTS, input: 'x', apiKey: 'k', fetchImpl: odd }), /Unexpected Jev response/);
});

test('parseCsv handles quoted commas and escaped quotes', () => {
  const rows = parseCsv('id,pesan\n1,"a, b"\n2,"say ""hi"""\n');
  assert.deepEqual(rows, [{ id: '1', pesan: 'a, b' }, { id: '2', pesan: 'say "hi"' }]);
});

test('triage flags low-confidence tags for review and keeps going when one call fails', async () => {
  const jev = async ({ input, options }) => {
    assert.deepEqual(options, OPTIONS);
    if (input === 'boom') throw new Error('down');
    return { choice: 'saran', confidence: input === 'ragu' ? REVIEW_BELOW - 0.1 : 0.95 };
  };
  const out = await triage([{ id: '1', pesan: 'ide' }, { id: '2', pesan: 'ragu' }, { id: '3', pesan: 'boom' }], jev);
  assert.equal(out[0].kategori, 'saran');
  assert.equal(out[0].cek_manual, false);
  assert.equal(out[1].cek_manual, true);
  assert.equal(out[2].error, 'down');
});

test('askJev sends several typed questions in one call and returns answers by key', async () => {
  const { askJev } = await import('../tools/jev/callJev.mjs');
  const { QUESTIONS } = await import('../tools/jev/cek-nama.mjs');
  let body;
  const answers = { kasar: { type: 'noul', noul: 0.1 }, tema: { type: 'choice', choice: 'scifi' }, kualitas: { type: 'score', score: 3 } };
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ answers }) }; };
  assert.deepEqual(await askJev({ state: 'Nama kota: Neo', questions: QUESTIONS, apiKey: 'k', fetchImpl }), answers);
  assert.deepEqual(Object.keys(body.questions), ['kasar', 'tema', 'kualitas']);
  const missing = async () => ({ ok: true, json: async () => ({ answers: { kasar: answers.kasar } }) });
  await assert.rejects(askJev({ state: 's', questions: QUESTIONS, apiKey: 'k', fetchImpl: missing }), /Unexpected Jev response/);
});

test('NPC asks again when Jev is unsure, and name check blocks only likely-rude names', async () => {
  const { reply, LINES, ASK_BELOW } = await import('../tools/jev/npc-intent.mjs');
  const { verdict, BLOCK_ABOVE } = await import('../tools/jev/cek-nama.mjs');
  assert.equal(reply({ choice: 'bakery', confidence: 0.9 }), LINES.bakery);
  assert.match(reply({ choice: 'bakery', confidence: ASK_BELOW - 0.1 }), /^Maksudmu bakery\?/);
  assert.equal(reply({ choice: 'none', confidence: 0.2 }), LINES.none);
  assert.match(verdict({ kasar: { noul: BLOCK_ABOVE + 0.1 } }), /TOLAK/);
  assert.equal(verdict({ kasar: { noul: 0.05 } }), 'boleh tampil');
  assert.match(verdict({ kasar: { type: 'noul' } }), /periksa manual/);
});
