import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canPop, unreadMessages } from '../web-src/sales/popup.js';
import type { Busy } from '../web-src/sales/popup.js';
import type { Message } from '../web-src/sales/types.js';

const msg = (id: string, at: number): Message => ({ id, subject: id, body: '', at });
const free: Busy = { modal: false, typing: false, drawer: false, working: false, menu: false, hidden: false };

describe('which admin message pops up', () => {
  it('lists unread messages oldest first, and skips the ones already read', () => {
    const list = [msg('a:3', 300), msg('a:1', 100), msg('a:2', 200)];
    assert.deepEqual(unreadMessages(list, {}).map((m) => m.id), ['a:1', 'a:2', 'a:3']);
    assert.deepEqual(unreadMessages(list, { 'a:1': true }).map((m) => m.id), ['a:2', 'a:3']);
    assert.deepEqual(unreadMessages(list, { 'a:1': true, 'a:2': true, 'a:3': true }), []);
  });

  it('does not change the list it was given', () => {
    const list = [msg('a:2', 200), msg('a:1', 100)];
    unreadMessages(list, {});
    assert.deepEqual(list.map((m) => m.id), ['a:2', 'a:1']);
  });

  it('keeps a steady order for messages sent in the same millisecond', () => {
    const list = [msg('a:b', 100), msg('a:a', 100)];
    assert.deepEqual(unreadMessages(list, {}).map((m) => m.id), ['a:a', 'a:b']);
  });

  it('handles no messages at all', () => {
    assert.deepEqual(unreadMessages([], {}), []);
  });

  it('pops up only when nothing is in the way', () => {
    assert.equal(canPop(free), true);
    for (const key of Object.keys(free) as (keyof Busy)[]) {
      assert.equal(canPop({ ...free, [key]: true }), false, `${key} blocks it`);
    }
  });
});
