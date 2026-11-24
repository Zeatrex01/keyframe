// The page's rules for keeping the conversation in step with the server. No DOM here, so a test
// can load it.

/** The poll fetches messages only when the server has one past the page's cursor. */
export const hasNewMessages = (state, cursor) => Number(state?.lastMessage ?? 0) > cursor;

/**
 * The cursor after a message is shown. Only a message read from the server moves it: the owner's
 * own message comes back from the send with an id that can be past an agent reply the page has not
 * read yet, and moving the cursor there would skip that reply.
 */
export const cursorAfter = (cursor, message, { fromPoll }) => (fromPoll ? Math.max(cursor, message.id) : cursor);

/** Where a message goes among the shown ones (their ids, in order), so the list stays in id order. */
export function insertAt(shownIds, id) {
  let i = shownIds.length;
  while (i > 0 && shownIds[i - 1] > id) i--;
  return i;
}
