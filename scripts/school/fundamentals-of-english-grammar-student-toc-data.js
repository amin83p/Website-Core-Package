'use strict';

/** Printed start pages from Fundamentals of English Grammar (5th ed.) student book contents. */
const CHAPTERS = [
  { num: 1, title: 'Present Time', start: 1, sections: [
    ['1-1', 'Simple Present and Present Progressive', 2],
    ['1-2', 'Forms of the Simple Present and the Present Progressive', 2],
    ['1-3', 'Singular/Plural', 9],
    ['1-4', 'Spelling of Simple Present Verbs: Final -s/-es', 11],
    ['1-5', 'Frequency Adverbs', 14],
    ['1-6', 'Verbs Not Usually Used in the Progressive', 18],
    ['1-7', 'Present Verbs: Short Answers to Yes/No Questions', 21]
  ]},
  { num: 2, title: 'Past Time', start: 30, sections: [
    ['2-1', 'The Simple Past: Regular Verbs', 31],
    ['2-2', 'Expressing Past Time: The Simple Past, Irregular Verbs', 32],
    ['2-3', 'Common Irregular Verbs: A Reference List', 33],
    ['2-4', 'Recognizing Verb Endings and Questions with Did', 40],
    ['2-5', 'Spelling of -ing and -ed Forms', 43],
    ['2-6', 'The Past Progressive', 46],
    ['2-7', 'Simple Past vs. Past Progressive', 50],
    ['2-8', 'Expressing Past Time: Using Time Clauses', 57],
    ['2-9', 'Expressing Past Habit: Used To', 60]
  ]},
  { num: 3, title: 'Future Time', start: 64, sections: [
    ['3-1', 'Expressing Future Time: Be Going To and Will', 65],
    ['3-2', 'Forms with Be Going To', 66],
    ['3-3', 'Forms with Will', 69],
    ['3-4', 'Be Going To and Will in Spoken English', 71],
    ['3-5', 'Be Going To vs. Will', 73],
    ['3-6', 'Certainty About the Future', 77],
    ['3-7', 'Expressing the Future in Time Clauses and If-Clauses', 80],
    ['3-8', 'Using the Present Progressive to Express Future Time', 83],
    ['3-9', 'Using the Simple Present to Express Future Time', 85],
    ['3-10', 'Immediate Future: Using Be About To', 86],
    ['3-11', 'Parallel Verbs', 87]
  ]},
  { num: 4, title: 'Present Perfect and Past Perfect', start: 91, sections: [
    ['4-1', 'Past Participle', 92],
    ['4-2', 'Introduction to the Present Perfect: Unspecified Time with Ever and Never', 94],
    ['4-3', 'The Present Perfect with Unspecified Time: Already, Yet, Just, Recently', 96],
    ['4-4', 'Present Perfect with Since and For', 99],
    ['4-5', 'Simple Past vs. Present Perfect', 104],
    ['4-6', 'Present Perfect Progressive', 108],
    ['4-7', 'Present Perfect Progressive vs. Present Perfect', 110],
    ['4-8', 'Past Perfect', 116]
  ]},
  { num: 5, title: 'Asking Questions', start: 121, sections: [
    ['5-1', 'Yes/No Questions and Short Answers', 122],
    ['5-2', 'Where, Why, When, What Time, How Come, What ... For', 125],
    ['5-3', 'Questions With Who, Whom, and What', 128],
    ['5-4', 'Using What + a Form of Do', 131],
    ['5-5', 'Which vs. What and What Kind Of', 133],
    ['5-6', 'Using How', 135],
    ['5-7', 'Using How Often / How Many Times', 138],
    ['5-8', 'Talking About Distance', 140],
    ['5-9', 'Length of Time: It + Take and How Long; How Many', 141],
    ['5-10', 'Spoken and Written Contractions with Question Words', 143],
    ['5-11', 'More Questions with How', 146],
    ['5-12', 'Using How About and What About', 147],
    ['5-13', 'Tag Questions', 149]
  ]},
  { num: 6, title: 'Nouns and Pronouns', start: 157, sections: [
    ['6-1', 'Plural Forms of Nouns', 158],
    ['6-2', 'Pronunciation of Final -s/-es', 160],
    ['6-3', 'Subjects, Verbs, and Objects', 162],
    ['6-4', 'Objects of Prepositions', 164],
    ['6-5', 'Prepositions of Time', 167],
    ['6-6', 'Word Order: Place and Time', 168],
    ['6-7', 'Subject-Verb Agreement', 169],
    ['6-8', 'Using Adjectives to Describe Nouns', 171],
    ['6-9', 'Using Nouns as Adjectives', 173],
    ['6-10', 'Personal Pronouns: Subjects and Objects', 175],
    ['6-11', 'Possessive Nouns', 178],
    ['6-12', 'Using Whose', 180],
    ['6-13', 'Possessive Pronouns and Adjectives', 181],
    ['6-14', 'Reflexive Pronouns', 183],
    ['6-15', 'Singular Forms of Other: Another vs. The Other', 184],
    ['6-16', 'Plural Forms of Other: Other(s) vs. The Other(s)', 186],
    ['6-17', 'Summary: Forms of Other', 188]
  ]},
  { num: 7, title: 'Modal Auxiliaries, the Imperative, Making Suggestions, Stating Preferences', start: 193, sections: [
    ['7-1', 'Introduction to Modal Auxiliaries', 194],
    ['7-2', 'Expressing Ability: Can, Could, Be Able To', 195],
    ['7-3', 'Expressing Possibility: May, Might, and Maybe; Expressing Permission: May and Can', 198],
    ['7-4', 'Using Could to Express Possibility', 200],
    ['7-5', 'Polite Requests with I: May, Could, Can', 202],
    ['7-6', 'Polite Requests with You: Would, Could, Will, Can', 205],
    ['7-7', 'Expressing Advice: Should and Ought To', 207],
    ['7-8', 'Expressing Advice: Had Better', 209],
    ['7-9', 'Expressing Necessity: Have To, Have Got To, Must', 210],
    ['7-10', 'Expressing Lack of Necessity: Do Not Have To; Expressing Prohibition: Must Not', 214],
    ['7-11', 'Making Logical Conclusions: Must', 215],
    ['7-12', 'Tag Questions with Modal Auxiliaries', 218],
    ['7-13', 'Imperative Sentences: Giving Instructions', 219],
    ['7-14', "Making Suggestions: Let's and Why Don't", 221],
    ['7-15', 'Stating Preferences: Prefer, Like ... Better, Would Rather', 222],
    ['7-16', 'Summary: Modal Auxiliaries Taught in Chapter 7', 224]
  ]},
  { num: 8, title: 'Connecting Ideas: Punctuation and Meaning', start: 228, sections: [
    ['8-1', 'Connecting Ideas with And', 229],
    ['8-2', 'Connecting Ideas with But and Or', 231],
    ['8-3', 'Connecting Ideas with So', 232],
    ['8-4', 'Using Auxiliary Verbs After But', 234],
    ['8-5', 'Using And + Too, So, Either, Neither', 236],
    ['8-6', 'Connecting Ideas with Because', 241],
    ['8-7', 'Connecting Ideas with Even Though/Although', 244]
  ]},
  { num: 9, title: 'Comparisons', start: 250, sections: [
    ['9-1', 'Introduction to Comparative Forms of Adjectives', 251],
    ['9-2', 'Introduction to Superlative Forms of Adjectives', 255],
    ['9-3', 'Completing Comparatives and Superlatives', 258],
    ['9-4', 'Making Comparisons with Adverbs', 262],
    ['9-5', 'Repeating a Comparative; Using Double Comparatives', 264],
    ['9-6', 'Modifying Comparatives with Adjectives and Adverbs', 266],
    ['9-7', 'Negative Comparisons', 267],
    ['9-8', 'Using As ... As to Make Comparisons', 268],
    ['9-9', 'Using Less ... Than and Not As ... As', 272],
    ['9-10', 'Using More with Nouns', 274],
    ['9-11', 'Using The Same, Similar, Different, Like, Alike', 276]
  ]},
  { num: 10, title: 'The Passive', start: 282, sections: [
    ['10-1', 'Active and Passive Sentences', 283],
    ['10-2', 'Forming the Passive', 283],
    ['10-3', 'Progressive Forms of the Passive', 287],
    ['10-4', 'Transitive and Intransitive Verbs', 290],
    ['10-5', 'Using the by-Phrase', 292],
    ['10-6', 'Passive Modal Auxiliaries', 296],
    ['10-7', 'Past Participles as Adjectives (Stative or Non-Progressive Passive)', 298],
    ['10-8', 'Participial Adjectives: -ed vs. -ing', 302],
    ['10-9', 'Get + Adjective; Get + Past Participle', 305],
    ['10-10', 'Using Be Used/Accustomed To and Get Used/Accustomed To', 308],
    ['10-11', 'Used To vs. Be Used To', 310],
    ['10-12', 'Using Be Supposed To', 312]
  ]},
  { num: 11, title: 'Count/Noncount Nouns and Articles', start: 315, sections: [
    ['11-1', 'A vs. An', 316],
    ['11-2', 'Count and Noncount Nouns', 317],
    ['11-3', 'Noncount Nouns', 318],
    ['11-4', 'More Noncount Nouns', 320],
    ['11-5', 'Using A Lot Of, Some, Several, Many/Much, and A Few/A Little', 322],
    ['11-6', 'Nouns That Can Be Count or Noncount', 325],
    ['11-7', 'Using Units of Measure with Noncount Nouns', 328],
    ['11-8', 'Articles with Count and Noncount Nouns: A/An, The, Ø', 330],
    ['11-9', 'More About Articles', 332],
    ['11-10', 'Using The or Ø with People and Places', 337],
    ['11-11', 'Capitalization', 339]
  ]},
  { num: 12, title: 'Adjective Clauses', start: 344, sections: [
    ['12-1', 'Adjective Clauses: Introduction', 345],
    ['12-2', 'Using Who and That in Adjective Clauses to Describe People', 346],
    ['12-3', 'Using Object Pronouns in Adjective Clauses to Describe People', 349],
    ['12-4', 'Using Pronouns in Adjective Clauses to Describe Things', 353],
    ['12-5', 'Singular and Plural Verbs in Adjective Clauses', 358],
    ['12-6', 'Using Prepositions in Adjective Clauses', 359],
    ['12-7', 'Using Whose in Adjective Clauses', 362]
  ]},
  { num: 13, title: 'Gerunds and Infinitives', start: 369, sections: [
    ['13-1', 'Verb + Gerund', 370],
    ['13-2', 'Go + -ing', 372],
    ['13-3', 'Verb + Infinitive', 374],
    ['13-4', 'Verb + Gerund or Infinitive', 375],
    ['13-5', 'Preposition + Gerund', 380],
    ['13-6', 'Using By and With to Express How Something Is Done', 383],
    ['13-7', 'Using Gerunds as Subjects; Using It + Infinitive', 386],
    ['13-8', 'It + Infinitive: Using For (Someone)', 388],
    ['13-9', 'Expressing Purpose with In Order To and For', 391],
    ['13-10', 'Using Infinitives with Too and Enough', 394]
  ]},
  { num: 14, title: 'Noun Clauses', start: 400, sections: [
    ['14-1', 'Noun Clauses: Introduction', 401],
    ['14-2', 'Noun Clauses That Begin with a Question Word', 402],
    ['14-3', 'Noun Clauses That Begin with If or Whether', 406],
    ['14-4', 'Noun Clauses That Begin with That', 410],
    ['14-5', 'Other Uses of That-Clauses', 411],
    ['14-6', 'Substituting So for a That-Clause in Conversational Responses', 414],
    ['14-7', 'Quoted Speech', 416],
    ['14-8', 'Quoted Speech vs. Reported Speech', 418],
    ['14-9', 'Verb Forms in Reported Speech', 419],
    ['14-10', 'Common Reporting Verbs: Tell, Ask, Answer/Reply', 421]
  ]}
];

