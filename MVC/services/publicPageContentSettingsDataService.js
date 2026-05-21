const publicPageContentSettingRepository = require('../repositories/publicPageContentSettingRepository');
const { SINGLETON_ID } = require('../models/publicPageContentSettingModel');

const DEFAULT_PUBLIC_PAGE_CONTENT = Object.freeze({
  home: {
    hero: {
      eyebrow: 'Integrated Systems + AI Automation',
      title: 'We build integrated software systems that automate workflows and speed up execution.',
      subtitle: 'We provide engineering and software services for companies and individuals, with practical platforms that connect people, process, and data across education and industrial operations.',
      primaryLabel: 'Explore Projects',
      primaryHref: '/whatIOffer',
      secondaryLabel: 'How It Works',
      secondaryHref: '/about'
    },
    highlights: [
      { value: 'Multi-Domain', label: 'Integrated Systems', active: true, order: 10 },
      { value: 'AI + Human', label: 'Guided Automation', active: true, order: 20 },
      { value: 'End-to-End', label: 'Process Control', active: true, order: 30 }
    ],
    imageShowcase: [],
    featureSection: {
      eyebrow: 'What Changes',
      title: 'Everything is focused on practical systems, reliable automation, and execution speed.',
      body: 'We start from real workflows, then build connected tools that teams can actually use every day.'
    },
    features: [
      {
        icon: 'bi-exclamation-diamond-fill',
        tone: 'danger',
        title: 'What We Build',
        body: 'We present integrated systems that use AI to automate processes, reduce friction, and increase delivery speed.',
        active: true,
        order: 10
      },
      {
        icon: 'bi-funnel-fill',
        tone: 'primary',
        title: 'How We Work',
        body: 'We map real operational procedures first, then apply AI-human collaboration where it adds reliable value.',
        active: true,
        order: 20
      },
      {
        icon: 'bi-check2-circle',
        tone: 'success',
        title: 'Your Advantage',
        body: 'You get structured systems that are practical, scalable, and aligned with how your team actually works.',
        active: true,
        order: 30
      }
    ],
    solutions: {
      eyebrow: 'Core Solutions',
      title: 'Systems we build and improve.',
      items: [
        {
          step: '01',
          title: 'MySchool Integrated Management App',
          body: 'A comprehensive system for schools and mid-size academic organizations, controlling core processes and procedures in one platform.',
          active: true,
          order: 10
        },
        {
          step: '02',
          title: 'IELTS AI-Human Scoring and Feedback',
          body: 'Integrated IELTS Task 1 and Task 2 writing scoring with Cambridge-sample-aligned feedback, validated across available samples and repeat attempts for stable behavior on the same input.',
          active: true,
          order: 20
        },
        {
          step: '03',
          title: 'Industrial Automation for Steel and Casting',
          body: 'Software that closes the gap between engineering design and shop-floor execution, continuously evolved through real client deployments.',
          active: true,
          order: 30
        }
      ]
    },
    serviceScope: {
      eyebrow: 'Service Scope',
      title: 'Where this work fits.',
      tags: ['Schools', 'Academic Centers', 'IELTS Writing', 'AI-Human Scoring', 'Steel Plants', 'Casting Factories'],
      noteTitle: 'Current Focus',
      noteBody: 'We are not currently developing a Review Manager product. Our focus is integrated academic and industrial automation systems.'
    },
    supportCards: [
      {
        icon: 'bi-gear-wide-connected',
        variant: 'service',
        kicker: 'Engineering + Software Services',
        title: 'Built for companies and individuals',
        body: 'We deliver end-to-end engineering and software services from process analysis and architecture to implementation, integration, and operational support.',
        primaryLabel: 'Discuss Your Project',
        primaryHref: '/contact',
        secondaryLabel: '',
        secondaryHref: '',
        subtext: 'Tell us your goals and constraints.',
        active: true,
        order: 10
      },
      {
        icon: 'bi-cup-hot-fill',
        variant: 'coffee',
        kicker: 'Support The Work',
        title: 'Buy Me a Coffee',
        body: 'If our tools, systems, or guidance helped your work, you can support the next iteration and future builds.',
        primaryLabel: 'Show QR Code',
        primaryHref: '',
        secondaryLabel: 'Open Buy Me a Coffee',
        secondaryHref: 'https://www.buymeacoffee.com/paknejad',
        subtext: 'Thank you for helping keep it independent.',
        active: true,
        order: 20
      }
    ],
    finalCta: {
      eyebrow: 'Start The Next Build',
      title: 'Ready to automate and scale your operations?',
      body: 'Adopt integrated systems for education, assessment, and industry.',
      signedInPrimaryLabel: 'Open Dashboard',
      signedInPrimaryHref: '/dashboard',
      guestPrimaryLabel: 'Sign In',
      guestPrimaryHref: '/login',
      guestSecondaryLabel: 'Create Account',
      guestSecondaryHref: '/persons/join',
      contactLabel: 'Talk to Our Team',
      contactHref: '/contact'
    }
  },
  projects: {
    hero: {
      eyebrow: 'Projects',
      title: 'Projects',
      subtitle: 'Selected engineering, automation, education, and software systems shaped for practical delivery. These examples are recent project samples, not the full portfolio.',
      primaryLabel: 'Discuss Your Project',
      primaryHref: '/contact',
      secondaryLabel: 'How I Work',
      secondaryHref: '/about'
    },
    highlights: [
      { value: 'Recent Work', label: 'Detailed examples', active: true, order: 10 },
      { value: 'AI + Human', label: 'Quality + speed balance', active: true, order: 20 },
      { value: 'End-to-End', label: 'From design to operations', active: true, order: 30 }
    ],
    projectSection: {
      eyebrow: 'Selected Work',
      title: 'Recent Project Examples',
      body: 'Representative samples from recent work across academic platforms, AI feedback, and industrial automation.'
    },
    projectItems: [
      {
        step: '01',
        title: 'MySchool Integrated Management App',
        body: 'A comprehensive platform for schools and mid-size academic organizations that integrates core processes including scheduling, records, attendance, operational workflows, and management visibility in one system.',
        active: true,
        order: 10
      },
      {
        step: '02',
        title: 'IELTS AI-Human Scoring and Feedback',
        body: 'Integrated module for IELTS Writing Task 1 and Task 2 scoring with feedback behavior aligned to Cambridge sample expectations. Validation was repeated across available samples to maintain stable and similar system behavior for the same input attempts.',
        active: true,
        order: 20
      },
      {
        step: '03',
        title: 'Industrial Automation for Steel and Casting',
        body: 'A production-oriented software system that closes workflow gaps between engineering design divisions and shop-floor execution. It has been deployed by multiple companies and evolved through real client usage.',
        active: true,
        order: 30
      }
    ],
    resumeContext: {
      icon: 'bi-diagram-3',
      kicker: 'Context',
      title: 'Resume Context',
      intro: 'Background areas that support the delivery style above.',
      points: [
        'Mechanical engineering foundation with design and analysis focus.',
        'Academic and industrial project track across manufacturing and operations contexts.',
        'Experience with hydraulic and pneumatic systems, tooling, simulation, and implementation workflows.',
        'Hands-on delivery across design documentation, validation, and practical execution support.'
      ],
      noteTitle: 'Current Focus',
      noteBody: 'I am not currently developing the Review Manager product. Current development focus is integrated academic and industrial systems.'
    },
    servicePanel: {
      eyebrow: 'Project Domains',
      title: 'Service Areas',
      tags: [
        'Integrated Software Systems',
        'Education Operations',
        'AI-Human Evaluation Flows',
        'Industrial Automation',
        'Design-to-Execution Workflows',
        'Engineering Support Services',
        'Technical Documentation',
        'Process Validation'
      ]
    },
    finalCta: {
      title: 'Need execution-ready systems?',
      body: 'Share your requirements and constraints to scope a practical implementation path.',
      signedInPrimaryLabel: 'Open Dashboard',
      signedInPrimaryHref: '/dashboard',
      guestPrimaryLabel: 'Sign In',
      guestPrimaryHref: '/login',
      guestSecondaryLabel: 'Create Account',
      guestSecondaryHref: '/persons/join',
      contactLabel: 'Talk to Our Team',
      contactHref: '/contact'
    }
  },
  about: {
    hero: {
      eyebrow: 'About | Professional Portfolio',
      title: 'Engineering, Manufacturing, Software, and Teaching Portfolio',
      subtitle: 'I work across industrial engineering, manufacturing execution, software systems, and technical education. This page summarizes the fields I have worked in, then presents role-by-role experience with selected project visuals and supporting materials.',
      primaryLabel: 'View Job Experience',
      primaryHref: '#jobExperience',
      secondaryLabel: 'Get in Touch',
      secondaryHref: '/contact'
    },
    highlights: [
      { value: 'Engineering Methods', label: 'Design-to-production execution and systemization.', active: true, order: 10 },
      { value: 'Industrial Software', label: 'Automation-focused applications for real operations.', active: true, order: 20 },
      { value: 'Technical Training', label: 'Curriculum and mentorship linked to workplace outcomes.', active: true, order: 30 }
    ],
    fields: [
      { name: 'Industrial Automation', icon: 'bi-gear-wide-connected', active: true, order: 10 },
      { name: 'Manufacturing Methods', icon: 'bi-diagram-3', active: true, order: 20 },
      { name: 'Mechanical Design', icon: 'bi-rulers', active: true, order: 30 },
      { name: 'CFD and FSI Analysis', icon: 'bi-water', active: true, order: 40 },
      { name: 'Software Development', icon: 'bi-code-slash', active: true, order: 50 },
      { name: 'Data Engineering and BI', icon: 'bi-bar-chart-line', active: true, order: 60 },
      { name: 'Technical Documentation', icon: 'bi-file-earmark-text', active: true, order: 70 },
      { name: 'Instruction and Mentorship', icon: 'bi-easel2', active: true, order: 80 },
      { name: 'Research and Numerical Modeling', icon: 'bi-cpu', active: true, order: 90 },
      { name: 'Workflow Optimization', icon: 'bi-sliders2', active: true, order: 100 }
    ],
    experienceSection: {
      eyebrow: 'Experience',
      title: 'Job Experience Portfolio',
      body: 'Each job entry includes key contributions, selected visuals, and supporting materials.'
    },
    experiences: [
      {
        role: 'Technical Instructor (Industrial Automation and Systems Logic)',
        org: 'Robertson College',
        period: 'Apr 2024 - Present',
        focus: 'Teaching + Industrial Logic + Curriculum Design',
        highlights: [
          'Instructed advanced program logic and Python programming for automation-focused use cases.',
          'Developed information management curriculum aligned with PLM/ERP hierarchy and configuration control.',
          'Mentored engineering capstone projects with emphasis on technical documentation and build sequencing.',
          'Converted high-level engineering concepts into practical, executable workflows for learners.'
        ],
        summary: [
          'This role combines technical teaching and industrial systems thinking in a way that is directly transferable to real workplaces. I design learning paths that move from concepts to implementation, helping learners build dependable automation routines, clearer engineering logic, and stronger decision-making habits for production-grade environments.'
        ],
        attachments: [],
        media: [
          { comment: 'Team working is the key in every workplace.', url: '/uploads/GLOBAL/misc/aboutPage/Robertson_1.jpg' },
          { comment: 'Passionate students at the end of the term.', url: '/uploads/GLOBAL/misc/aboutPage/Robertson_2.jpg' },
          { comment: 'Capstone mentoring outcomes and student project artifacts demo.', url: '/uploads/GLOBAL/misc/aboutPage/Robertson_3.jpg' }
        ],
        active: true,
        order: 10
      },
      {
        role: 'Intermediate Methods and Mechanical Engineer',
        org: 'Pak Shareh Sepahan Co.',
        period: '2020 - 2024',
        focus: 'Methods Engineering + Production Integration',
        highlights: [
          'Developed Engineering Masters (EM) and Work Instructions (WI) for production and assembly execution.',
          'Led root-cause analysis on non-conformances and implemented corrective actions to improve throughput.',
          'Managed MBOM and material equipment lists under strict technical and configuration standards.',
          'Performed technical feasibility and make-vs-buy analysis for design change decisions.',
          'Coordinated with production, quality, and procurement for implementation readiness.'
        ],
        summary: [
          'I served as an Intermediate Methods and Mechanical Engineer overseeing the manufacturing and assembly of large-scale dust collector systems, primarily designed for steel plant environments. In this role, I worked closely with design, production, and shop-floor teams to translate engineering requirements into practical manufacturing steps, ensuring that each system met performance, reliability, and safety expectations.',
          'In addition to large systems, I contributed to three dedicated production lines focused on high-volume manufacturing of smaller dust collection machines for workshops and lighter industrial settings. I helped optimize these lines for repeatable quality and throughput, refining assembly sequences, coordinating with technicians, and resolving day-to-day technical issues that affected production flow.'
        ],
        attachments: [
          { name: 'PAK SHAREH SEPAHAN Dust Collector. BagHouse MIRA', url: '/uploads/GLOBAL/misc/aboutPage/PakSharehBaghouseBrochure.pdf' }
        ],
        media: [
          { comment: 'EM/WI documentation package snapshot.', url: '/uploads/GLOBAL/misc/aboutPage/Method_2.jpg' },
          { comment: 'Production-floor integration or execution sequence photo.', url: '/uploads/GLOBAL/misc/aboutPage/Method_1.jpg' },
          { comment: 'RCA evidence before/after quality or throughput chart.', url: '/uploads/GLOBAL/misc/aboutPage/Method_0.jpg' },
          { comment: 'Production-floor integration or execution sequence photo.', url: '/uploads/GLOBAL/misc/aboutPage/Method_3.jpg' },
          { comment: 'Production-floor integration or execution sequence photo.', url: '/uploads/GLOBAL/misc/aboutPage/Method_4.jpg' },
          { comment: 'Production-floor integration or execution sequence photo.', url: '/uploads/GLOBAL/misc/aboutPage/Method_5.jpg' },
          { comment: 'Production-floor integration or execution sequence photo.', url: '/uploads/GLOBAL/misc/aboutPage/Method_6.jpg' },
          { comment: 'Production-floor integration or execution sequence photo.', url: '/uploads/GLOBAL/misc/aboutPage/Method_7.jpg' },
          { comment: 'Production-floor integration or execution sequence photo.', url: '/uploads/GLOBAL/misc/aboutPage/Method_8.jpg' }
        ],
        active: true,
        order: 20
      },
      {
        role: 'Mechanical and Manufacturing Design Engineer',
        org: 'Pak Shareh Sepahan Co.',
        period: '2018 - 2020',
        focus: 'Mechanical Design + Simulation + Assembly Planning',
        highlights: [
          'Designed 3D models and 2D blueprints for structural sub-assemblies using CATIA V5 and SolidWorks.',
          'Optimized assembly build sequencing through simulation; improved performance efficiency by 15%.',
          'Prepared visual planning and assembly manuals for shop-floor implementation.',
          'Authored engineering change requests to refine tooling and manufacturing methods.'
        ],
        summary: [
          'As Mechanical and Manufacturing Design Engineer, I established the company first Computational Fluid Dynamics simulation capability, filling a critical gap in their engineering design division that previously lacked advanced analysis tools for dust collection systems.',
          'I conducted structural, mechanical, and functional analyses to ensure system performance, reliability, and safety under real-world operating conditions. By integrating CFD simulations with CAD modeling, I identified and resolved design bottlenecks early.'
        ],
        attachments: [],
        media: [
          { comment: 'CATIA/SolidWorks model and drawing gallery.', url: '/uploads/GLOBAL/misc/aboutPage/Design_1.jpg' },
          { comment: 'CATIA/SolidWorks model and drawing gallery.', url: '/uploads/GLOBAL/misc/aboutPage/Design_2.jpg' },
          { comment: 'CATIA/SolidWorks model and drawing gallery.', url: '/uploads/GLOBAL/misc/aboutPage/Design_3.png' },
          { comment: 'CATIA/SolidWorks model and drawing gallery.', url: '/uploads/GLOBAL/misc/aboutPage/Design_4.png' },
          { comment: 'CATIA/SolidWorks model and drawing gallery.', url: '/uploads/GLOBAL/misc/aboutPage/Design_5.png' },
          { comment: 'Assembly sequencing simulation snapshots.', url: '/uploads/GLOBAL/misc/aboutPage/Design_6.png' },
          { comment: '3D model.', url: '/uploads/GLOBAL/misc/aboutPage/Design_7.png' },
          { comment: '3D model.', url: '/uploads/GLOBAL/misc/aboutPage/Design_8.png' },
          { comment: '3D model.', url: '/uploads/GLOBAL/misc/aboutPage/Design_9.png' }
        ],
        active: true,
        order: 30
      },
      {
        role: 'Technical Lead and University Lecturer',
        org: 'IUT',
        period: '2012 - 2018',
        focus: 'Technical Leadership + Research + Training',
        highlights: [
          'Delivered instruction in mechanical engineering and computer science.',
          'Led mentorship programs for junior engineers and co-op students.',
          'Directed research on fluid-rigid-elastic structure interaction and vibration integrity challenges.',
          'Bridged academic research and practical engineering application across teams.'
        ],
        summary: [
          'As Technical Lead and University Lecturer at IUT from 2012 to 2018, I delivered advanced instruction in Mechanical Engineering and Computer Science, with a focus on computational fluid dynamics, structural analysis, programming, and manufacturing processes.',
          'I published numerous articles and technical reports across diverse fields including CFD, education methodologies, mechanical design, programming techniques, manufacturing optimization, and production workflows.'
        ],
        attachments: [],
        media: [
          { comment: 'Seasonal instructor in different universities.', url: '/uploads/GLOBAL/misc/aboutPage/Teaching_2.jpg' },
          { comment: 'University of Toronto.', url: '/uploads/GLOBAL/misc/Teaching.jpg' },
          { comment: 'Mentorship and supervised project showcase.', url: '/uploads/GLOBAL/misc/aboutPage/Teaching_3.jpg' }
        ],
        active: true,
        order: 40
      },
      {
        role: 'Industrial Software Developer',
        org: 'Rayan Tahlil Sepahan Company',
        period: '2010 - 2012',
        focus: 'Software Automation + QA + Engineering Tools',
        highlights: [
          'Developed industrial software for mechanical design and simulation workflow automation.',
          'Applied systems logic and QA protocols to ensure software reliability in production use.',
          'Adapted solution behavior to evolving project and manufacturing requirements.'
        ],
        summary: [
          'This role laid the software-engineering foundation for automation across mission-critical industrial and engineering environments, where reliability, traceability, and system uptime were non-negotiable.',
          'Working closely with mechanical engineers, production teams, and technical managers, I translated complex engineering requirements into robust software architectures that could evolve with changing manufacturing and project constraints.'
        ],
        attachments: [],
        media: [
          { comment: 'Production Line Control - Realtime management console.', url: '/uploads/GLOBAL/misc/aboutPage/Automation_0.jpg' },
          { comment: 'Software interface screenshots - Integrated software for managing the whole processes.', url: '/uploads/GLOBAL/misc/aboutPage/Automation_1.jpg' },
          { comment: 'Deployment or production usage evidence visual and pilot setup.', url: '/uploads/GLOBAL/misc/aboutPage/Automation_3.jpg' }
        ],
        active: true,
        order: 50
      }
    ],
    footerCta: {
      title: 'Portfolio First. Iteration Ready.',
      body: 'Next step: we can refine layout, image style, and content density based on your preferred design direction.',
      primaryLabel: 'Contact',
      primaryHref: '/contact',
      secondaryLabel: 'Open Biography',
      secondaryHref: '/bio'
    }
  }
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, max = 4000) {
  const token = String(value ?? '').replace(/\0/g, '').trim();
  return token.length > max ? token.slice(0, max) : token;
}

function valueOrDefault(source, key, fallback = '') {
  return isPlainObject(source) && hasOwn(source, key) ? source[key] : fallback;
}

function cleanHref(value, fallback = '') {
  const token = cleanString(value, 1000);
  if (!token) return cleanString(fallback, 1000);
  if (/[\s"'`<>\\]/.test(token)) return cleanString(fallback, 1000);
  if (token.startsWith('#')) return token;
  if (/^\/(?!\/)/.test(token)) return token;
  if (/^https:\/\//i.test(token)) return token;
  if (/^(mailto:|tel:)/i.test(token)) return token;
  return cleanString(fallback, 1000);
}

function cleanMediaUrl(value) {
  const token = cleanString(value, 1200);
  if (!token) return '';
  if (/[\0"'`<>\\]/.test(token)) return '';
  if (/^\/(?!\/)/.test(token)) return token;
  if (/^https:\/\//i.test(token)) return token;
  return '';
}

function cleanIcon(value, fallback = 'bi-check2-circle') {
  const token = cleanString(value, 80);
  if (!token || !/^[a-z0-9 _-]+$/i.test(token)) return fallback;
  const parts = token.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const iconPart = parts.find((part) => /^bi-[a-z0-9-]+$/i.test(part));
  if (iconPart) return iconPart;
  const first = parts.find((part) => part.toLowerCase() !== 'bi') || '';
  if (!first) return fallback;
  return first.startsWith('bi-') ? first : `bi-${first.replace(/^-+/, '')}`;
}

function cleanBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'off'].includes(token)) return false;
  return fallback;
}

function cleanOrder(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && !Number.isNaN(parsed) ? parsed : Number(fallback || 0);
}

function cleanDurationMs(value, fallback = 4500) {
  const parsed = cleanOrder(value, fallback);
  return Math.min(60000, Math.max(1000, parsed));
}

function normalizeLineList(value, fallback = [], max = 300) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/\r?\n/) : fallback);
  return (Array.isArray(source) ? source : [])
    .map((item) => cleanString(isPlainObject(item) ? item.text : item, max))
    .filter(Boolean);
}

function normalizeParagraphList(value, fallback = []) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/\n\s*\n/) : fallback);
  return (Array.isArray(source) ? source : [])
    .map((item) => cleanString(isPlainObject(item) ? item.text : item, 2000))
    .filter(Boolean);
}

