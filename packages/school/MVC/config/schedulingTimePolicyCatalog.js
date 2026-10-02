'use strict';

const DEFAULT_DAY_BOUNDS = Object.freeze({
  earliestStart: '08:00',
  latestEnd: '20:00'
});

const DEFAULT_TIME_FRAMES = Object.freeze([
  { id: 'frame_morning', label: 'Morning', startTime: '09:00', endTime: '12:00', sortOrder: 1 },
  { id: 'frame_afternoon', label: 'Afternoon', startTime: '12:30', endTime: '15:30', sortOrder: 2 },
  { id: 'frame_evening', label: 'Evening', startTime: '15:30', endTime: '18:30', sortOrder: 3 }
]);

function listDefaultTimeFrames() {
  return DEFAULT_TIME_FRAMES.map((row) => ({ ...row }));
}

function defaultDayBounds() {
  return { ...DEFAULT_DAY_BOUNDS };
}

module.exports = {
  DEFAULT_DAY_BOUNDS,
  DEFAULT_TIME_FRAMES,
  listDefaultTimeFrames,
  defaultDayBounds
};
