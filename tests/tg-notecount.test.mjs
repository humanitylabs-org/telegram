// telegram#33: the Notifications tab number counts every listed notification, read or not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { noteCount } from '../web/tg-view.js';

const host = items => ({ notes: { items: () => items } });

test('counts read and unread notifications alike', () => {
  assert.equal(noteCount(host([{ id: 'a', read: true }, { id: 'b', read: true }, { id: 'c', read: false }])), 3);
});

test('archived and id-less items are not listed, so not counted', () => {
  assert.equal(noteCount(host([{ id: 'a', archived: true }, { read: false }, { id: 'b', read: true }])), 1);
});

test('no notes host counts zero', () => {
  assert.equal(noteCount({}), 0);
});