function normalizeOrderedRows(value, fallback, normalizer, { runtime = false } = {}) {
  const source = Array.isArray(value) ? value : fallback;
  const rows = (Array.isArray(source) ? source : [])
    .map((row, index) => normalizer(isPlainObject(row) ? row : {}, index))
    .filter(Boolean)
    .sort((a, b) => cleanOrder(a.order, 0) - cleanOrder(b.order, 0));
  return runtime ? rows.filter((row) => row.active !== false) : rows;
}

function normalizeHero(rawHero = {}, fallbackHero = {}) {
  const source = isPlainObject(rawHero) ? rawHero : {};
  const base = isPlainObject(fallbackHero) ? fallbackHero : {};
  return {
    eyebrow: cleanString(valueOrDefault(source, 'eyebrow', base.eyebrow), 140),
    title: cleanString(valueOrDefault(source, 'title', base.title), 260),
    subtitle: cleanString(valueOrDefault(source, 'subtitle', base.subtitle), 1000),
    primaryLabel: cleanString(valueOrDefault(source, 'primaryLabel', base.primaryLabel), 140),
    primaryHref: cleanHref(valueOrDefault(source, 'primaryHref', base.primaryHref), base.primaryHref || ''),
    secondaryLabel: cleanString(valueOrDefault(source, 'secondaryLabel', base.secondaryLabel), 140),
    secondaryHref: cleanHref(valueOrDefault(source, 'secondaryHref', base.secondaryHref), base.secondaryHref || '')
  };
}

