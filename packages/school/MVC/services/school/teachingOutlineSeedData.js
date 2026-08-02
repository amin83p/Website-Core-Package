'use strict';

const { CLB_SKILLS } = require('../../models/school/studentModel');

const DEFAULT_LEVELS = Object.freeze([
  {
    code: 'pre_beginner_limited_ed',
    title: 'Pre-Beginner — Limited Prior Education',
    shortTitle: 'Pre-Beginner (Limited Ed.)',
    levelKind: 'pre_clb',
    sortOrder: 10,
    matchAliases: ['Pre-Beginner Limited', 'Pre Beginner Limited', 'Pre-Benchmark NO', 'pre_beginner_limited_ed']
  },
  {
    code: 'pre_beginner_prior_ed',
    title: 'Pre-Beginner — Prior Education',
    shortTitle: 'Pre-Beginner (Prior Ed.)',
    levelKind: 'pre_clb',
    sortOrder: 11,
    matchAliases: ['Pre-Beginner Prior', 'Pre Beginner Prior', 'Pre-Benchmark with Education', 'pre_beginner_prior_ed']
  },
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({
    code: `clb_${n}`,
    title: `CLB ${n}`,
    shortTitle: `CLB ${n}`,
    levelKind: 'benchmark',
    sortOrder: 100 + n,
    matchAliases: [`CLB ${n}`, `CLB${n}`, String(n), `clb_${n}`, `clb ${n}`]
  }))
]);

const DEFAULT_SECTION_TEMPLATES = Object.freeze({
  writing: [
    { key: 'benchmark_description', title: 'Description of Benchmark', isSelectable: false, allowsGroups: false, displayOrder: 1 },
    { key: 'client_profile', title: 'Client Profile', isSelectable: false, allowsGroups: false, displayOrder: 2 },
    { key: 'outcomes_general', title: 'General Writing Ability', isSelectable: true, allowsGroups: false, displayOrder: 3 },
    { key: 'outcomes_performance', title: 'Performance Conditions for Writing Tasks', isSelectable: true, allowsGroups: false, displayOrder: 4 },
    { key: 'grammar', title: 'Basic Grammatical Knowledge', isSelectable: true, allowsGroups: false, displayOrder: 5 },
    { key: 'tasks', title: 'Examples of Tasks', isSelectable: true, allowsGroups: true, displayOrder: 6 }
  ],
  listening: [
    { key: 'benchmark_description', title: 'Description of Benchmark', isSelectable: false, allowsGroups: false, displayOrder: 1 },
    { key: 'client_profile', title: 'Client Profile', isSelectable: false, allowsGroups: false, displayOrder: 2 },
    { key: 'outcomes_general', title: 'Listening Outcomes', isSelectable: true, allowsGroups: false, displayOrder: 3 },
    { key: 'outcomes_performance', title: 'Performance Conditions', isSelectable: true, allowsGroups: false, displayOrder: 4 },
    { key: 'strategies', title: 'Listening Strategies', isSelectable: true, allowsGroups: false, displayOrder: 5 },
    { key: 'tasks', title: 'Examples of Tasks', isSelectable: true, allowsGroups: true, displayOrder: 6 }
  ],
  speaking: [
    { key: 'benchmark_description', title: 'Description of Benchmark', isSelectable: false, allowsGroups: false, displayOrder: 1 },
    { key: 'client_profile', title: 'Client Profile', isSelectable: false, allowsGroups: false, displayOrder: 2 },
    { key: 'outcomes_general', title: 'Speaking Outcomes', isSelectable: true, allowsGroups: false, displayOrder: 3 },
    { key: 'outcomes_performance', title: 'Performance Conditions', isSelectable: true, allowsGroups: false, displayOrder: 4 },
    { key: 'pronunciation', title: 'Pronunciation and Fluency', isSelectable: true, allowsGroups: false, displayOrder: 5 },
    { key: 'interaction', title: 'Interaction Strategies', isSelectable: true, allowsGroups: false, displayOrder: 6 },
    { key: 'grammar', title: 'Basic Grammatical Knowledge', isSelectable: true, allowsGroups: false, displayOrder: 7 },
    { key: 'tasks', title: 'Examples of Tasks', isSelectable: true, allowsGroups: true, displayOrder: 8 }
  ],
  reading: [
    { key: 'benchmark_description', title: 'Description of Benchmark', isSelectable: false, allowsGroups: false, displayOrder: 1 },
    { key: 'client_profile', title: 'Client Profile', isSelectable: false, allowsGroups: false, displayOrder: 2 },
    { key: 'outcomes_general', title: 'Reading Outcomes', isSelectable: true, allowsGroups: false, displayOrder: 3 },
    { key: 'outcomes_performance', title: 'Performance Conditions', isSelectable: true, allowsGroups: false, displayOrder: 4 },
    { key: 'text_features', title: 'Text Features and Vocabulary', isSelectable: true, allowsGroups: false, displayOrder: 5 },
    { key: 'strategies', title: 'Reading Strategies', isSelectable: true, allowsGroups: false, displayOrder: 6 },
    { key: 'tasks', title: 'Examples of Tasks', isSelectable: true, allowsGroups: true, displayOrder: 7 }
  ]
});

