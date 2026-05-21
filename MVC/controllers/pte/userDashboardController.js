const accessUiService = require('../../services/security/accessUiService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

function firstUsableName(user = {}) {
  const candidates = [
    user?.name?.preferred,
    user?.name?.first,
    user?.preferredName,
    user?.firstName,
    typeof user?.name === 'string' ? user.name : '',
    user?.username,
    user?.email
  ];

  const raw = candidates.find((value) => String(value || '').trim());
  const token = String(raw || 'Learner').trim().split('@')[0];
  return token.includes(' ') ? token.split(/\s+/)[0] : token;
}

function buildPrimarySections() {
  return [
      {
        key: 'practice',
        title: 'Practice',
        eyebrow: 'Build your rhythm',
        icon: 'bi-bullseye',
        href: '/pte/practice/by-skills',
        cta: 'Start Practice',
        description: 'Choose skills, tune question counts, and run focused practice sessions with immediate review paths.',
        accent: 'mint',
        sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS,
        operationId: OPERATIONS.READ,
        links: [
          { label: 'Practice By Skills', href: '/pte/practice/by-skills', icon: 'bi-grid-3x3-gap', sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS, operationId: OPERATIONS.READ },
          { label: 'Smart Practice', href: '/pte/practice/smart', icon: 'bi-stars', sectionId: SECTIONS.PTE_SMART_PRACTICE, operationId: OPERATIONS.READ },
          { label: 'Practice Attempts', href: '/pte/practice/attempts', icon: 'bi-clock-history', sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS, operationId: OPERATIONS.READ_ALL }
        ]
      },
      {
        key: 'mock',
        title: 'Mock Exam',
        eyebrow: 'Simulate exam day',
        icon: 'bi-pc-display-horizontal',
        href: '/pte/practice/mock-exams',
        cta: 'Open Mock Exams',
        description: 'Run published PTE tests in strict mock-exam mode and keep your exam flow realistic from start to finish.',
        accent: 'amber',
        sectionId: SECTIONS.PTE_MOCK_EXAMS,
        operationId: OPERATIONS.READ,
        links: [
          { label: 'Mock Exams', href: '/pte/practice/mock-exams', icon: 'bi-stopwatch', sectionId: SECTIONS.PTE_MOCK_EXAMS, operationId: OPERATIONS.READ },
          { label: 'Attempt Ledger', href: '/pte/attempt/ledger', icon: 'bi-list-check', sectionId: SECTIONS.PTE_ATTEMPT_LEDGER, operationId: OPERATIONS.READ_ALL },
          { label: 'Overall Performance', href: '/pte/attempt/overall-performance', icon: 'bi-graph-up-arrow', sectionId: SECTIONS.PTE_ATTEMPT_OVERALL_PERFORMANCE, operationId: OPERATIONS.READ }
        ]
      },
      {
        key: 'feedback',
        title: 'Feedback',
        eyebrow: 'Know what to fix',
        icon: 'bi-chat-square-heart',
        href: '/pte/feedback/practice',
        cta: 'Review Feedback',
        description: 'Review scored practice, detailed comments, and feedback history so the next session has a clear target.',
        accent: 'coral',
        sectionId: SECTIONS.PTE_FEEDBACK_ON_PRACTICE,
        operationId: OPERATIONS.READ,
        links: [
          { label: 'Feedback On Practice', href: '/pte/feedback/practice', icon: 'bi-chat-left-text', sectionId: SECTIONS.PTE_FEEDBACK_ON_PRACTICE, operationId: OPERATIONS.READ },
          { label: 'Attempt Details', href: '/pte/attempt/details', icon: 'bi-card-checklist', sectionId: SECTIONS.PTE_ATTEMPT_DETAILS, operationId: OPERATIONS.READ },
          { label: 'Practice Feedback', href: '/pte/practice/attempts', icon: 'bi-journal-text', sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS, operationId: OPERATIONS.READ_ALL }
        ]
      }
    ];
}

function buildHeroActions() {
  return [
    { label: 'Start Practice', href: '/pte/practice/by-skills', icon: 'bi-play-fill', variant: 'primary', sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS, operationId: OPERATIONS.READ },
    { label: 'Credit Check', href: '/activity-quota/credit-check', icon: 'bi-patch-check', variant: 'soft', sectionId: SECTIONS.ACTIVITY_QUOTA_CREDIT_CHECK, operationId: OPERATIONS.READ },
    { label: 'Attempts', href: '/pte/practice/attempts', icon: 'bi-clock-history', variant: 'soft', sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS, operationId: OPERATIONS.READ_ALL }
  ];
}

function buildActivityLinks() {
  return [
      {
        title: 'My Attempts',
        href: '/pte/practice/attempts',
        icon: 'bi-clock-history',
        description: 'Review your previous practice sessions, submitted answers, scores, and feedback status.',
        sectionId: SECTIONS.PTE_PRACTICE_BY_SKILLS,
        operationId: OPERATIONS.READ_ALL
      },
      {
        title: 'Activity Quota Credit Check',
        href: '/activity-quota/credit-check',
        icon: 'bi-patch-check',
        description: 'Check your available quota, remaining credits, and recent PTE activity consumption.',
        sectionId: SECTIONS.ACTIVITY_QUOTA_CREDIT_CHECK,
        operationId: OPERATIONS.READ
      }
  ];
}

async function filterPrimarySections(req, sections) {
  const filtered = [];

  for (const section of sections) {
    const primaryAllowed = await accessUiService.canAccessAction(req, section);
    const links = await accessUiService.filterActions(req, section.links || []);
    if (!primaryAllowed && links.length === 0) continue;

    const nextSection = {
      ...section,
      links
    };

    if (!primaryAllowed && links[0]) {
      nextSection.href = links[0].href;
      nextSection.cta = links[0].label || nextSection.cta || 'Open';
    }

    filtered.push(nextSection);
  }

  return filtered;
}

async function showDashboard(req, res) {
  const firstName = firstUsableName(req.user || {});
  const [heroActions, primarySections, activityLinks] = await Promise.all([
    accessUiService.filterActions(req, buildHeroActions()),
    filterPrimarySections(req, buildPrimarySections()),
    accessUiService.filterActions(req, buildActivityLinks())
  ]);

  return res.render('pte/dashboard', {
    title: 'PTE Learner Hub',
    includeModal: true,
    user: req.user || null,
    firstName,
    heroActions,
    primarySections,
    activityLinks
  });
}

module.exports = {
  showDashboard
};
