'use strict';

/** Ethical / values-themed sample Word of Day rows for MongoDB seeding (org 900000). */
const DEFAULT_ORG_ID = '900000';

module.exports = {
  DEFAULT_ORG_ID,
  SAMPLE_WORD_OF_DAY_ENTRIES: [
    {
      id: 'WOD-SAMPLE-001',
      orgId: DEFAULT_ORG_ID,
      word: 'Integrity',
      wordTypes: ['noun'],
      wordType: 'noun',
      pronunciation: '/ɪnˈtɛɡrəti/',
      difficulty: 'medium',
      meaning: 'The quality of being honest and having strong moral principles.',
      examples: [
        'She answered the difficult question with integrity.',
        'Integrity builds trust in every community.'
      ],
      photo: {},
      audio: {},
      videoUrl: '',
      status: 'submitted',
      authorUserId: 'DEMO-AUTHOR-01',
      authorName: 'Sample Teacher',
      workflow: {
        submittedAt: '2026-03-10T14:00:00.000Z',
        submittedBy: 'DEMO-AUTHOR-01',
        submittedByName: 'Sample Teacher',
        reviewerNote: ''
      },
      display: { displayCount: 0, displayDates: [], lastDisplayedAt: '', lastDisplayedOnDate: '' },
      audit: {
        createDateTime: '2026-03-01T10:00:00.000Z',
        lastUpdateDateTime: '2026-03-10T14:00:00.000Z',
        createdBy: 'DEMO-AUTHOR-01',
        updatedBy: 'DEMO-AUTHOR-01'
      }
    },
    {
      id: 'WOD-SAMPLE-002',
      orgId: DEFAULT_ORG_ID,
      word: 'Compassion',
      wordTypes: ['noun'],
      wordType: 'noun',
      pronunciation: '/kəmˈpæʃən/',
      difficulty: 'medium',
      meaning: 'Sympathetic concern for the suffering or misfortune of others.',
      examples: [
        'He showed compassion when his classmate needed help.',
        'Compassion turns understanding into action.'
      ],
      photo: {},
      audio: {},
      videoUrl: '',
      status: 'submitted',
      authorUserId: 'DEMO-AUTHOR-02',
      authorName: 'Sample Coordinator',
      workflow: {
        submittedAt: '2026-03-12T09:30:00.000Z',
        submittedBy: 'DEMO-AUTHOR-02',
        submittedByName: 'Sample Coordinator',
        reviewerNote: ''
      },
      display: { displayCount: 0, displayDates: [], lastDisplayedAt: '', lastDisplayedOnDate: '' },
      audit: {
        createDateTime: '2026-03-05T11:00:00.000Z',
        lastUpdateDateTime: '2026-03-12T09:30:00.000Z',
        createdBy: 'DEMO-AUTHOR-02',
        updatedBy: 'DEMO-AUTHOR-02'
      }
    },
    {
      id: 'WOD-SAMPLE-003',
      orgId: DEFAULT_ORG_ID,
      word: 'Perseverance',
      wordTypes: ['noun'],
      wordType: 'noun',
      pronunciation: '/ˌpɜːrsəˈvɪərəns/',
      difficulty: 'hard',
      meaning: 'Continued effort to do or achieve something despite difficulties.',
      examples: [
        'Her perseverance helped her finish the program.',
        'Perseverance is often the difference between giving up and growing.'
      ],
      photo: {},
      audio: {},
      videoUrl: '',
      status: 'approved',
      authorUserId: 'DEMO-AUTHOR-01',
      authorName: 'Sample Teacher',
      workflow: {
        submittedAt: '2026-02-20T16:00:00.000Z',
        submittedBy: 'DEMO-AUTHOR-01',
        submittedByName: 'Sample Teacher',
        approvedAt: '2026-02-21T10:00:00.000Z',
        approvedBy: 'DEMO-REVIEWER-01',
        approvedByName: 'Sample Reviewer',
        reviewerNote: ''
      },
      display: {
        displayCount: 3,
        displayDates: ['2026-03-01', '2026-03-08', '2026-03-15'],
        lastDisplayedAt: '2026-03-15T08:00:00.000Z',
        lastDisplayedOnDate: '2026-03-15'
      },
      audit: {
        createDateTime: '2026-02-18T09:00:00.000Z',
        lastUpdateDateTime: '2026-02-21T10:00:00.000Z',
        createdBy: 'DEMO-AUTHOR-01',
        updatedBy: 'DEMO-REVIEWER-01'
      }
    },
    {
      id: 'WOD-SAMPLE-004',
      orgId: DEFAULT_ORG_ID,
      word: 'Gratitude',
      wordTypes: ['noun'],
      wordType: 'noun',
      pronunciation: '/ˈɡrætɪtuːd/',
      difficulty: 'easy',
      meaning: 'The quality of being thankful and showing appreciation.',
      examples: [
        'She expressed gratitude for the support she received.',
        'Gratitude can improve well-being and strengthen relationships.'
      ],
      photo: {},
      audio: {},
      videoUrl: '',
      status: 'saved',
      authorUserId: 'DEMO-AUTHOR-02',
      authorName: 'Sample Coordinator',
      workflow: {},
      display: { displayCount: 0, displayDates: [], lastDisplayedAt: '', lastDisplayedOnDate: '' },
      audit: {
        createDateTime: '2026-03-14T13:00:00.000Z',
        lastUpdateDateTime: '2026-03-14T13:00:00.000Z',
        createdBy: 'DEMO-AUTHOR-02',
        updatedBy: 'DEMO-AUTHOR-02'
      }
    },
    {
      id: 'WOD-SAMPLE-005',
      orgId: DEFAULT_ORG_ID,
      word: 'Respect',
      wordTypes: ['noun', 'verb'],
      wordType: 'noun',
      pronunciation: '/rɪˈspɛkt/',
      difficulty: 'easy',
      meaning: 'Admiration for someone or something, or due regard for feelings and rights.',
      examples: [
        'We show respect by listening carefully in class.',
        'Mutual respect makes collaboration easier.'
      ],
      photo: {},
      audio: {},
      videoUrl: '',
      status: 'rejected',
      authorUserId: 'DEMO-AUTHOR-01',
      authorName: 'Sample Teacher',
      workflow: {
        submittedAt: '2026-01-15T12:00:00.000Z',
        submittedBy: 'DEMO-AUTHOR-01',
        submittedByName: 'Sample Teacher',
        rejectedAt: '2026-01-16T09:00:00.000Z',
        rejectedBy: 'DEMO-REVIEWER-01',
        rejectedByName: 'Sample Reviewer',
        reviewerNote: 'Example sentence needs a clearer classroom context.'
      },
      display: { displayCount: 0, displayDates: [], lastDisplayedAt: '', lastDisplayedOnDate: '' },
      audit: {
        createDateTime: '2026-01-14T10:00:00.000Z',
        lastUpdateDateTime: '2026-01-16T09:00:00.000Z',
        createdBy: 'DEMO-AUTHOR-01',
        updatedBy: 'DEMO-REVIEWER-01'
      }
    },
    {
      id: 'WOD-SAMPLE-006',
      orgId: DEFAULT_ORG_ID,
      word: 'Wisdom',
      wordTypes: ['noun'],
      wordType: 'noun',
      pronunciation: '/ˈwɪzdəm/',
      difficulty: 'medium',
      meaning: 'The ability to use knowledge and experience to make sound judgments.',
      examples: [
        'Wisdom often comes from reflecting on mistakes as well as successes.',
        'She sought wisdom from mentors before making a decision.'
      ],
      photo: {},
      audio: {},
      videoUrl: '',
      status: 'on_hold',
      authorUserId: 'DEMO-AUTHOR-02',
      authorName: 'Sample Coordinator',
      workflow: {
        submittedAt: '2026-02-01T11:00:00.000Z',
        submittedBy: 'DEMO-AUTHOR-02',
        submittedByName: 'Sample Coordinator',
        approvedAt: '2026-02-02T15:00:00.000Z',
        approvedBy: 'DEMO-REVIEWER-01',
        approvedByName: 'Sample Reviewer',
        reviewerNote: 'Paused pending pronunciation audio.'
      },
      display: {
        displayCount: 1,
        displayDates: ['2026-02-10'],
        lastDisplayedAt: '2026-02-10T08:00:00.000Z',
        lastDisplayedOnDate: '2026-02-10'
      },
      audit: {
        createDateTime: '2026-01-28T10:00:00.000Z',
        lastUpdateDateTime: '2026-02-05T16:00:00.000Z',
        createdBy: 'DEMO-AUTHOR-02',
        updatedBy: 'DEMO-REVIEWER-01'
      }
    },
    {
      id: 'WOD-SAMPLE-007',
      orgId: DEFAULT_ORG_ID,
      word: 'Empathy',
      wordTypes: ['noun'],
      wordType: 'noun',
      pronunciation: '/ˈɛmpəθi/',
      difficulty: 'medium',
      meaning: 'The ability to understand and share the feelings of another person.',
      examples: [
        'Empathy helps teachers respond to students with care.',
        'Listening without judgment is a sign of empathy.'
      ],
      photo: {},
      audio: {},
      videoUrl: '',
      status: 'reopened',
      authorUserId: 'DEMO-AUTHOR-01',
      authorName: 'Sample Teacher',
      workflow: {
        submittedAt: '2026-02-25T14:00:00.000Z',
        submittedBy: 'DEMO-AUTHOR-01',
        submittedByName: 'Sample Teacher',
        rejectedAt: '2026-02-26T10:00:00.000Z',
        rejectedBy: 'DEMO-REVIEWER-01',
        rejectedByName: 'Sample Reviewer',
        reviewerNote: 'Reopened for revised examples.'
      },
      display: { displayCount: 0, displayDates: [], lastDisplayedAt: '', lastDisplayedOnDate: '' },
      audit: {
        createDateTime: '2026-02-24T09:00:00.000Z',
        lastUpdateDateTime: '2026-03-02T11:00:00.000Z',
        createdBy: 'DEMO-AUTHOR-01',
        updatedBy: 'DEMO-AUTHOR-01'
      }
    },
    {
      id: 'WOD-SAMPLE-008',
      orgId: DEFAULT_ORG_ID,
      word: 'Honesty',
      wordTypes: ['noun'],
      wordType: 'noun',
      pronunciation: '/ˈɒnəsti/',
      difficulty: 'easy',
      meaning: 'The quality of being truthful and sincere.',
      examples: [
        'Honesty is valued in academic work and daily life.',
        'He chose honesty even when it was uncomfortable.'
      ],
      photo: {},
      audio: {},
      videoUrl: '',
      status: 'archived',
      authorUserId: 'DEMO-AUTHOR-02',
      authorName: 'Sample Coordinator',
      workflow: {
        submittedAt: '2025-11-01T10:00:00.000Z',
        submittedBy: 'DEMO-AUTHOR-02',
        submittedByName: 'Sample Coordinator',
        approvedAt: '2025-11-02T10:00:00.000Z',
        approvedBy: 'DEMO-REVIEWER-01',
        approvedByName: 'Sample Reviewer',
        reviewerNote: 'Archived after term ended.'
      },
      display: {
        displayCount: 12,
        displayDates: ['2025-11-15'],
        lastDisplayedAt: '2025-12-01T08:00:00.000Z',
        lastDisplayedOnDate: '2025-12-01'
      },
      audit: {
        createDateTime: '2025-10-30T10:00:00.000Z',
        lastUpdateDateTime: '2025-12-05T10:00:00.000Z',
        createdBy: 'DEMO-AUTHOR-02',
        updatedBy: 'DEMO-REVIEWER-01'
      }
    }
  ]
};