function normalizeHighlights(value, fallback, runtime) {
  return normalizeOrderedRows(value, fallback, (row, index) => {
    const valueText = cleanString(row.value || row.title, 120);
    const label = cleanString(row.label || row.body, 220);
    if (!valueText && !label) return null;
    return {
      value: valueText,
      label,
      active: cleanBoolean(row.active, true),
      order: cleanOrder(row.order, (index + 1) * 10)
    };
  }, { runtime });
}

function normalizeFinalCta(rawCta = {}, fallbackCta = {}) {
  const source = isPlainObject(rawCta) ? rawCta : {};
  const base = isPlainObject(fallbackCta) ? fallbackCta : {};
  return {
    eyebrow: cleanString(valueOrDefault(source, 'eyebrow', base.eyebrow), 140),
    title: cleanString(valueOrDefault(source, 'title', base.title), 260),
    body: cleanString(valueOrDefault(source, 'body', base.body), 900),
    signedInPrimaryLabel: cleanString(valueOrDefault(source, 'signedInPrimaryLabel', base.signedInPrimaryLabel), 140),
    signedInPrimaryHref: cleanHref(valueOrDefault(source, 'signedInPrimaryHref', base.signedInPrimaryHref), base.signedInPrimaryHref || '/dashboard'),
    guestPrimaryLabel: cleanString(valueOrDefault(source, 'guestPrimaryLabel', base.guestPrimaryLabel), 140),
    guestPrimaryHref: cleanHref(valueOrDefault(source, 'guestPrimaryHref', base.guestPrimaryHref), base.guestPrimaryHref || '/login'),
    guestSecondaryLabel: cleanString(valueOrDefault(source, 'guestSecondaryLabel', base.guestSecondaryLabel), 140),
    guestSecondaryHref: cleanHref(valueOrDefault(source, 'guestSecondaryHref', base.guestSecondaryHref), base.guestSecondaryHref || '/persons/join'),
    contactLabel: cleanString(valueOrDefault(source, 'contactLabel', base.contactLabel), 140),
    contactHref: cleanHref(valueOrDefault(source, 'contactHref', base.contactHref), base.contactHref || '/contact'),
    primaryLabel: cleanString(valueOrDefault(source, 'primaryLabel', base.primaryLabel), 140),
    primaryHref: cleanHref(valueOrDefault(source, 'primaryHref', base.primaryHref), base.primaryHref || ''),
    secondaryLabel: cleanString(valueOrDefault(source, 'secondaryLabel', base.secondaryLabel), 140),
    secondaryHref: cleanHref(valueOrDefault(source, 'secondaryHref', base.secondaryHref), base.secondaryHref || '')
  };
}

