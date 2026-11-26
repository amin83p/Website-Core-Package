'use strict';

const WORD_TYPE_ICONS = Object.freeze({
  noun: 'bi-journal-bookmark',
  verb: 'bi-lightning-charge',
  adjective: 'bi-palette',
  adverb: 'bi-signpost-split',
  prefix: 'bi-link-45deg',
  suffix: 'bi-link-45deg',
  phrase: 'bi-chat-quote',
  other: 'bi-tag'
});

const DIFFICULTY_ICONS = Object.freeze({
  easy: 'bi-emoji-smile',
  medium: 'bi-speedometer2',
  hard: 'bi-fire'
});

function wordTypeIcon(key) {
  const token = String(key || '').trim().toLowerCase();
  return WORD_TYPE_ICONS[token] || WORD_TYPE_ICONS.other;
}

function difficultyIcon(key) {
  const token = String(key || '').trim().toLowerCase();
  return DIFFICULTY_ICONS[token] || DIFFICULTY_ICONS.medium;
}

module.exports = {
  WORD_TYPE_ICONS,
  DIFFICULTY_ICONS,
  wordTypeIcon,
  difficultyIcon
};