#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const UNIT_START_PAGES = [
  2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62, 66, 70, 74, 78, 82, 86, 90, 94
];

const UNITS = [
  { title: 'Small Talk', topic: 'Greetings', skills: ['Listening for greetings and introductions', 'Listening for topics', 'Listening for attitudes', 'Listening and making inferences', 'Listening and making predictions'], pronunciation: 'Reduction of h in he, him, his, her', conversation: 'Seeing someone you know' },
  { title: 'Plans', topic: 'The weekend', skills: ['Listening for details', 'Listening for plans', 'Listening for attitudes'], pronunciation: 'Intonation of tag questions', conversation: 'Making weekend plans' },
  { title: 'Successful Businesses', topic: 'Qualities of a good business', skills: ['Listening for gist', 'Listening for jobs', 'Listening for details'], pronunciation: 'Word stress in complaints', conversation: 'Making complaints' },
  { title: 'Apologies and Excuses', topic: 'Explanations', skills: ['Listening for reasons', 'Listening for details'], pronunciation: 'Intonation of yes/no and Wh- questions', conversation: 'Asking for reasons' },
  { title: 'Character Traits', topic: 'People', skills: ['Listening for gist', 'Listening for praise or criticism', 'Listening for details'], pronunciation: 'Linking vowel sounds', conversation: 'Talking about people' },
  { title: 'Travel', topic: 'Schedules', skills: ['Listening for gist', 'Listening for details'], pronunciation: 'Reduction of to', conversation: 'Travel stories' },
  { title: 'Housing', topic: 'Types of housing', skills: ['Listening for gist', 'Listening for negative information', 'Listening for details'], pronunciation: 'Reduction of is and are', conversation: 'Talking about your home' },
  { title: 'Can You Believe It?', topic: 'Unusual news stories', skills: ['Listening for gist', 'Listening for details', 'Listening for topics'], pronunciation: 'Intonation of complex sentences', conversation: 'Telling stories' },
  { title: 'Friendship', topic: 'Invitations', skills: ['Listening for gist', 'Listening for details'], pronunciation: 'Word stress for emphasis', conversation: 'Describing people' },
  { title: 'Television', topic: 'TV programs', skills: ['Listening for topics', 'Listening for gist', 'Listening for details', 'Listening for agreement and disagreement'], pronunciation: 'Rising and falling intonation for positive and negative statements', conversation: 'Giving opinions' },
  { title: 'Cities', topic: 'Travel', skills: ['Listening for details', 'Listening for gist'], pronunciation: 'Reduction of have to, got to, and had to', conversation: 'Talking about a vacation' },
  { title: 'Urban Life', topic: 'City improvements', skills: ['Listening for topics', 'Listening for gist', 'Listening for details', 'Listening for suggestions'], pronunciation: 'Reduction of used to and use to', conversation: 'Talking about cities' },
  { title: 'Special Days', topic: 'Celebrations', skills: ['Listening for details', 'Listening for gist'], pronunciation: 'Intonation of who, what, when, where, why, and how questions', conversation: 'Talking about a holiday' },
  { title: 'Fashion', topic: 'Clothes', skills: ['Listening for gist', 'Listening for negative information'], pronunciation: 'Consonant clusters', conversation: 'Talking about clothes' },
  { title: 'Favorites', topic: 'Favorites', skills: ['Listening for gist', 'Listening for details'], pronunciation: 'Reduction of like for, want to, and going to', conversation: 'Talking about favorites' },
  { title: 'Phone Messages', topic: 'Messages', skills: ['Listening for gist', 'Listening for topics', 'Listening for details'], pronunciation: 'Word stress for emphasis', conversation: 'Taking phone messages' },
  { title: 'Past Events', topic: 'Childhood memories', skills: ['Listening for details', 'Listening for gist'], pronunciation: 'Reduction of did', conversation: 'Talking about the past' },
  { title: 'Vacations', topic: 'Vacation jobs', skills: ['Listening for gist', 'Listening for details'], pronunciation: 'Linking sounds: verb/tense ending + vowel', conversation: 'Talking about summer' },
  { title: 'The News', topic: 'News stories', skills: ['Listening for gist', 'Listening for details', 'Listening for topics'], pronunciation: 'Intonation of who, what, when, where, why, and how in tag questions', conversation: 'Describing an accident' },
  { title: 'Opinions', topic: 'Opinions', skills: ['Listening for gist', 'Listening for agreement and disagreement'], pronunciation: 'Sentence stress in responses', conversation: 'Agreeing and disagreeing' },
  { title: 'Famous People', topic: 'People', skills: ['Listening for gist', 'Listening for opinions'], pronunciation: 'Intonation of surprise', conversation: 'Talking about celebrities' },
  { title: 'Food and Nutrition', topic: 'Food', skills: ['Listening for gist', 'Listening for details'], pronunciation: 'Intonation of imperatives', conversation: 'Talking about food' },
  { title: 'Predicaments', topic: 'Accidents', skills: ['Listening for gist', 'Listening for details', 'Listening for reasons'], pronunciation: 'Reduction of can and could', conversation: 'Helping someone' },
  { title: 'Global Issues', topic: 'Current events', skills: ['Listening for gist', 'Listening for details', 'Listening and making inferences'], pronunciation: 'Linking sounds: consonant + vowel', conversation: 'Discussing global issues' }
];