function normalizeHome(rawHome = {}, options = {}) {
  const runtime = options.runtime === true;
  const input = isPlainObject(rawHome) ? rawHome : {};
  const base = DEFAULT_PUBLIC_PAGE_CONTENT.home;

  return {
    hero: normalizeHero(input.hero, base.hero),
    highlights: normalizeHighlights(input.highlights, base.highlights, runtime),
    imageShowcase: normalizeOrderedRows(input.imageShowcase, base.imageShowcase, (row, index) => {
      const src = cleanMediaUrl(row.src || row.imageUrl || row.url);
      if (!src) return null;
      return {
        src,
        alt: cleanString(row.alt, 240),
        title: cleanString(row.title, 180),
        caption: cleanString(row.caption, 500),
        durationMs: cleanDurationMs(row.durationMs, 4500),
        active: cleanBoolean(row.active, true),
        order: cleanOrder(row.order, (index + 1) * 10)
      };
    }, { runtime }),
    featureSection: {
      eyebrow: cleanString(valueOrDefault(input.featureSection, 'eyebrow', base.featureSection.eyebrow), 140),
      title: cleanString(valueOrDefault(input.featureSection, 'title', base.featureSection.title), 260),
      body: cleanString(valueOrDefault(input.featureSection, 'body', base.featureSection.body), 900)
    },
    features: normalizeOrderedRows(input.features, base.features, (row, index) => {
      const title = cleanString(row.title, 180);
      const body = cleanString(row.body, 800);
      if (!title && !body) return null;
      const tone = ['danger', 'primary', 'success', 'warning', 'info'].includes(cleanString(row.tone, 30)) ? cleanString(row.tone, 30) : 'primary';
      return {
        icon: cleanIcon(row.icon, 'bi-check2-circle'),
        tone,
        title,
        body,
        active: cleanBoolean(row.active, true),
        order: cleanOrder(row.order, (index + 1) * 10)
      };
    }, { runtime }),
    solutions: {
      eyebrow: cleanString(valueOrDefault(input.solutions, 'eyebrow', base.solutions.eyebrow), 140),
      title: cleanString(valueOrDefault(input.solutions, 'title', base.solutions.title), 260),
      items: normalizeOrderedRows(input.solutions?.items, base.solutions.items, (row, index) => {
        const title = cleanString(row.title, 180);
        const body = cleanString(row.body, 900);
        if (!title && !body) return null;
        return {
          step: cleanString(row.step || String(index + 1).padStart(2, '0'), 20),
          title,
          body,
          active: cleanBoolean(row.active, true),
          order: cleanOrder(row.order, (index + 1) * 10)
        };
      }, { runtime })
    },
    serviceScope: {
      eyebrow: cleanString(valueOrDefault(input.serviceScope, 'eyebrow', base.serviceScope.eyebrow), 140),
      title: cleanString(valueOrDefault(input.serviceScope, 'title', base.serviceScope.title), 260),
      tags: normalizeLineList(input.serviceScope?.tags, base.serviceScope.tags, 120),
      noteTitle: cleanString(valueOrDefault(input.serviceScope, 'noteTitle', base.serviceScope.noteTitle), 180),
      noteBody: cleanString(valueOrDefault(input.serviceScope, 'noteBody', base.serviceScope.noteBody), 800)
    },
    supportCards: normalizeOrderedRows(input.supportCards, base.supportCards, (row, index) => {
      const title = cleanString(row.title, 180);
      const body = cleanString(row.body, 900);
      if (!title && !body) return null;
      const variant = cleanString(row.variant, 30) === 'coffee' ? 'coffee' : 'service';
      return {
        icon: cleanIcon(row.icon, variant === 'coffee' ? 'bi-cup-hot-fill' : 'bi-gear-wide-connected'),
        variant,
        kicker: cleanString(row.kicker, 140),
        title,
        body,
        primaryLabel: cleanString(row.primaryLabel, 140),
        primaryHref: cleanHref(row.primaryHref, ''),
        secondaryLabel: cleanString(row.secondaryLabel, 140),
        secondaryHref: cleanHref(row.secondaryHref, ''),
        subtext: cleanString(row.subtext, 260),
        active: cleanBoolean(row.active, true),
        order: cleanOrder(row.order, (index + 1) * 10)
      };
    }, { runtime }),
    finalCta: normalizeFinalCta(input.finalCta, base.finalCta)
  };
}

