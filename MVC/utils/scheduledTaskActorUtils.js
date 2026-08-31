'use strict';

function cleanText(value, max = 200) {
  const text = String(value || '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function resolveUserDisplayName(user = {}) {
  const preferred = cleanText(user?.identity?.displayName);
  if (preferred) return preferred;
  if (typeof user?.displayName === 'string' && user.displayName.trim()) return user.displayName.trim();
  if (user?.name && typeof user.name === 'object') {
    const full = [user.name.first, user.name.last].filter(Boolean).join(' ').trim();
    if (full) return full;
  }
  if (typeof user?.name === 'string' && user.name.trim()) return user.name.trim();
  return cleanText(user?.username || user?.email || user?.id || 'Unknown user', 200);
}

function resolveActorFromUser(user = null) {
  if (!user) {
    return { userId: 'SYSTEM', displayName: 'System' };
  }
  return {
    userId: cleanText(user.id || user._id || user.userId || 'SYSTEM', 120) || 'SYSTEM',
    displayName: resolveUserDisplayName(user)
  };
}

function resolveSystemActor() {
  return { userId: 'SYSTEM', displayName: 'System' };
}

function resolveOrganizerFields(source = {}, fallback = {}) {
  const userId = cleanText(source.organizedByUserId || source.createdByUserId || fallback.userId, 120);
  const displayName = cleanText(
    source.organizedByDisplayName || source.createdByDisplayName || fallback.displayName,
    200
  );
  return {
    organizedByUserId: userId || 'SYSTEM',
    organizedByDisplayName: displayName || 'System'
  };
}

module.exports = {
  resolveActorFromUser,
  resolveSystemActor,
  resolveOrganizerFields,
  resolveUserDisplayName
};
