const pteScoringDefaultsDataService = require('../../services/pte/pteScoringDefaultsDataService');

function cleanText(value, max = 4000) {
  return String(value || '').replace(/\0/g, '').trim().slice(0, max);
}

function parseMaybeJson(input, fallback = null) {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input === 'object') return input;
  const token = String(input || '').trim();
  if (!token) return fallback;
  try {
    return JSON.parse(token);
  } catch (_) {
    throw new Error('Invalid JSON payload.');
  }
}

async function showDefaultsPage(req, res) {
  try {
    const options = pteScoringDefaultsDataService.getFormOptions();
    return res.render('pte/scoring/defaults', {
      title: 'PTE Scoring Defaults',
      formOptions: options,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function getTypeDefaults(req, res) {
  try {
    const result = await pteScoringDefaultsDataService.getTypeProfile({
      testType: cleanText(req.query?.testType, 40),
      questionType: cleanText(req.query?.questionType, 120),
      historyLimit: Number.parseInt(String(req.query?.historyLimit || '25'), 10) || 25
    }, req.user, {
      backendMode: req.backendMode
    });
    return res.json({
      status: 'success',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function updateTypeDefaults(req, res) {
  try {
    const scoringConfig = parseMaybeJson(req.body?.scoringConfig, req.body?.scoringConfig || {});
    const result = await pteScoringDefaultsDataService.updateTypeProfile({
      testType: cleanText(req.body?.testType, 40),
      questionType: cleanText(req.body?.questionType, 120),
      scoringConfig,
      changeNote: cleanText(req.body?.changeNote, 1000),
      historyLimit: Number.parseInt(String(req.body?.historyLimit || '25'), 10) || 25
    }, req.user, {
      backendMode: req.backendMode
    });
    return res.json({
      status: 'success',
      message: 'Scoring defaults updated successfully.',
      results: result
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  showDefaultsPage,
  getTypeDefaults,
  updateTypeDefaults
};