function normalizeProjects(rawProjects = {}, options = {}) {
  const runtime = options.runtime === true;
  const input = isPlainObject(rawProjects) ? rawProjects : {};
  const base = DEFAULT_PUBLIC_PAGE_CONTENT.projects;

  return {
    hero: normalizeHero(input.hero, base.hero),
    highlights: normalizeHighlights(input.highlights, base.highlights, runtime),
    projectSection: {
      eyebrow: cleanString(valueOrDefault(input.projectSection, 'eyebrow', base.projectSection.eyebrow), 140),
      title: cleanString(valueOrDefault(input.projectSection, 'title', base.projectSection.title), 260),
      body: cleanString(valueOrDefault(input.projectSection, 'body', base.projectSection.body), 900)
    },
    projectItems: normalizeOrderedRows(input.projectItems, base.projectItems, (row, index) => {
      const title = cleanString(row.title, 180);
      const body = cleanString(row.body, 1000);
      if (!title && !body) return null;
      return {
        step: cleanString(row.step || String(index + 1).padStart(2, '0'), 20),
        title,
        body,
        active: cleanBoolean(row.active, true),
        order: cleanOrder(row.order, (index + 1) * 10)
      };
    }, { runtime }),
    resumeContext: {
      icon: cleanIcon(input.resumeContext?.icon, base.resumeContext.icon),
      kicker: cleanString(valueOrDefault(input.resumeContext, 'kicker', base.resumeContext.kicker), 140),
      title: cleanString(valueOrDefault(input.resumeContext, 'title', base.resumeContext.title), 220),
      intro: cleanString(valueOrDefault(input.resumeContext, 'intro', base.resumeContext.intro), 700),
      points: normalizeLineList(input.resumeContext?.points, base.resumeContext.points, 300),
      noteTitle: cleanString(valueOrDefault(input.resumeContext, 'noteTitle', base.resumeContext.noteTitle), 180),
      noteBody: cleanString(valueOrDefault(input.resumeContext, 'noteBody', base.resumeContext.noteBody), 800)
    },
    servicePanel: {
      eyebrow: cleanString(valueOrDefault(input.servicePanel, 'eyebrow', base.servicePanel.eyebrow), 140),
      title: cleanString(valueOrDefault(input.servicePanel, 'title', base.servicePanel.title), 220),
      tags: normalizeLineList(input.servicePanel?.tags, base.servicePanel.tags, 140)
    },
    finalCta: normalizeFinalCta(input.finalCta, base.finalCta)
  };
}

