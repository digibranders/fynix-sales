/** Rules for the pop-up that shows messages from the admin. Pure, so they can be tested without a page. */
import type { Message } from './types.js';

/** What is on screen right now that a pop-up must not interrupt. */
export interface Busy {
  /** A modal or sheet is open. */
  modal: boolean;
  /** The person is typing in a field. */
  typing: boolean;
  /** The filter drawer is open. */
  drawer: boolean;
  /** An assign request is in flight. */
  working: boolean;
  /** A dropdown or menu is open. */
  menu: boolean;
  /** The tab is in the background. */
  hidden: boolean;
}

/** The messages still unread, oldest first, so they are read in the order they were sent. */
export function unreadMessages(messages: Message[], read: Record<string, boolean>): Message[] {
  return messages.filter((m) => !read[m.id]).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** True when nothing is in the way, so an unread message may pop up now. */
export function canPop(busy: Busy): boolean {
  return !(busy.modal || busy.typing || busy.drawer || busy.working || busy.menu || busy.hidden);
}
