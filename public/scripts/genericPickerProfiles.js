(function registerGenericPickerProfiles(global) {
  const core = global.GenericPickerCore;
  if (!core) return;

  core.registerProfile(['section', 'sections'], {
    icon: 'bi-grid-fill'
  });

  core.registerProfile(['operation', 'operations'], {
    icon: 'bi-lightning-charge-fill'
  });

  core.registerProfile(['person', 'persons'], {
    icon: 'bi-person-badge-fill'
  });

  core.registerProfile(['user', 'users'], {
    icon: 'bi-person-circle'
  });

  core.registerProfile(['organization', 'organizations'], {
    icon: 'bi-building'
  });

  core.registerProfile(['access', 'accesses'], {
    icon: 'bi-shield-lock-fill'
  });

  core.registerProfile(['microassessment', 'microassessments'], {
    icon: 'bi-card-checklist',
    getTitle: (item, helpers) => {
      const key = String(item?.question_key || '').trim();
      const title = String(item?.title || '').trim();
      if (key && title) return `${key} - ${title}`;
      return key || title || String(item?.id || 'Untitled Assessment');
    },
    getSummary: (item, helpers) => {
      const criterion = String(item?.criterion || '').trim();
      const band = (item?.band !== undefined && item?.band !== null && String(item?.band).trim() !== '')
        ? `Band ${item.band}`
        : '';
      const route = String(item?.prompt_group || '').trim();
      const q = helpers.truncate(String(item?.atomic_question || '').trim(), 90);
      const parts = [criterion, band, route].filter(Boolean);
      const meta = parts.length ? `[${parts.join(' | ')}] ` : '';
      return `${meta}${q || 'No question text'}`;
    }
  });

  core.registerProfile(['api-provider', 'api-providers', 'apiproviders', 'ielts-api-provider', 'ielts-api-providers'], {
    icon: 'bi-key-fill',
    getTitle: (item) => {
      return String(item?.name || item?.id || 'API Provider').trim();
    },
    getSummary: (item, helpers) => {
      const provider = String(item?.providerId || '').trim();
      const model = String(item?.modelId || '').trim();
      const activeLabel = item?.isActive === false ? 'Inactive' : 'Active';
      const isDefault = item?.isDefault ? 'Default' : '';
      const parts = [provider ? `Provider: ${provider}` : '', model ? `Model: ${model}` : '', activeLabel, isDefault].filter(Boolean);
      return parts.join(' | ') || 'API provider record';
    },
    getStatusBadge: (item) => {
      const activeBadge = item?.isActive === false
        ? '<span class="badge bg-secondary-subtle text-secondary-emphasis border mb-1">Inactive</span>'
        : '<span class="badge bg-success-subtle text-success-emphasis border mb-1">Active</span>';
      if (item?.isDefault) {
        return `${activeBadge}<br><span class="badge bg-primary mb-1">Default</span>`;
      }
      return activeBadge;
    }
  });

  core.registerProfile(['clb-benchmarks', 'clbbenchmarks'], {
    icon: 'bi-123',
    getSummary(item, helpers) {
      const bits = [];
      if (item?.skillId) bits.push(`Skill: ${item.skillId}`);
      if (item?.stageId) bits.push(`Stage: ${item.stageId}`);
      if (item?.status) bits.push(`Status: ${helpers?.toLabel ? helpers.toLabel(item.status) : item.status}`);
      return bits.join(' | ') || 'CLB benchmark';
    }
  });

  core.registerProfile(['clb-competency-areas', 'clbcompetencyareas'], {
    icon: 'bi-diagram-3',
    getSummary(item, helpers) {
      const bits = [];
      if (item?.skillId) bits.push(`Skill: ${item.skillId}`);
      if (item?.status) bits.push(`Status: ${helpers.toLabel ? helpers.toLabel(item.status) : item.status}`);
      return bits.join(' | ') || 'CLB competency area';
    }
  });

  core.registerProfile(['clb-framework', 'clbframework'], {
    icon: 'bi-diagram-2-fill',
    getSummary(item, helpers) {
      const bits = [];
      if (item?.code) bits.push(`Code: ${item.code}`);
      if (item?.status) bits.push(`Status: ${helpers.toLabel ? helpers.toLabel(item.status) : item.status}`);
      return bits.join(' | ') || 'CLB framework';
    }
  });

  core.registerProfile(['clb-skills', 'clbskills'], {
    icon: 'bi-list-check',
    getSummary(item, helpers) {
      const bits = [];
      if (item?.code) bits.push(`Code: ${item.code}`);
      if (item?.modality) bits.push(`Modality: ${helpers.toLabel ? helpers.toLabel(item.modality) : item.modality}`);
      if (item?.status) bits.push(`Status: ${helpers.toLabel ? helpers.toLabel(item.status) : item.status}`);
      return bits.join(' | ') || 'CLB skill';
    }
  });

  core.registerProfile(['clb-competencies', 'clbcompetencies'], {
    icon: 'bi-ui-checks',
    getSummary(item, helpers) {
      const bits = [];
      if (item?.benchmarkId) bits.push(`Benchmark: ${item.benchmarkId}`);
      if (item?.competencyAreaId) bits.push(`Area: ${item.competencyAreaId}`);
      if (item?.status) bits.push(`Status: ${helpers.toLabel ? helpers.toLabel(item.status) : item.status}`);
      return bits.join(' | ') || 'CLB competency';
    }
  });

  core.registerProfile(['clb-indicators', 'clbindicators'], {
    icon: 'bi-bullseye',
    getSummary(item, helpers) {
      const bits = [];
      if (item?.competencyId) bits.push(`Competency: ${item.competencyId}`);
      if (item?.benchmarkId) bits.push(`Benchmark: ${item.benchmarkId}`);
      if (item?.status) bits.push(`Status: ${helpers.toLabel ? helpers.toLabel(item.status) : item.status}`);
      return bits.join(' | ') || 'CLB indicator';
    }
  });

  core.registerProfile(['clb-profile-of-ability', 'clbprofileofability'], {
    icon: 'bi-person-lines-fill',
    getSummary(item, helpers) {
      const bits = [];
      if (item?.skillId) bits.push(`Skill: ${item.skillId}`);
      if (item?.benchmarkId) bits.push(`Benchmark: ${item.benchmarkId}`);
      if (item?.status) bits.push(`Status: ${helpers.toLabel ? helpers.toLabel(item.status) : item.status}`);
      return bits.join(' | ') || 'Profile of ability';
    }
  });

  core.registerProfile(['clb-features-of-communication', 'clbfeaturesofcommunication'], {
    icon: 'bi-chat-square-text',
    getSummary(item, helpers) {
      const bits = [];
      if (item?.skillId) bits.push(`Skill: ${item.skillId}`);
      if (item?.benchmarkId) bits.push(`Benchmark: ${item.benchmarkId}`);
      if (item?.status) bits.push(`Status: ${helpers.toLabel ? helpers.toLabel(item.status) : item.status}`);
      return bits.join(' | ') || 'Feature of communication';
    }
  });

  core.registerProfile(['clb-sample-task-labels', 'clbsampletasklabels'], {
    icon: 'bi-card-list',
    getSummary(item, helpers) {
      const bits = [];
      if (item?.benchmarkId) bits.push(`Benchmark: ${item.benchmarkId}`);
      if (item?.competencyId) bits.push(`Competency: ${item.competencyId}`);
      if (item?.status) bits.push(`Status: ${helpers.toLabel ? helpers.toLabel(item.status) : item.status}`);
      return bits.join(' | ') || 'Sample task label';
    }
  });

  core.registerProfile(['clb-stages', 'clbstages'], {
    icon: 'bi-signpost-split-fill',
    getSummary(item, helpers) {
      const bits = [];
      if (item?.frameworkId) bits.push(`Framework: ${item.frameworkId}`);
      if (item?.minBenchmark !== undefined && item?.maxBenchmark !== undefined) bits.push(`Range: ${item.minBenchmark}-${item.maxBenchmark}`);
      if (item?.status) bits.push(`Status: ${helpers.toLabel ? helpers.toLabel(item.status) : item.status}`);
      return bits.join(' | ') || 'CLB stage';
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
