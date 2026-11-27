'use strict';

const PROFILES = Object.freeze([
  Object.freeze({
    consumerKey: 'word_of_day.form',
    serviceKey: 'school.word_of_day_autofill',
    outputBindings: Object.freeze([
      Object.freeze({ resultKey: 'pronunciation', target: 'dom', selector: '#wodPronunciation' }),
      Object.freeze({ resultKey: 'meaning', target: 'dom', selector: '#wodMeaning' }),
      Object.freeze({ resultKey: 'examples', target: 'hook', hook: 'wodExamples' }),
      Object.freeze({ resultKey: 'difficulty', target: 'dom', selector: 'input[name="difficulty"]' }),
      Object.freeze({ resultKey: 'wordTypes', target: 'dom', selector: '[data-wod-word-type]' })
    ])
  })
]);

function getFormBindingProfile(consumerKey, serviceKey) {
  const consumer = String(consumerKey || '').trim();
  const service = String(serviceKey || '').trim();
  return PROFILES.find((row) => (
    row.consumerKey === consumer && row.serviceKey === service
  )) || null;
}

function listFormBindingProfilesForService(serviceKey) {
  const service = String(serviceKey || '').trim();
  return PROFILES.filter((row) => row.serviceKey === service);
}

module.exports = {
  PROFILES,
  getFormBindingProfile,
  listFormBindingProfilesForService
};