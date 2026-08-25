'use strict';

const DEFAULT_MIN_SCORE = 60;
const DEFAULT_MATCH_LIMIT = 10;
const EXACT_MATCH_SCORE = 100;

function normalizeNamePart(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function readNamePart(source = {}, key = '') {
  return String(
    source?.[key]
    || source?.name?.[key]
    || source?.[`${key}Name`]
    || ''
  ).trim();
}

function buildFullNameVariants(profile = {}) {
  const first = normalizeNamePart(profile.firstName);
  const last = normalizeNamePart(profile.lastName);
  const middle = normalizeNamePart(profile.middleName);
  const preferred = normalizeNamePart(profile.preferredName);
  const variants = new Set();
  if (first && last) variants.add(`${first} ${last}`);
  if (preferred && last) variants.add(`${preferred} ${last}`);
  if (first && middle && last) variants.add(`${first} ${middle} ${last}`);
  return [...variants].filter(Boolean);
}

function buildComparablePersonProfile(person = {}) {
  const personId = String(person.personId || person.id || '').trim();
  const firstName = readNamePart(person, 'first');
  const lastName = readNamePart(person, 'last');
  const middleName = readNamePart(person, 'middle');
  const preferredName = readNamePart(person, 'preferred');
  const displayName = String(
    person.displayName
    || [firstName, lastName].filter(Boolean).join(' ')
    || (typeof person.name === 'string' ? person.name : '')
    || personId
  ).trim();

  const emails = Array.isArray(person.contact?.emails) ? person.contact.emails : [];
  const email = normalizeEmail(
    person.email
    || person.contact?.email
    || person.contact?.primaryEmail
    || emails[0]?.email
  );

  const phones = Array.isArray(person.contact?.phones) ? person.contact.phones : [];
  const phone = normalizePhone(
    person.phone
    || person.contact?.phone
    || phones[0]?.number
  );

  const dateOfBirth = normalizeDateOnly(
    person.dateOfBirth
    || person.demographics?.dateOfBirth
  );

  return {
    personId,
    displayName,
    firstName,
    lastName,
    middleName,
    preferredName,
    email,
    phone,
    dateOfBirth,
    fullNameVariants: buildFullNameVariants({
      firstName,
      lastName,
      middleName,
      preferredName
    })
  };
}

function buildCandidateProfile(candidate = {}) {
  return buildComparablePersonProfile({
    id: candidate.excludePersonId || '',
    personId: candidate.excludePersonId || '',
    name: {
      first: candidate.firstName,
      middle: candidate.middleName,
      last: candidate.lastName,
      preferred: candidate.preferredName
    },
    email: candidate.email,
    phone: candidate.phone,
    dateOfBirth: candidate.dateOfBirth
  });
}

function levenshteinDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[left.length][right.length];
}