function item(sectionKey, label, { itemKind = 'checklist', parentKey = null, order = 100, isSelectable } = {}) {
  return {
    sectionKey,
    parentKey,
    itemKind,
    label,
    displayOrder: order,
    isSelectable: isSelectable !== undefined ? isSelectable : itemKind === 'checklist',
    isActive: true
  };
}

function ref(sectionKey, label, order) {
  return item(sectionKey, label, { itemKind: 'reference', order, isSelectable: false });
}

function grp(sectionKey, label, order) {
  return item(sectionKey, label, { itemKind: 'group', order, isSelectable: false });
}

/** Writing outline items keyed by level code — sourced from Equilibrium PDFs */
const WRITING_ITEMS_BY_LEVEL = Object.freeze({
  pre_beginner_limited_ed: [
    ref('benchmark_description', 'Client can trace letters and numbers and copy short single words or phrases for personally relevant tasks.', 1),
    ref('client_profile', 'Has extremely limited or no vocabulary; has no knowledge of English spelling conventions.', 2),
    item('outcomes_performance', 'Context is personally relevant', 10),
    item('outcomes_performance', 'Trace letters and numbers', 11),
    item('outcomes_performance', 'Copy short single words or phrases with easy layout', 12),
    item('grammar', 'Simple Present Tense', 20),
    item('grammar', 'Articles: introduction', 21),
    item('grammar', 'Subject pronouns', 22),
    item('grammar', 'Object pronouns', 23),
    item('grammar', 'Singular nouns and plural nouns', 24),
    item('grammar', 'Adjectives with Be', 25),
    item('grammar', 'Imperatives', 26),
    grp('tasks', 'Tracing and copying', 30),
    item('tasks', 'Trace the letters of the alphabet in lowercase', 31, { parentKey: 'Tracing and copying' }),
    item('tasks', 'Trace the letters of the alphabet in uppercase', 32, { parentKey: 'Tracing and copying' }),
    item('tasks', 'Trace numbers 1-10 in groups', 33, { parentKey: 'Tracing and copying' }),
    item('tasks', 'Copy words from a picture dictionary into a guided text', 34),
    item('tasks', 'Copy a few telephone numbers from a text', 35),
    item('tasks', 'Copy birthdays from a birthday list', 36),
    item('tasks', 'Copy information from an appointment reminder card onto a personal calendar', 37),
    item('tasks', 'Copy a short message for a friend or co-worker', 38),
    item('tasks', 'Copy an address from an envelope or email', 39)
  ],
  pre_beginner_prior_ed: [
    ref('benchmark_description', 'Client has very limited knowledge of English and can complete short guided writing with assistance.', 1),
    ref('client_profile', 'Has extremely limited vocabulary; may occasionally revert to first language.', 2),
    item('outcomes_performance', 'Texts to copy are short (3-5 item lists or 2-3 sentences)', 10),
    item('outcomes_performance', 'Forms have up to 3 basic personal ID categories', 11),
    item('outcomes_performance', 'Guided writing assignments are about 3 sentences long', 12),
    item('grammar', 'Simple Present Tense', 20),
    item('grammar', 'Articles: introduction', 21),
    item('grammar', 'Subject pronouns', 22),
    item('grammar', 'Object pronouns', 23),
    item('grammar', 'Singular nouns and plural nouns', 24),
    item('grammar', 'Adjectives with Be', 25),
    item('grammar', 'Imperatives', 26),
    item('tasks', 'Copy a standard greeting card for a special occasion', 30),
    item('tasks', 'Copy an email address or street address', 31),
    item('tasks', 'Copy words from a picture dictionary into a guided text', 32),
    item('tasks', 'Make a list of phone numbers for own use', 33),
    item('tasks', 'Copy information from an identification document onto a form', 34),
    item('tasks', 'Fill out personal identification area of a simple change-of-address form', 35),
    item('tasks', 'Complete a simple guided writing text about self by filling in blanks', 36),
    item('tasks', 'Complete a guided standard greeting card by filling in single words', 37),
    item('tasks', 'Write answers to simple questions about immediate needs with assistance from teacher', 38)
  ],
  clb_1: [
    ref('benchmark_description', 'Client can write basic personal identification information and a small number of familiar words and simple phrases related to immediate needs.', 1),
    ref('client_profile', 'Has very limited knowledge of the language and extremely limited vocabulary.', 2),
    item('outcomes_general', 'Can write down basic personal identification information', 10),
    item('outcomes_general', 'Can write a few familiar words, simple phrases, and sentences about self', 11),
    item('outcomes_general', 'Can copy/record time, addresses, names, number, and prices', 12),
    item('outcomes_performance', 'Texts to copy are short (5- to 10-item lists or 2 to 3 sentences)', 20),
    item('outcomes_performance', 'Forms are simple with up to 5 basic personal ID information categories', 21),
    item('outcomes_performance', 'Guided writing assignments are 3 to 5 sentences long', 22),
    item('grammar', 'Simple Present', 30),
    item('grammar', 'Articles: introduction', 31),
    item('grammar', 'Nouns: singular and plural', 32),
    item('grammar', 'Subject Pronouns', 33),
    item('grammar', 'Object Pronouns', 34),
    item('grammar', 'Possessive Pronouns', 35),
    item('grammar', 'Possessive Adjectives', 36),
    item('grammar', 'Imperatives', 37),
    grp('tasks', 'Convey greeting or goodwill messages', 40),
    item('tasks', 'Complete a standard greeting card or e-card for a special occasion', 41, { parentKey: 'Convey greeting or goodwill messages' }),
    item('tasks', 'Address the envelope or email', 42, { parentKey: 'Convey greeting or goodwill messages' }),
    item('tasks', 'Copy information from an identification document onto a form', 43),
    item('tasks', 'Copy information from an appointment reminder card onto a personal calendar', 44),
    item('tasks', 'Make a list of phone numbers for own use', 45),
    item('tasks', 'Fill out personal identification area of a simple change-of-address form', 46),
    item('tasks', 'Complete a simple guided writing text about self by filling in blanks', 47)
  ],
  clb_2: [
    ref('benchmark_description', 'Client can write basic personal identification information, words, simple phrases, and a few simple sentences about highly familiar information.', 1),
    item('outcomes_general', 'Can write a few sentences and phrases about self and family', 10),
    item('outcomes_general', 'Can copy basic factual information from directories, telephone book, signs, store flyers', 11),
    item('outcomes_performance', 'Texts to copy are short (10- to 20-item lists or 5 to 7 sentences)', 20),
    item('outcomes_performance', 'Forms are simple with 8 to 12 basic personal ID information categories', 21),
    item('grammar', 'Simple Present', 30),
    item('grammar', 'Present Progressive', 31),
    item('grammar', 'Modals of Ability – Present', 32),
    item('grammar', 'There is/There are', 33),
    item('grammar', 'Prepositions of Place', 34),
    item('grammar', 'Prepositions of Time', 35),
    item('grammar', 'Yes/No questions', 36),
    item('grammar', 'Wh- questions', 37),
    item('grammar', 'Adverbs of Frequency', 38),
    item('tasks', 'Fill out personal identification section of a simple online form to set up an email account', 40),
    item('tasks', 'Complete personal identification sections of an application form for apartment rental or job benefits', 41),
    item('tasks', 'Write simple (1 line) descriptions to accompany family photographs', 42),
    item('tasks', 'Write simple responses to basic questions in text messages', 43),
    item('tasks', 'Write a note to a neighbour before going on vacation', 44),
    item('tasks', 'Write a short email to invite a friend to lunch', 45),
    item('tasks', 'Copy from dictionary 3 different definitions for the same word', 46),
    item('tasks', 'Copy a work schedule for personal use', 47)
  ],
  clb_3: [
    ref('benchmark_description', 'Client can write simple sentences about familiar information related to personal experience and everyday situations.', 1),
    item('outcomes_general', 'Can write a number of one-clause sentences about self and family', 10),
    item('outcomes_general', 'Can copy information from dictionaries, directories, schedules, instructions', 11),
    item('outcomes_performance', 'Written text is 5 to 8 sentences long, on a familiar or personally relevant topic', 20),
    item('grammar', 'Simple Present', 30),
    item('grammar', 'Present Progressive', 31),
    item('grammar', 'Simple Past', 32),
    item('grammar', 'Count and Non-count Nouns', 33),
    item('grammar', 'Modals of Ability – Present', 34),
    item('grammar', 'Modals of Ability – Past', 35),
    item('tasks', 'Write a note to a neighbour before going on vacation with contact details', 40),
    item('tasks', 'Write a short email to invite a friend to lunch', 41),
    item('tasks', 'Write a short sympathy or get-well message to a friend or co-worker', 42),
    item('tasks', 'Fill out an emergency information form for an employer, school, or summer camp', 43),
    item('tasks', 'Write a short description of a family member', 44),
    item('tasks', 'Write about a daily work routine', 45)
  ],
  clb_4: [
    ref('benchmark_description', 'Client can write short, simple texts about personal experiences and familiar topics related to daily life.', 1),
    item('outcomes_general', 'Can write simple descriptions and narrations about self and family', 10),
    item('outcomes_performance', 'Letters are one paragraph long', 20),
    item('outcomes_performance', 'Descriptions are one paragraph long on a familiar topic', 21),
    item('grammar', 'Simple Past', 30),
    item('grammar', 'Simple Future', 31),
    item('grammar', 'Phrasal verbs: high frequency', 32),
    item('grammar', 'Idioms: high frequency', 33),
    item('tasks', 'Write an invitation to a family function such as a housewarming or birthday party', 40),
    item('tasks', 'Write a short personal note to thank a host or supervisor for lunch', 41),
    item('tasks', 'Write an email to a friend with a short update on what happened last week', 42),
    item('tasks', 'Fill out an application form for pre-authorized payments for water, power or telephone service', 43),
    item('tasks', 'Write a short note to a landlord about a problem in the apartment', 44),
    item('tasks', 'Write a paragraph to describe coming to Canada', 45)
  ],
  clb_5: [
    ref('benchmark_description', 'Client can write short, simple to moderately complex descriptions, narrations, and communications about familiar, concrete topics.', 1),
    item('outcomes_general', 'Can fill out form reports and detailed job application forms with short comments on experience', 10),
    item('outcomes_general', 'Can take simple notes from short oral presentations or reference materials', 11),
    item('grammar', 'Present Perfect', 30),
    item('grammar', 'Past Progressive', 31),
    item('grammar', 'First Conditional', 32),
    item('grammar', 'Second Conditional', 33),
    item('grammar', 'Gerunds and Infinitives', 34),
    item('tasks', 'Write a formal invitation for a group function such as a company picnic or BBQ', 40),
    item('tasks', 'Take notes from a pre-recorded telephone message for personal use', 41),
    item('tasks', 'Write a note to an insurance company to cancel or change a policy', 42),
    item('tasks', 'Fill out an application form for a car rental or driver\'s license', 43),
    item('tasks', 'Write a paragraph to report a factual event or incident such as an accident', 44),
    item('tasks', 'Write a paragraph for a class newsletter about a new community service', 45)
  ],
  clb_6: [
    ref('benchmark_description', 'Client can write connected paragraphs about concrete topics with moderate complexity.', 1),
    item('outcomes_general', 'Can write multi-paragraph texts on familiar topics with supporting details', 10),
    item('grammar', 'Past Perfect', 30),
    item('grammar', 'Reported speech', 31),
    item('tasks', 'Write a formal letter of complaint about a product or service', 40),
    item('tasks', 'Summarize information from two sources in a short paragraph', 41)
  ],
  clb_7: [
    ref('benchmark_description', 'Client can write moderately complex texts for a range of purposes with adequate control of structure.', 1),
    item('outcomes_general', 'Can write coherent multi-paragraph texts with clear organization', 10),
    item('grammar', 'Mixed conditionals', 30),
    item('grammar', 'Passive voice in formal writing', 31),
    item('tasks', 'Write a cover letter for a job application', 40),
    item('tasks', 'Write a formal report based on research notes', 41)
  ]
});

/** Minimal placeholder items for L/S/R until PDFs are imported */
function buildLsrPlaceholderItems(skillId, levelCode) {
  const skillTitle = skillId.charAt(0).toUpperCase() + skillId.slice(1);
  return [
    ref('benchmark_description', `${skillTitle} benchmark description for ${levelCode.replace(/_/g, ' ')} — import full content from PDF.`, 1),
    ref('client_profile', `Client profile for ${skillTitle} at ${levelCode.replace(/_/g, ' ')}.`, 2),
    item('outcomes_general', `Sample ${skillTitle.toLowerCase()} outcome for ${levelCode.replace(/_/g, ' ')}`, 10),
    item('outcomes_performance', `Sample ${skillTitle.toLowerCase()} performance condition`, 20),
    grp('tasks', 'Sample task category', 30),
    item('tasks', `Sample ${skillTitle.toLowerCase()} task — replace when PDF is imported`, 31, { parentKey: 'Sample task category' })
  ];
}

module.exports = {
  CLB_SKILLS,
  DEFAULT_LEVELS,
  DEFAULT_SECTION_TEMPLATES,
  WRITING_ITEMS_BY_LEVEL,
  buildLsrPlaceholderItems
};