function normalizeAbout(rawAbout = {}, options = {}) {
  const runtime = options.runtime === true;
  const input = isPlainObject(rawAbout) ? rawAbout : {};
  const base = DEFAULT_PUBLIC_PAGE_CONTENT.about;

  return {
    hero: normalizeHero(input.hero, base.hero),
    highlights: normalizeHighlights(input.highlights, base.highlights, runtime),
    fields: normalizeOrderedRows(input.fields, base.fields, (row, index) => {
      const name = cleanString(row.name || row.title, 180);
      if (!name) return null;
      return {
        name,
        icon: cleanIcon(row.icon, 'bi-check2-circle'),
        active: cleanBoolean(row.active, true),
        order: cleanOrder(row.order, (index + 1) * 10)
      };
    }, { runtime }),
    experienceSection: {
      eyebrow: cleanString(valueOrDefault(input.experienceSection, 'eyebrow', base.experienceSection.eyebrow), 140),
      title: cleanString(valueOrDefault(input.experienceSection, 'title', base.experienceSection.title), 260),
      body: cleanString(valueOrDefault(input.experienceSection, 'body', base.experienceSection.body), 900)
    },
    experiences: normalizeOrderedRows(input.experiences, base.experiences, (row, index) => {
      const role = cleanString(row.role, 220);
      const org = cleanString(row.org, 180);
      const period = cleanString(row.period, 120);
      const focus = cleanString(row.focus, 180);
      const highlights = normalizeLineList(row.highlights, [], 500);
      const summary = normalizeParagraphList(row.summary, []);
      const attachments = normalizeOrderedRows(row.attachments, [], (attachment, attachmentIndex) => {
        const name = cleanString(attachment.name || attachment.title, 180);
        const url = cleanMediaUrl(attachment.url || attachment.href);
        if (!name && !url) return null;
        return {
          name: name || 'Attachment',
          url,
          active: cleanBoolean(attachment.active, true),
          order: cleanOrder(attachment.order, (attachmentIndex + 1) * 10)
        };
      }, { runtime });
      const media = normalizeOrderedRows(row.media || row.placeholders, [], (mediaRow, mediaIndex) => {
        const comment = cleanString(mediaRow.comment || mediaRow.caption || mediaRow.alt, 260);
        const url = cleanMediaUrl(mediaRow.url || mediaRow.src || mediaRow.imageUrl);
        if (!comment && !url) return null;
        return {
          comment,
          url,
          active: cleanBoolean(mediaRow.active, true),
          order: cleanOrder(mediaRow.order, (mediaIndex + 1) * 10)
        };
      }, { runtime });

      if (!role && !org && !highlights.length && !summary.length && !media.length) return null;

      return {
        role,
        org,
        period,
        focus,
        highlights,
        summary,
        attachments,
        media,
        placeholders: media,
        active: cleanBoolean(row.active, true),
        order: cleanOrder(row.order, (index + 1) * 10)
      };
    }, { runtime }),
    footerCta: normalizeFinalCta(input.footerCta, base.footerCta)
  };
}

