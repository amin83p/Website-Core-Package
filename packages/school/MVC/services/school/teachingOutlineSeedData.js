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
    { key: 'outcomes_performance', title: 'Performance Conditions for Writing Tasks', isSelectable: false, allowsGroups: false, displayOrder: 4 },
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

function checklistItems(sectionKey, labels, startOrder = 10) {
  return (Array.isArray(labels) ? labels : []).map((label, index) => (
    item(sectionKey, label, { order: startOrder + index })
  ));
}

function taskGroup(label, startOrder, childLabels) {
  return [
    grp('tasks', label, startOrder),
    ...(Array.isArray(childLabels) ? childLabels : []).map((childLabel, index) => (
      item('tasks', childLabel, { parentKey: label, order: startOrder + index + 1 })
    ))
  ];
}

/** Writing outline items keyed by level code — sourced from Equilibrium PDFs.
 * PDF mapping: benchmark_description=reference; CLIENT/outcomes/grammar=checklist;
 * task category intro=group; task checkbox=checklist with parentKey=group label. Labels verbatim from PDF. */
const WRITING_ITEMS_BY_LEVEL = Object.freeze({
  pre_beginner_limited_ed: [
    ...checklistItems('client_profile', [
      'Has extremely limited or no vocabulary',
      'Has extreme difficulty communicating even the simplest facts or ideas',
      'Has no knowledge of the language and exposure to reading and spelling conventions in English',
      'Copy letters, numbers, and words from simple lists for personal use or to complete short tasks',
      'My revert to first language'
    ], 10),
    ...checklistItems('outcomes_performance', [
      'Context is personally relevant',
      'Trace letters and numbers',
      'Copy short single words or phrases with easy layout, in legible handwriting or print, and contain basic, everyday information'
    ], 100),
    ...checklistItems('grammar', [
      'Simple Present Tense',
      'Articles: introduction',
      'Subject pronouns',
      'Object pronouns',
      'Singular nouns and plural nouns',
      'Adjectives with Be',
      'Imperatives'
    ], 200),
    ...checklistItems('tasks', [
      'Tracing: have clients trace the letters of the alphabet in lowercase.',
      'Have clients trace the letters of the alphabet in uppercase.',
      'Tracing of numbers: have clients trace the numbers of a group of numbers at a time such as 1-10. (The client’s ability will determine the number of groups you will focus on.)',
      'Copy words from a picture dictionary into a guided text.',
      'Copy a few telephone numbers from a text.',
      'Copy birthdays from a birthday list.',
      'Copy information from an appointment reminder card (such as a dentist or hairdresser) onto a personal calendar.',
      'Copy a short message for a friend or co-worker.',
      'Copy an address from an envelope or email.'
    ], 300)
  ],
  pre_beginner_prior_ed: [
    ...checklistItems('client_profile', [
      'Has extremely limited vocabulary',
      'Has extreme difficulty communicating even the simplest facts or ideas',
      'Has very limited knowledge of the language and exposure to reading and spelling conventions in English',
      'Has very little ability to use simple structures',
      'Has very little awareness of basic spelling, punctuation, and capitalization conventions',
      'My occasionally revert to first language'
    ], 10),
    ...checklistItems('outcomes_performance', [
      'Context is personally relevant',
      'Texts to copy are short (3-5 item lists or 2-3 short sentences) with easy layout, in legible handwriting or print, and contain basic, everyday information',
      'Forms are simple with up to 3 basic personal ID information categories with clear lines or boxed in which to write: date, first name, last name, address, postal code, phone number, date of birth, age.',
      'Guided writing assignments are about 3 sentences long and use familiar everyday words'
    ], 100),
    ...checklistItems('grammar', [
      'Simple Present Tense',
      'Articles: introduction',
      'Subject pronouns',
      'Object pronouns',
      'Singular nouns and plural nouns',
      'Adjectives with Be',
      'Imperatives'
    ], 200),
    ...checklistItems('tasks', [
      'Copy a standard greeting card for a friend’s, or family member’s special occasion.',
      'Copy an email address or street address.',
      'Copy words from a picture dictionary into a guided text.',
      'Make a list of phone numbers for own use.',
      'Copy information from an identification document onto a form.',
      'Copy information from an appointment reminder card (such as a dentist or hairdresser) onto a personal calendar.',
      'Fill out the personal identification area of a simple change-of-address form with a few details such as: date, first name, last name, address, postal code, phone number, date of birth.',
      'Complete a simple guided writing text about self by filling in blanks. (My name is ____. I am ____. I am from _____. I have ____.)',
      'Complete a guided standard greeting card by filling in single words.',
      'Write answers to simple questions about immediate needs with assistance from teacher.'
    ], 300)
  ],
  clb_1: [
    ref('benchmark_description', 'Client can write basic personal identification information and a small number of familiar words and simple phrases related to immediate needs.', 1),
    ...checklistItems('client_profile', [
      'Has very limited knowledge of the language and limited exposure to sound-symbol relationship',
      'Has extremely limited vocabulary',
      'Has very little ability to use simple structures',
      'Has very little awareness of basic spelling, punctuation, and capitalization conventions',
      'Has extreme difficulty communicating even the most simple facts or ideas'
    ], 10),
    ...checklistItems('outcomes_general', [
      'Learner is literate in the same alphabet in another language and can write all letters of the alphabet, and all numbers and numerals',
      'Can write down basic personal identification information',
      'Can write a few familiar words, simple phrases, and sentences about self',
      'Can copy/record time, addresses, names, number, and prices',
      'Limited knowledge of the language and exposure to reading and spelling conventions in English limits clients’ ability to write new words'
    ], 100),
    ...checklistItems('outcomes_performance', [
      'Context is personally relevant',
      'Texts to copy are short (5- to 10-item lists or 2 to 3 sentences) with easy layout, in legible handwriting or print, and contain basic, everyday information',
      'Forms are simple with up to 5 basic personal ID information categories, with clear lines or boxed in which to write (e.g., date, first name, last name, address, postal code, phone number, date of birth, age, sex)',
      'Guided writing assignments are 3 to 5 sentences long and use familiar everyday words'
    ], 200),
    ...checklistItems('grammar', [
      'Simple Present',
      'Articles: introduction',
      'Nouns: singular and plural',
      'Subject Pronouns',
      'Object Pronouns',
      'Possessive Pronouns',
      'Possessive Adjectives',
      'Imperatives'
    ], 300),
    ...taskGroup(
      'Convey greeting or other goodwill messages. Messages are a few words in length addressed to a familiar person and related to a personally relevant situation',
      400,
      [
        'Complete a standard greeting card or e-card for a friend’s, family member’s, classmate’s, or co-worker’s special occasion.',
        'Address the envelope or email.'
      ]
    ),
    ...taskGroup(
      'Copy numbers, letters, words, short phrases or sentences. Texts to copy are 2 to 3 sentences in length, have clear layout and basic everyday information; lists have about 5 to 10 items.',
      500,
      [
        'Copy information from an identification document onto a form.',
        'Copy information from an appointment reminder card (such as a dentist or hairdresser) onto a personal calendar.',
        'Make a list of phone numbers for own use.',
        'In a language class, copy words from a picture dictionary into a guided text.'
      ]
    ),
    ...taskGroup(
      'Complete very short, simple or simplified forms that require only basic personal identification information. Forms contain up to about 5 personal identification items',
      600,
      [
        'Fill out the personal identification area of a simple change-of-address form with a few details (such as date, first and last name, address, postal code, phone number, and date of birth.)',
        'Fill out the personal identification area of an application to join a language class or apply for a job (with assistance from an employer, administrative assistant, or instructor.)'
      ]
    ),
    ...taskGroup(
      'Write a few words to complete a short, guided text or answer simple questions to describe a personal situation. Text to complete is about 3 to 5 sentences.',
      700,
      [
        'In a language class, complete a simple guided writing text about self by filling in blanks. (My name is _____. I am ____. I am from _____. I have ______.)',
        'Write answers to simple questions about immediate needs with assistance from a family member or settlement worker.'
      ]
    )
  ],
  clb_2: [
    ref('benchmark_description', 'Client can write basic personal identification information, words, simple phrases, and a few simple sentences about highly familiar information related to immediate needs.', 1),
    ...checklistItems('client_profile', [
      'Has limited knowledge of the language and limited exposure to sound-symbol relationship',
      'Has very limited vocabulary',
      'Has some initial ability to use simple structures',
      'Has some initial awareness of basic spelling, punctuation and capitalization conventions',
      'Has difficulty with word order and word forms greatly interferes with comprehensibility',
      'Has difficulty communicating simple facts and ideas'
    ], 10),
    ...checklistItems('outcomes_general', [
      'Can write a few sentences and phrases about self and family or other highly familiar information as a simple description, as answers to written questions, or on simplified forms and slips',
      'Can copy basic factual information from directories, telephone book, signs, store flyers and simple schedules',
      'Has difficulty writing unfamiliar words'
    ], 100),
    ...checklistItems('outcomes_performance', [
      'Context is personally relevant',
      'Texts to copy are short (10- to 20-item lists or 5 to 7 sentences) with easy layout and in legible handwriting or print',
      'Forms are simple with 8 to 12 basic personal ID information categories, with clear lines or boxes in which to write (e.g., country or origin, marital status, spouse, dependants, nationality, account number, citizenship)',
      'Guided writing assignments are 5 to 6 sentences and use familiar everyday words'
    ], 200),
    ...checklistItems('grammar', [
      'Simple Present',
      'Articles: introduction',
      'Nouns: singular and plural',
      'Subject Pronouns',
      'Object Pronouns',
      'Possessive Pronouns',
      'Possessive Adjectives',
      'Present Progressive',
      'Modals of Ability – Present',
      'Parts of speech',
      'There is/There are',
      'Prepositions of Place',
      'Prepositions of Time',
      'Yes/No questions',
      'Wh- questions',
      'Adverbs of Frequency',
      'Imperatives'
    ], 300),
    ...taskGroup(
      'Complete short, simple or simplified forms. Forms contain up to about 10 personal identification items, and have clear labels and areas in which to write.',
      400,
      [
        'Fill out the personal identification section of a simple online form to set up an email account.',
        'Complete the personal identification sections of an application form for an apartment rental or job benefits.',
        'Fill out an application for a newspaper or magazine subscription.'
      ]
    ),
    ...taskGroup(
      'Write a few words to complete a short, guided text or answer simple questions to describe a personal situation. Texts to complete are about 5 to 7 sentences.',
      500,
      [
        'Write simple (1 line) descriptions to accompany family photographs that are in an album or online in a photo-sharing application.',
        'Write simple (1 line) responses to basic questions from a family member or co-worker in text messages. (I am at work. I am shopping.)',
        'In a language class, write a few short personal sentences in response to question prompts.'
      ]
    ),
    ...taskGroup(
      'Convey short, personal and informal social messages. Messages are a few short sentences.',
      600,
      [
        'Write a note to a neighbour before going on vacation.',
        'Include a contact address, timelines, and emergency contact information.',
        'Write a short email to invite a friend to lunch.',
        'Include details about the time and location.',
        'Write a simple message to a friend on a social networking site.',
        'Write a short sympathy or get-well message to a friend or co-worker.'
      ]
    ),
    ...taskGroup(
      'Copy or record a range of information from short texts for personal use. Texts to copy are up to about 1 paragraph.',
      700,
      [
        'Copy from dictionary 3 different definitions for the same word to learn the meanings.',
        'Copy instructions (such as a short recipe, public transit directions, or instructions for a job application) from a website.',
        'Copy a work schedule for personal use.',
        'Copy product information to prepare an order for a customer.',
        'Copy a child’s school timetable into a day planner for personal use.'
      ]
    )
  ],
  clb_3: [
    ref('benchmark_description', 'Client can write simple sentences about familiar information related to personal experience and everyday situations.', 1),
    ...checklistItems('client_profile', [
      'Has developing knowledge of the language and exposure to sound-symbol relationship',
      'Has developing range of simple everyday vocabulary',
      'Has developing control of simple structures',
      'Has developing control of spelling, punctuation, and capitalization',
      'Has difficulty with word order and word forms interferes with comprehensibility',
      'Has some difficulty communicating a simple message'
    ], 10),
    ...checklistItems('outcomes_general', [
      'Demonstrates adequate competence in simple, familiar, personal writing tasks within predictable contexts of everyday needs and experience',
      'Can write a number of one-clause sentences about self and family (e.g., simple descriptions and narration)',
      'Can copy information from dictionaries, directories, schedules, instructions',
      'Can copy or write a set of simple instructions or a simple message',
      'Can fill out simple application forms and bank slips'
    ], 100),
    ...checklistItems('outcomes_performance', [
      'Circumstances are informal',
      'Texts to copy are equivalent to a paragraph, with easy layout, and in legible handwriting or print',
      'Written text is 5 to 8 sentences long, on a familiar or personally relevant topic'
    ], 200),
    ...checklistItems('grammar', [
      'Simple Present',
      'Present Progressive',
      'Simple Past',
      'Imperative verbs',
      'Nouns: singular and plural',
      'Pronouns',
      'Count and Non-count Nouns',
      'Possessive Nouns',
      'Adjectives',
      'Adverbs of frequency',
      'Adverbs of Manner',
      'Prepositions of Time',
      'Prepositions of Place',
      'Articles: basic',
      'Quantifiers: many/much',
      'Modals of Ability – Present',
      'Modals of Ability – Past',
      'Parts of Speech',
      'There is/There are',
      'Yes/No questions',
      'Wh - questions'
    ], 300),
    ...taskGroup(
      'Convey short, personal and informal social messages. Messages are a few short sentences addressed to a familiar person and related to personally.',
      400,
      [
        'Write a note to a neighbour before going on vacation. Include a contact address, timelines, and emergency contact information.',
        'Write a short email to invite a friend to lunch. Include details about the time and location.',
        'Write a simple message to a friend on a social networking site.',
        'Write a short sympathy or get-well message to a friend or co-worker.'
      ]
    ),
    ...taskGroup(
      'Copy or record a range of information from short texts for personal use. Texts to copy are up to about 1 paragraph.',
      500,
      [
        'Copy from a dictionary 3 different definitions for the same word to learn the meanings.',
        'Copy instructions (such as a short recipe, public transit directions, or instructions for a job application) from a website.',
        'Copy a work schedule for personal use.',
        'Copy product information to prepare an order for a customer.',
        'Copy a child’s school timetable into a day planner for personal use.'
      ]
    ),
    ...taskGroup(
      'Complete short, simple forms. Forms contain about 12 to 15 items and have clear labels and areas in which to write.',
      600,
      [
        'Fill out an emergency information form for an employer, a school, or a summer camp.',
        'Write a short note telling a colleague to turn off the light and lock the door when he/she is leaving.',
        'Complete an organ donor card to keep in a wallet.'
      ]
    ),
    ...taskGroup(
      'Write a few sentences to describe a familiar person, object, place, situation, or event. Writing is up to about 5 sentences.',
      700,
      [
        'Write a short description of a family member.',
        'Write a few sentences about a family event or occasion to accompany a picture on a social networking site.',
        'Write about a special place.',
        'Write about a daily work routine.'
      ]
    )
  ],
  clb_4: [
    ref('benchmark_description', 'Client can write short, simple texts about personal experiences and familiar topics or situations related to daily life and experience', 1),
    ...checklistItems('client_profile', [
      'Has adequate knowledge of the language for simple tasks',
      'Has adequate range of simple everyday vocabulary',
      'Has adequate control of simple structures',
      'Is able to convey personal information in mostly single-clause sentences',
      'May use some coordinated clauses with basic tenses',
      'Has adequate control of spelling, punctuation and capitalization',
      'Has difficulty with word order and word forms may sometimes interfere with comprehensibility',
      'Is able to communicate a simple message'
    ], 10),
    ...checklistItems('outcomes_general', [
      'Can effectively convey simple ideas and information about personal experience within predictable contexts of everyday needs',
      'Can write simple descriptions and narrations about self and family, or other highly familiar topics',
      'Shows ability to use one-clause sentences or coordinated clauses with basic tenses successfully'
    ], 100),
    ...checklistItems('outcomes_performance', [
      'Circumstances range from informal to more formal occasions',
      'Topics are of immediate everyday relevance',
      'Can write short messages, postcards, notes, directions, and letters',
      'Letters are one paragraph long',
      'Texts to copy are 1 to 2 paragraphs, with easy layout',
      'Can fill out simple application forms',
      'Descriptions are one paragraph long, on a familiar and personally relevant topic',
      'Can take a slow simple dictation with frequent repetitions'
    ], 200),
    ...checklistItems('grammar', [
      'Present Progressive',
      'Simple Past',
      'Simple Future',
      'Count vs Non-count Nouns',
      'Possessive nouns',
      'Adverbs of Frequency',
      'Adjectives',
      'Adverbs of Manner',
      'Prepositions of Time',
      'Prepositions of Place',
      'Prepositions of Direction',
      'Quantifiers: many/much',
      'Articles: including exceptions and other special cases',
      'Quantifiers: some and any',
      'Modals of Ability – Present',
      'Modals of Ability – Past',
      'Verb Collocations',
      'Phrasal verbs: high frequency',
      'Parts of Speech',
      'There is/There are',
      'Yes/No questions',
      'Wh- Questions',
      'Idioms: high frequency'
    ], 300),
    ...taskGroup(
      'Convey short, personal, informal social messages. Message is a few sentences or a short paragraph addressed to a familiar person.',
      400,
      [
        'Write an invitation to a family function, such as a housewarming, graduation, or birthday party.',
        'Write a short personal note to thank a host, friend, or supervisor for lunch.',
        'Write an email to a friend with a short update on what happened last week.'
      ]
    ),
    ...taskGroup(
      'Copy or record information from short texts. Texts to copy are up to about 2 paragraphs and have a clear layout.',
      500,
      [
        'Copy definitions from 2 or 3 sources (such as online dictionaries or grammar website.)',
        'Copy information about 2 products or services from catalogues or online sources to see which has the most features.'
      ]
    ),
    ...taskGroup(
      'Complete simple forms. Forms contain about 15 to 20 items and have clear labels and areas in which to write.',
      600,
      [
        'Fill out an application form for pre-authorized payments for water, power or telephone service.',
        'Write an email to an organization to request information or cancel a service'
      ]
    ),
    ...taskGroup(
      'Write simple business or service messages. Messages are about 7 sentences.',
      700,
      [
        'Write a short note to a landlord about a problem in the apartment that needs attention or repair.',
        'Write a short, simple paragraph to a supervisor to ask for a day off.'
      ]
    ),
    ...taskGroup(
      'Write a short paragraph to describe a familiar situation. Writing is about 1 paragraph.',
      800,
      [
        'Write a paragraph to describe coming to Canada.',
        'Send an email to a co-worker about a trip or vacation.',
        'Write to a friend to share information about a new home (house or apartment.)',
        'Write to a friend, colleague or classmate about plans for next week, next month or next year.'
      ]
    )
  ],
  clb_5: [
    ref('benchmark_description', 'Client can write short, simple to moderately complex descriptions, narrations, and communications about familiar, concrete topics related to daily life and experience.', 1),
    ...checklistItems('client_profile', [
      'Has adequate paragraph structure with a main idea and some supporting details',
      'Has adequate use of connective words and phrases',
      'Has adequate range of vocabulary for most simple everyday texts',
      'Has good control of simple structures',
      'Has difficulty with complex structures',
      'Has adequate control of spelling, punctuation, and format',
      'Has some awkward-sounding phrases and word combinations',
      'Is able to communicate some moderately complex messages'
    ], 10),
    ...checklistItems('outcomes_general', [
      'Can effectively convey familiar information in standard formats',
      'Can fill out form reports and detailed job application forms with short comments on previous experience, abilities, and strengths',
      'Can reproduce information received orally or visually, and can take simple notes from short oral presentations or from reference materials',
      'Can convey information from a table, graph, or chart in a coherent paragraph',
      'Can write down everyday phone messages'
    ], 100),
    ref('outcomes_general', 'Has good control over simple structures, but difficulty with some complex structures, some awkward sounding phrases', 199),
    ...checklistItems('outcomes_performance', [
      'Circumstances range from informal to more formal occasions',
      'Topics are of immediate everyday relevance',
      'Information to reproduce is up to one and one-half pages or may be a short oral text, up to 15 minutes in length',
      'Client may fill out a teacher-prepared summary grid to aid note taking or summarizing',
      'Where necessary for the writing task, clients must include information from other sources (e.g., photographs, drawings, reference text/research information, diagrams)'
    ], 200),
    ...checklistItems('grammar', [
      'Simple Past',
      'Simple Future',
      'Past Progressive',
      'Future Progressive',
      'Present Perfect',
      'Present Perfect Progressive',
      'Possessive Nouns',
      'Reflective Pronouns',
      'Indefinite Pronouns',
      'Demonstrative Pronouns',
      'Relative Pronouns',
      'Demonstrative Adjectives',
      'Adjectives',
      'Adverbs of Manner',
      'Equative, Comparative, Superlative Adjectives',
      'Equative, Comparative, Superlative Adverbs',
      'Comparatives and Superlatives: adjectives and adverbs',
      'Prepositions of Direction',
      'Articles: including exceptions and other special cases',
      'Quantifiers: some/any',
      'Modals of Advice',
      'Modals of Possibility',
      'Complete sentences: sentence fragment/clauses beginning with subordinating conjunctions',
      'Conjunctions',
      'Tag questions',
      'Subject-Verb Agreement',
      'Modals of Necessity and Obligation',
      'Gerunds and Infinitives',
      'First Conditional',
      'Second Conditional',
      'Verb Collocations',
      'Phrasal verbs: high frequency',
      'Idioms: high frequency'
    ], 300),
    ...taskGroup(
      'Convey personal messages in short, formal and informal correspondence. Message is about 1 paragraph related to everyday experience.',
      400,
      [
        'Write a formal invitation for a group function (such as a company picnic, BBQ or potluck.)',
        'Write a letter or email to a friend to describe feelings about a new hometown, English class or job.',
        'Write a short personal journal to share with a teacher or class.'
      ]
    ),
    ...taskGroup(
      'Reduce short, factual, oral discourse to notes or messages. Oral discourse is short, with about 5 to 7 details. Reduce a page of information to a list of important details.',
      500,
      [
        'Take notes from a pre-recorded telephone message (such as a company message about job openings, a message about a store’s location and hours of operation, or a message detailing a bus or train schedule.) Include details for personal use.',
        'Take notes from an advertising flyer on products, features, prices and retail locations to inform shopping decisions.'
      ]
    ),
    ...taskGroup(
      'Write short business or service correspondence for routine personal needs. Writing is about 1 paragraph.',
      600,
      [
        'Write a note to an insurance company to cancel or change a policy and to request a refund.'
      ]
    ),
    ...taskGroup(
      'Complete forms requiring detailed personal information. Forms have about 20 to 30 items.',
      700,
      [
        'Fill out an application form for a car rental or driver’s license.',
        'Fill out an accident report form at work.'
      ]
    ),
    ...taskGroup(
      'Write a paragraph to relate a familiar sequence of events, description of a person, object, or routine.',
      800,
      [
        'Write a paragraph to report a factual event or incident, such as an accident, a workplace incident, or a burglary.',
        'Write a paragraph for a class newsletter to inform readers about a new or useful service in the community (such as a new language class, community centre, childcare centre, or food bank.)'
      ]
    )
  ],
  clb_6: [
    ref('benchmark_description', 'Client can write short, moderately complex descriptions, narrations, and communications about familiar, concrete topics related to personal interests and experience.', 1),
    ...checklistItems('client_profile', [
      'Has adequate paragraph structure with clearly expressed main idea and some supporting details',
      'Has appropriate use of connective words and phrases',
      'Has good range of vocabulary for simple everyday texts',
      'Has good control of simple structures',
      'Has developing control of complex structures',
      'Has adequate control of spelling, punctuation, and format',
      'Has some awkward-sounding phrases and word combinations',
      'Uses a limited range of natural idiomatic language, cultural references, and figure of speech appropriate to the context',
      'Is able to communicate an increasing range of moderately complex messages'
    ], 10),
    ...checklistItems('outcomes_general', [
      'Can effectively convey familiar information in standard formats',
      'Can fill out form reports and detailed job application forms with short comments on previous experience, abilities, and strengths',
      'Can reproduce information received orally or visually, and can take simple notes from short oral presentations or from reference materials',
      'Can convey information from a table, graph, or chart in a coherent paragraph',
      'Has good control over simple structures, but difficulty with some complex structures, some awkward sounding phrases',
      'Can write down everyday phone messages'
    ], 100),
    ...checklistItems('outcomes_performance', [
      'Circumstances range from informal to more formal occasions',
      'Topics are of immediate everyday relevance',
      'Information to reproduce is up to one and one-half pages or may be a short oral text, up to 15 minutes in length',
      'Client may fill out a teacher-prepared summary grid to aid note taking or summarizing',
      'Where necessary for the writing task, clients must include information from other sources (e.g., photographs, drawings, reference text/research information, diagrams)'
    ], 200),
    ...checklistItems('grammar', [
      'Simple Future',
      'Past Progressive',
      'Future Progressive',
      'Present Perfect',
      'Present Perfect Progressive',
      'Reflective Pronouns',
      'Indefinite Pronouns',
      'Demonstrative Pronouns',
      'Relative Pronouns',
      'Demonstrative Adjectives',
      'Adjectives',
      'Equative, Comparative, Superlative Adjectives',
      'Equative, Comparative, Superlative Adverbs',
      'Comparatives and Superlatives: adjectives and adverbs',
      'Preposition of Direction',
      'Articles: including exceptions and other special cases',
      'Quantifiers: some/any',
      'Modals of Advice',
      'Modals of Possibility',
      'Modals of Necessity and Obligation',
      'Gerunds and Infinitives',
      'First Conditional',
      'Second Conditional',
      'Third Conditional',
      'Verb Collocations',
      'Phrasal Verbs',
      'Subject-Verb Agreement',
      'Complete sentences: sentence fragment/clauses beginning with subordinating conjunctions',
      'Conjunctions',
      'Tag Questions',
      'Passive Voice',
      'Causative Verbs',
      'Idioms'
    ], 300),
    ...taskGroup(
      'Convey personal messages in short, formal, and informal correspondence. Message is about 1 to 2 paragraphs, for a familiar audience, and related to everyday experience.',
      400,
      [
        'Write a personal message to cancel an appointment.',
        'Express inability to keep the appointment, disappointment, and offer an apology.',
        'Write a personal message to thank someone for a special gesture or to congratulate a friend who has just had a baby.',
        'Write a letter or email of appreciation to a teacher or colleague who has provided support.'
      ]
    ),
    ...taskGroup(
      'Reduce short, factual oral discourse to notes or messages. Phone messages have about 7 to 8 details and presentations are about 10 minutes, about personally relevant topics. Reduce a page of information to an outline or summary.',
      500,
      [
        'Take notes from a website about a procedure (such as how to get a driver’s license, apply for college, or allergy-proof a home.)',
        'Summarize key information for personal use.',
        'Take notes from a short information session about a college program to share with a friend.',
        'Take notes in a workplace preparation course during a brief presentation on interview tips.'
      ]
    ),
    ...taskGroup(
      'Write short business or service correspondence for routine purposes. Writing is about 1 paragraph.',
      600,
      [
        'Write to inform a company that a product did not work and ask for a refund.',
        'Write an email to a supervisor asking permission to work from home next week.'
      ]
    ),
    ...taskGroup(
      'Complete forms requiring detailed person information. Forms have about 30 to 40 items.',
      700,
      [
        'Write a message to accompany a job application form. Express a desire for the job, provide contact details, and refer the reader to the attached application form.',
        'Fill out a job application form or complete a medical history form.'
      ]
    ),
    ...taskGroup(
      'Write 1 or 2 connected paragraphs to relate a familiar sequence of events, a story, detailed description, or a comparison of people, things, routines, or simple procedures.',
      800,
      [
        'Write a description of a process, such as applying for an academic program or a job.',
        'Write a description of the impact that a significant person has had.',
        'Write a comparison of a company’s services with those of a leading competitor.'
      ]
    )
  ],
  clb_7: [
    ref('benchmark_description', 'Client can write clear, moderately complex texts on familiar concrete topics within predictable, practical, and relevant contexts of daily social, educational and work-related life experience.', 1),
    ...checklistItems('client_profile', [
      'Has good paragraph structure with clearly expressed main idea and adequate supporting details',
      'Uses paragraphs that are developed and joined appropriately to form a coherent text',
      'Is able to create text that contains an introduction, development of ideas and conclusion',
      'Has good range of vocabulary for moderately complex texts',
      'Has adequate control of complex structures',
      'Has good control of spelling, punctuation, and format',
      'Wording may still be typical of first language and seem somewhat unnatural',
      'Uses a range of natural idiomatic language, cultural references, and figures of speech appropriately',
      'Is able to communicate most moderately complex message'
    ], 10),
    ref('outcomes_general', 'See Description of Benchmark 7', 100),
    ...checklistItems('grammar', [
      'Past Progressive',
      'Future Progressive',
      'Present Perfect',
      'Present Perfect Progressive',
      'Past Perfect',
      'Adjective Clauses',
      'Adjective Phrases',
      'Adverb Clauses of Time',
      'Adverb Clauses of Contrast',
      'Past Modals',
      'Second Conditional',
      'Third Conditional',
      'Verb Collocations',
      'Phrasal Verbs',
      'Passive Voice',
      'Causative Verbs',
      'Passive Causative',
      'Noun Clauses',
      'Embedded Questions',
      'Direct and Reported Speech',
      'Idioms'
    ], 300),
    ...taskGroup(
      'Convey personal messages in formal and informal correspondence. Message is about 2 to 3 paragraphs, for a familiar audience, and may require some degree of diplomacy or tact.',
      400,
      [
        'Write a personal note of sympathy to someone who has experienced a loss.',
        'Write a note to a supervisor who is ill.',
        'Express best wished for a quick recovery and offer to assume extra responsibilities if needed.',
        'Write an email to a colleague or work team expressing satisfaction at the successful completion of a project.',
        'Explain why it was successful and the positive impact it will have.'
      ]
    ),
    ...taskGroup(
      'Reduce short oral discourse to notes. Phone messages have about 10 details; presentations are about up to 15 minutes. Reduce a text of up to about 2 pages to an outline or summary.',
      500,
      [
        'Take notes while listening to tenant rights information from a pre-recorded public information line.',
        'Take notes from online sources about the details of an ailment or conditions to discuss with a doctor.',
        'Write an outline to trace a sequence of events in a history text to increase understanding.',
        'Take notes during a short workplace presentation and then write a summary for a co-worker who missed the presentation.'
      ]
    ),
    ...taskGroup(
      'Write business or service correspondence. Writing is about 2 paragraphs.',
      600,
      [
        'Write a short letter to express concerns about an issue at a daycare centre.',
        'Write a formal letter to an academic or work supervisor to request a leave of absence.',
        'Write an email to a government representative to request a needed service or item in the community, such as an off-leash dog area, traffic lights, or play equipment in the park.'
      ]
    ),
    ...taskGroup(
      'Complete extended form requiring detailed personal information. Forms have about 40 items and may require brief written responses to questions.',
      700,
      [
        'Fill out an application for a post-secondary educational institution or an application for a student loan.',
        'Complete an incident report form, including a narrative about the incident.'
      ]
    ),
    ...taskGroup(
      'Write 2 or 3 connected paragraphs.',
      800,
      [
        'Write a message to a friend to inform him/her of the procedure for becoming a Canadian citizen.',
        'Write 2 or 3 paragraphs to compare the education system or election procedures of 2 countries for a n academic preparation course. Add a paragraph expressing a preference for one or the other and give reasons.',
        'Write a brief production report on work stoppage times and reasons.'
      ]
    )
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