function stringSimilarity(a, b) {
  const left = normalizeNamePart(a);
  const right = normalizeNamePart(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const maxLen = Math.max(left.length, right.length);
  if (!maxLen) return 0;
  const distance = levenshteinDistance(left, right);
  return Math.max(0, 1 - (distance / maxLen));
}

function bestVariantSimilarity(leftVariants = [], rightVariants = []) {
  let best = 0;
  leftVariants.forEach((left) => {
    rightVariants.forEach((right) => {
      const score = stringSimilarity(left, right);
      if (score > best) best = score;
    });
  });
  return best;
}

function isExactNameMatch(candidate = {}, existing = {}) {
  const first = normalizeNamePart(candidate.firstName);
  const last = normalizeNamePart(candidate.lastName);
  const existingFirst = normalizeNamePart(existing.firstName);
  const existingLast = normalizeNamePart(existing.lastName);
  return Boolean(first && last && first === existingFirst && last === existingLast);
}

function buildNameDifferenceReason(candidate = {}, existing = {}) {
  const firstScore = stringSimilarity(candidate.firstName, existing.firstName);
  const lastScore = stringSimilarity(candidate.lastName, existing.lastName);
  if (lastScore >= 0.9 && firstScore >= 0.9) {
    const lastDistance = levenshteinDistance(
      normalizeNamePart(candidate.lastName),
      normalizeNamePart(existing.lastName)
    );
    if (lastDistance === 1) return 'Last name is 1 character different';
    if (firstDistanceReason(candidate, existing)) return firstDistanceReason(candidate, existing);
    return 'Names are very similar';
  }
  if (lastScore >= 0.85) return 'Last name is similar';
  if (firstScore >= 0.85) return 'First name is similar';
  return 'Name is similar';
}

function firstDistanceReason(candidate = {}, existing = {}) {
  const distance = levenshteinDistance(
    normalizeNamePart(candidate.firstName),
    normalizeNamePart(existing.firstName)
  );
  if (distance === 1) return 'First name is 1 character different';
  return '';
}

function scorePersonSimilarity(candidateInput = {}, existingPerson = {}) {
  const candidate = buildCandidateProfile(candidateInput);
  const existing = buildComparablePersonProfile(existingPerson);

  if (!candidate.firstName || !candidate.lastName) {
    return { score: 0, matchType: 'none', reasons: [] };
  }
  if (!existing.firstName || !existing.lastName) {
    return { score: 0, matchType: 'none', reasons: [] };
  }

  if (isExactNameMatch(candidate, existing)) {
    const reasons = ['Exact first and last name'];
    if (candidate.email && existing.email && candidate.email === existing.email) {
      reasons.push('Same email');
    }
    return { score: EXACT_MATCH_SCORE, matchType: 'exact', reasons };
  }

  const fullNameScore = bestVariantSimilarity(candidate.fullNameVariants, existing.fullNameVariants);
  const firstScore = stringSimilarity(candidate.firstName, existing.firstName);
  const lastScore = stringSimilarity(candidate.lastName, existing.lastName);

  let score = Math.round(
    (fullNameScore * 55)
    + (firstScore * 20)
    + (lastScore * 20)
  );

  const reasons = [buildNameDifferenceReason(candidate, existing)];

  if (candidate.email && existing.email && candidate.email === existing.email) {
    score = Math.min(100, score + 15);
    reasons.push('Same email');
  }
  if (candidate.dateOfBirth && existing.dateOfBirth && candidate.dateOfBirth === existing.dateOfBirth) {
    score = Math.min(100, score + 10);
    reasons.push('Same date of birth');
  }
  if (candidate.phone && existing.phone && candidate.phone === existing.phone) {
    score = Math.min(100, score + 5);
    reasons.push('Same phone number');
  }

  return {
    score,
    matchType: score >= DEFAULT_MIN_SCORE ? 'similar' : 'none',
    reasons: [...new Set(reasons.filter(Boolean))]
  };
}

function rankSimilarPersons(candidateInput = {}, persons = [], options = {}) {
  const minScore = Math.max(0, Number(options.minScore ?? DEFAULT_MIN_SCORE) || DEFAULT_MIN_SCORE);
  const limit = Math.max(1, Number(options.limit ?? DEFAULT_MATCH_LIMIT) || DEFAULT_MATCH_LIMIT);
  const excludePersonId = String(options.excludePersonId || candidateInput.excludePersonId || '').trim();

  const matches = [];
  const seen = new Set();

  (Array.isArray(persons) ? persons : []).forEach((person) => {
    const profile = buildComparablePersonProfile(person);
    if (!profile.personId || (excludePersonId && profile.personId === excludePersonId)) return;

    const scored = scorePersonSimilarity(candidateInput, person);
    if (scored.matchType === 'none' || scored.score < minScore) return;
    if (seen.has(profile.personId)) return;
    seen.add(profile.personId);

    matches.push({
      personId: profile.personId,
      displayName: profile.displayName,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: person.email || profile.email || '',
      score: scored.score,
      matchType: scored.matchType,
      reasons: scored.reasons
    });
  });

  matches.sort((a, b) => {
    if (a.matchType === 'exact' && b.matchType !== 'exact') return -1;
    if (b.matchType === 'exact' && a.matchType !== 'exact') return 1;
    return b.score - a.score || String(a.displayName).localeCompare(String(b.displayName));
  });

  return matches.slice(0, limit);
}

function collectExactNameMatches(persons = [], firstName = '', lastName = '', limit = DEFAULT_MATCH_LIMIT) {
  const candidate = { firstName, lastName };
  return rankSimilarPersons(candidate, persons, {
    minScore: EXACT_MATCH_SCORE,
    limit,
    excludePersonId: ''
  }).filter((row) => row.matchType === 'exact');
}

module.exports = {
  DEFAULT_MIN_SCORE,
  DEFAULT_MATCH_LIMIT,
  EXACT_MATCH_SCORE,
  normalizeNamePart,
  normalizeEmail,
  normalizePhone,
  normalizeDateOnly,
  buildComparablePersonProfile,
  buildCandidateProfile,
  stringSimilarity,
  isExactNameMatch,
  scorePersonSimilarity,
  rankSimilarPersons,
  collectExactNameMatches
};