function unitEndPage(index) {
  if (index < UNIT_START_PAGES.length - 1) return UNIT_START_PAGES[index + 1] - 1;
  return 97;
}

function buildUnit(index, unit) {
  const start = UNIT_START_PAGES[index];
  const end = unitEndPage(index);
  return {
    level: 'H2',
    unit_number: index + 1,
    title: unit.title,
    start_page: start,
    end_page: end,
    subheadings: [
      { level: 'H3', category: 'Topic', title: unit.topic, start_page: start, end_page: end },
      {
        level: 'H3',
        category: 'Listening Skills',
        start_page: start,
        end_page: end,
        items: unit.skills.map((title) => ({ level: 'H4', title, start_page: start, end_page: end }))
      },
      { level: 'H3', category: 'Pronunciation & Dictation', title: unit.pronunciation, start_page: start, end_page: end },
      { level: 'H3', category: 'Conversation', title: unit.conversation, start_page: start, end_page: end }
    ]
  };
}

const testingBlocks = [
  { units: '1 – 4', page: 98, focus: 'Picture-based questions', skill: 'Predicting' },
  { units: '5 – 8', page: 100, focus: 'Making inferences', skill: 'Making inferences' },
  { units: '9 – 12', page: 102, focus: 'Question-focused listening', skill: 'Previewing questions' },
  { units: '13 – 16', page: 104, focus: 'Conversation-based questions', skill: 'Taking notes' },
  { units: '17 – 20', page: 106, focus: 'Negatives in questions and answer choices', skill: 'Reading questions carefully' },
  { units: '21 – 24', page: 108, focus: 'Listening for organization', skill: 'Listening for transitions' }
];

const source = {
  book_title: 'Expanding Tactics for Listening',
  table_of_contents: [
    {
      level: 'H1',
      title: 'Units 1–24',
      start_page: 2,
      end_page: 97,
      children: UNITS.map((unit, index) => buildUnit(index, unit))
    },
    {
      level: 'H1',
      title: 'Tactics for Testing',
      start_page: 98,
      end_page: 108,
      sections: testingBlocks.map((block) => ({
        level: 'H2',
        title: `Units ${block.units}`,
        start_page: block.page,
        end_page: block.page + 1,
        subheadings: [
          { level: 'H3', category: 'Testing Focus', title: block.focus, start_page: block.page, end_page: block.page + 1 },
          { level: 'H3', category: 'Test-taking Skill', title: block.skill, start_page: block.page, end_page: block.page + 1 }
        ]
      }))
    },
    {
      level: 'H1',
      title: 'Back Matter',
      start_page: 110,
      end_page: 110,
      sections: [
        { level: 'H2', title: 'Vocabulary Index', start_page: 110, end_page: 110 }
      ]
    }
  ]
};

const outPath = path.join(__dirname, '../../data/school/book-toc-sources/expanding-tactics-for-listening-3e.json');
fs.writeFileSync(outPath, JSON.stringify(source, null, 2));
console.log('Wrote', outPath);
