const DEFAULT_CHAT_MESSAGE_PAGE_SIZE = 50;
const MAX_CHAT_MESSAGE_PAGE_SIZE = 100;

function normalizePageLimit(limit) {
    const parsed = Number.parseInt(String(limit ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CHAT_MESSAGE_PAGE_SIZE;
    return Math.min(parsed, MAX_CHAT_MESSAGE_PAGE_SIZE);
}

function messageSortKey(message) {
    const timestamp = new Date(message?.timestamp || message?.sentAt || 0).getTime();
    const id = String(message?.id || '');
    return { timestamp, id };
}

function sortMessagesAscending(messages) {
    return [...messages].sort((left, right) => {
        const leftKey = messageSortKey(left);
        const rightKey = messageSortKey(right);
        if (leftKey.timestamp !== rightKey.timestamp) return leftKey.timestamp - rightKey.timestamp;
        return leftKey.id.localeCompare(rightKey.id);
    });
}

/**
 * Returns the newest page of messages, or older messages before a cursor id.
 */
function paginateChatMessages(messages, options = {}) {
    const limit = normalizePageLimit(options.limit);
    const beforeId = options.before ? String(options.before) : '';
    const sorted = sortMessagesAscending(messages);

    let window = sorted;
    if (beforeId) {
        const beforeIndex = sorted.findIndex((message) => String(message?.id) === beforeId);
        window = beforeIndex > 0 ? sorted.slice(0, beforeIndex) : [];
    }

    const hasMore = window.length > limit;
    const page = window.slice(-limit);
    const oldestId = page.length > 0 ? String(page[0].id) : null;

    return {
        messages: page,
        hasMore,
        oldestId
    };
}

module.exports = {
    DEFAULT_CHAT_MESSAGE_PAGE_SIZE,
    MAX_CHAT_MESSAGE_PAGE_SIZE,
    normalizePageLimit,
    paginateChatMessages
};
