import test from 'node:test';
import assert from 'node:assert/strict';
import { NoticeBoard, RANK, missionToastSuppressed } from '../src/ui/noticePolicy.js';

const note = (kind, message = kind, ms) => ({ kind, message, ms });

test('one message at a time: a higher kind takes the slot, a lower one waits', () => {
  const b = new NoticeBoard();
  assert.equal(b.post(note('mission'), 0), 'show');
  assert.equal(b.post(note('stage'), 10), 'show', 'a stage toast replaces a mission toast');
  assert.equal(b.at(10).kind, 'stage');
  assert.equal(b.post(note('mission', 'later'), 20), 'queued');
  assert.equal(b.at(20).kind, 'stage', 'still one message');
  assert.equal(b.at(20 + 2800).message, 'later', 'the waiting one comes up when the slot frees');
  assert.equal(b.at(20 + 2800 + 2800), null);
});

test('priority: save confirmation > stage > mission', () => {
  assert.ok(RANK.saved > RANK.stage && RANK.stage > RANK.mission);
  const b = new NoticeBoard();
  b.post(note('stage'), 0);
  assert.equal(b.post(note('saved', 'ok', 4000), 100), 'show');
  assert.equal(b.at(100).kind, 'saved');
  assert.equal(b.at(100 + 3999).kind, 'saved', 'the confirmation stays four seconds');
  assert.equal(b.at(100 + 4000), null);
  b.post(note('saved', 'long', 99999), 5000);
  assert.equal(b.at(5000 + 4000), null, 'no message outstays its limit');
});

test('a save error silences every message; a pending save lets only the confirmation through', () => {
  const b = new NoticeBoard();
  b.post(note('stage'), 0);
  assert.equal(b.setBlock('error'), true, 'the message on screen goes');
  assert.equal(b.at(1), null);
  for (const kind of ['saved', 'stage', 'info', 'mission']) assert.equal(b.post(note(kind), 2), 'dropped');
  b.setBlock('none');
  assert.equal(b.post(note('stage'), 3), 'show');
  b.setBlock('pending');
  assert.equal(b.at(3).kind, 'stage', 'a message already up stays when a save becomes pending');
  assert.equal(b.post(note('mission'), 4), 'dropped');
  assert.equal(b.post(note('info'), 4), 'dropped');
  assert.equal(b.post(note('saved'), 4), 'show');
});

test('waiting messages expire and the queue is bounded', () => {
  const b = new NoticeBoard({ limit: 2, ttl: 1000 });
  b.post(note('stage', 'now'), 0);
  assert.equal(b.post(note('mission', 'a'), 1), 'queued');
  assert.equal(b.post(note('mission', 'b'), 2), 'queued');
  assert.equal(b.post(note('mission', 'c'), 3), 'queued', 'a full queue makes room by dropping the lowest, oldest');
  assert.deepEqual(b.queue.map((n) => n.message), ['b', 'c']);
  assert.equal(b.at(5000), null, 'by the time the slot frees, stale messages are gone');
});

test('the journey already toasts entering the home and the light: no second mission toast for them', () => {
  assert.equal(missionToastSuppressed({ event: 'enter_house', journeyActive: true }), true);
  assert.equal(missionToastSuppressed({ event: 'light_on', journeyActive: true }), true);
  assert.equal(missionToastSuppressed({ event: 'sit', journeyActive: true }), false, 'other actions keep their toast');
  assert.equal(missionToastSuppressed({ event: 'enter_house', journeyActive: false }), false, 'after the journey they come back');
});
