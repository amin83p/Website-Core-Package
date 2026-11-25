(function (global) {
  'use strict';

  const HUB_TIMELINE_MAX_CARDS_PER_BUCKET_PER_SIDE = 2;
  const HUB_TIMELINE_REGIONAL_WINDOW_PCT = 4;
  const HUB_TIMELINE_CARD_HEIGHT_PX = 58;
  const HUB_TIMELINE_DEFAULT_STEM_PX = 48;

  function normalizeSide(side) {
    return side === 'above' ? 'above' : 'below';
  }

  function hubTimelineLayoutSideFootprint(layout) {
    const stem = Math.max(0, Number(layout?.stemLen) || HUB_TIMELINE_DEFAULT_STEM_PX);
    return stem + HUB_TIMELINE_CARD_HEIGHT_PX;
  }

  function hubTimelineLayoutSideLoad(layouts, side) {
    const want = normalizeSide(side);
    return (Array.isArray(layouts) ? layouts : []).reduce(function (sum, layout) {
      if (normalizeSide(layout?.side) !== want) return sum;
      return sum + hubTimelineLayoutSideFootprint(layout);
    }, 0);
  }

  function hubTimelineLayoutRegionalLoad(layouts, percent, side, windowPct) {
    const want = normalizeSide(side);
    const p = Number(percent) || 0;
    const win = Number(windowPct) > 0 ? Number(windowPct) : HUB_TIMELINE_REGIONAL_WINDOW_PCT;
    return (Array.isArray(layouts) ? layouts : []).reduce(function (sum, layout) {
      if (normalizeSide(layout?.side) !== want) return sum;
      const lp = Number(layout?.percent) || 0;
      if (Math.abs(lp - p) > win) return sum;
      return sum + hubTimelineLayoutSideFootprint(layout);
    }, 0);
  }

  function hubTimelineLayoutSideCounts(layouts) {
    const counts = { below: 0, above: 0 };
    (Array.isArray(layouts) ? layouts : []).forEach(function (layout) {
      const key = normalizeSide(layout?.side);
      counts[key] += 1;
    });
    return counts;
  }

  function pickHubTimelineLayoutSide(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const percent = Number(opts.percent) || 0;
    const bucket = String(opts.bucket || '').trim() || percent.toFixed(3);
    const belowByBucket = opts.belowByBucket && typeof opts.belowByBucket === 'object' ? opts.belowByBucket : {};
    const aboveByBucket = opts.aboveByBucket && typeof opts.aboveByBucket === 'object' ? opts.aboveByBucket : {};
    const assignedLayouts = Array.isArray(opts.assignedLayouts) ? opts.assignedLayouts : [];
    const maxPerSide = Number(opts.maxPerBucketPerSide) > 0
      ? Number(opts.maxPerBucketPerSide)
      : HUB_TIMELINE_MAX_CARDS_PER_BUCKET_PER_SIDE;

    const belowInBucket = Number(belowByBucket[bucket]) || 0;
    const aboveInBucket = Number(aboveByBucket[bucket]) || 0;
    const belowBlocked = belowInBucket >= maxPerSide;
    const aboveBlocked = aboveInBucket >= maxPerSide;

    const candidates = [];
    if (!belowBlocked) candidates.push('below');
    if (!aboveBlocked) candidates.push('above');
    if (!candidates.length) candidates.push('below', 'above');

    const globalBelow = hubTimelineLayoutSideLoad(assignedLayouts, 'below');
    const globalAbove = hubTimelineLayoutSideLoad(assignedLayouts, 'above');

    function scoreSide(side) {
      let score = hubTimelineLayoutRegionalLoad(assignedLayouts, percent, side, HUB_TIMELINE_REGIONAL_WINDOW_PCT);
      score += hubTimelineLayoutSideLoad(assignedLayouts, side) * 0.12;
      if (side === 'below') score += belowInBucket * 90;
      else score += aboveInBucket * 90;
      if (side === 'below' && belowBlocked) score += 1e9;
      if (side === 'above' && aboveBlocked) score += 1e9;
      if (globalBelow > globalAbove && side === 'above') score -= Math.min(120, (globalBelow - globalAbove) * 0.08);
      if (globalAbove > globalBelow && side === 'below') score -= Math.min(120, (globalAbove - globalBelow) * 0.08);
      return score;
    }

    candidates.sort(function (a, b) {
      const diff = scoreSide(a) - scoreSide(b);
      if (diff !== 0) return diff;
      return a === 'below' ? -1 : 1;
    });
    return candidates[0] || 'below';
  }

  function simulateHubTimelineSideAssignment(percents, maxPerBucketPerSide) {
    const assignedLayouts = [];
    const belowByBucket = {};
    const aboveByBucket = {};
    (Array.isArray(percents) ? percents : []).forEach(function (rawPercent) {
      const percent = Number(rawPercent) || 0;
      const bucket = percent.toFixed(3);
      if (!belowByBucket[bucket]) belowByBucket[bucket] = 0;
      if (!aboveByBucket[bucket]) aboveByBucket[bucket] = 0;
      const side = pickHubTimelineLayoutSide({
        percent: percent,
        bucket: bucket,
        belowByBucket: belowByBucket,
        aboveByBucket: aboveByBucket,
        assignedLayouts: assignedLayouts,
        maxPerBucketPerSide: maxPerBucketPerSide
      });
      if (side === 'below') belowByBucket[bucket] += 1;
      else aboveByBucket[bucket] += 1;
      assignedLayouts.push({
        percent: percent,
        side: side,
        stemLen: HUB_TIMELINE_DEFAULT_STEM_PX
      });
    });
    return assignedLayouts;
  }

  const api = {
    HUB_TIMELINE_MAX_CARDS_PER_BUCKET_PER_SIDE,
    HUB_TIMELINE_REGIONAL_WINDOW_PCT,
    HUB_TIMELINE_CARD_HEIGHT_PX,
    hubTimelineLayoutSideFootprint,
    hubTimelineLayoutSideLoad,
    hubTimelineLayoutRegionalLoad,
    hubTimelineLayoutSideCounts,
    pickHubTimelineLayoutSide,
    simulateHubTimelineSideAssignment
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof global !== 'undefined') {
    global.HubStudentTimelineLayoutBalance = api;
  }
}(typeof window !== 'undefined' ? window : global));