const APPENDIX = [
  ['A-1', 'The Principal Parts of a Verb', 429],
  ['A-2', 'Common Irregular Verbs: A Reference List', 430],
  ['A-3', 'The Present Perfect vs. The Past Perfect', 431],
  ['A-4', 'The Past Progressive vs. The Past Perfect', 431],
  ['A-5', 'Regular Verbs: Pronunciation of -ed Endings', 432],
  ['A-6', 'Pronunciation of Final -s/-es for Verbs and Nouns', 432],
  ['A-7', 'Review: Subject and Object Pronouns, Possessive Pronouns, and Possessive Adjectives', 433],
  ['A-8', 'Comparison of Yes/No and Information Question Forms', 433],
  ['B-1', 'Phrasal Verbs', 434],
  ['B-2', 'Phrasal Verbs: A Reference List', 435],
  ['C-1', 'Preposition Combinations: Introduction', 437],
  ['C-2', 'Preposition Combinations: A Reference List', 437]
];

function buildFundamentalsStudentTocLabels() {
  const rows = [
    { level: 1, label: 'Front Matter', startPage: 10 },
    { level: 2, label: 'Preface to the Fifth Edition', startPage: 10 },
    { level: 2, label: 'Acknowledgments', startPage: 12 },
    { level: 2, label: 'Getting Started', startPage: 13 },
    { level: 1, label: 'Main Chapters', startPage: 1 }
  ];

  for (const ch of CHAPTERS) {
    rows.push({ level: 2, label: `Chapter ${ch.num}: ${ch.title}`, startPage: ch.start });
    for (const [num, title, page] of ch.sections) {
      rows.push({ level: 3, label: `${num} ${title}`, startPage: page });
    }
  }

  rows.push({ level: 1, label: 'Appendix: Supplementary Grammar Charts', startPage: 429 });
  for (const [num, title, page] of APPENDIX) {
    rows.push({ level: 2, label: `${num} ${title}`, startPage: page });
  }

  rows.push(
    { level: 1, label: 'Listening Script', startPage: 439 },
    { level: 1, label: 'Trivia Answers', startPage: 449 },
    { level: 1, label: 'Index', startPage: 451 },
    { level: 1, label: 'Credits', startPage: 462 }
  );

  return rows;
}

module.exports = { buildFundamentalsStudentTocLabels, CHAPTERS };