function normalizeContent(rawContent = {}, options = {}) {
  const source = isPlainObject(rawContent) ? rawContent : {};
  return {
    home: normalizeHome(source.home, options),
    projects: normalizeProjects(source.projects, options),
    about: normalizeAbout(source.about, options)
  };
}

function parseSubmittedContent(payload = {}) {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch (_) {
      throw new Error('Public page content payload is not valid JSON.');
    }
  }
  if (typeof payload?.pageJson === 'string') return parseSubmittedContent(payload.pageJson);
  if (typeof payload?.contentJson === 'string') return parseSubmittedContent(payload.contentJson);
  if (isPlainObject(payload?.content)) return payload.content;
  if (isPlainObject(payload?.pages)) return payload.pages;
  if (isPlainObject(payload) && (hasOwn(payload, 'home') || hasOwn(payload, 'projects') || hasOwn(payload, 'about'))) {
    return payload;
  }
  throw new Error('No public page content was submitted. Please refresh the page and save again.');
}

async function getRawRecord(options = {}) {
  return publicPageContentSettingRepository.getSettings(options);
}

async function getPublicPageContentModel(options = {}) {
  const record = await getRawRecord(options);
  return normalizeContent(record?.pages || {}, { runtime: true });
}

async function getSettingsForManagement(options = {}) {
  const record = await getRawRecord(options);
  return {
    id: record?.id || SINGLETON_ID,
    hasSavedSettings: Boolean(record?.updatedAt),
    updatedAt: record?.updatedAt || record?.audit?.lastUpdateDateTime || '',
    content: normalizeContent(record?.pages || {}, { runtime: false }),
    defaults: deepClone(DEFAULT_PUBLIC_PAGE_CONTENT)
  };
}

async function saveSettings(payload = {}, auditUser = null, options = {}) {
  const incoming = parseSubmittedContent(payload);
  const normalized = normalizeContent(incoming, { runtime: false });
  const saved = await publicPageContentSettingRepository.updateSettings({
    id: SINGLETON_ID,
    pages: normalized,
    isActive: true
  }, auditUser, options);

  return {
    id: saved?.id || SINGLETON_ID,
    updatedAt: saved?.updatedAt || saved?.audit?.lastUpdateDateTime || '',
    content: normalizeContent(saved?.pages || normalized, { runtime: false })
  };
}

module.exports = {
  SINGLETON_ID,
  DEFAULT_PUBLIC_PAGE_CONTENT,
  normalizeContent,
  getPublicPageContentModel,
  getSettingsForManagement,
  saveSettings
};
