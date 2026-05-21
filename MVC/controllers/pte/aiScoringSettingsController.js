const pteAiScoringSettingsDataService = require('../../services/pte/pteAiScoringSettingsDataService');

const SCORING_HELP_GUIDANCE = Object.freeze({
  defaults: {
    openAiVisionModelEnv: 'PTE_OPENAI_DESCRIBE_IMAGE_VISION_MODEL_ID',
    openAiVisionModelDefault: 'gpt-5.4-mini'
  },
  useCases: [
    {
      title: 'AI Assist',
      guidance: 'Use a fast multimodal model for generating question-bank payloads and scoring defaults. Gemini Flash or an OpenAI GPT mini model is usually enough unless the task includes difficult image/audio reasoning.',
      gemini: 'gemini-2.5-flash for most drafting; gemini-2.5-pro or gemini-3-pro for difficult Describe Image or long listening prompts.',
      openai: 'gpt-5.4-mini for most text/image assistance; use an audio-capable model only when the assist request must inspect audio directly.'
    },
    {
      title: 'Writing and Summarize Spoken/Written Text Scoring',
      guidance: 'These scorers use text and structured micro-assessments, so they do not need an audio model.',
      gemini: 'gemini-2.5-flash for normal scoring; Gemini Pro if you see weak rubric reasoning on long responses.',
      openai: 'gpt-5.4-mini for routine scoring; a stronger GPT model can be assigned when consistency matters more than cost.'
    },
    {
      title: 'Read Aloud, Repeat Sentence, Answer Short Question',
      guidance: 'These are audio-input scorers. The provider must be able to receive the candidate recording and return transcript plus micro-rubric JSON.',
      gemini: 'gemini-2.5-flash is the default practical choice; Gemini Pro is optional for more conservative transcript/rubric review.',
      openai: 'Use gpt-audio, gpt-audio-mini, gpt-4o-audio-preview, or gpt-4o-mini-audio-preview. Plain text/image models are rejected for these scorers.'
    },
    {
      title: 'Describe Image',
      guidance: 'The scorer needs candidate audio plus visual context. If OpenAI audio scoring receives only an image, the app first extracts caption/key points with the vision model, then scores audio against that text context.',
      gemini: 'Gemini multimodal models can handle audio plus image/context in the main scoring request.',
      openai: 'Use an OpenAI audio model for the scoring assignment. The optional vision pre-pass defaults to gpt-5.4-mini and can be changed with PTE_OPENAI_DESCRIBE_IMAGE_VISION_MODEL_ID.'
    },
    {
      title: 'Respond to a Situation',
      guidance: 'This is the most reasoning-heavy speaking scorer because it evaluates appropriacy plus pronunciation and fluency.',
      gemini: 'Gemini Pro is recommended when available; Flash can still be used for lower-cost practice.',
      openai: 'Use gpt-audio for best quality, or gpt-audio-mini / gpt-4o-mini-audio-preview for lower-cost practice.'
    }
  ],
  notes: [
    'Set one active default provider so AI Assist has a fallback.',
    'Use scoring assignments when a question type needs a different model than the default.',
    'OpenAI audio scoring requires prepared MP3 or WAV; browser recordings are converted to WAV when FFmpeg is available.',
    'Azure OpenAI is registered in the provider list but endpoint/deployment setup is outside this pass.'
  ]
});

async function showScoringSettingsPage(req, res) {
  try {
    const data = await pteAiScoringSettingsDataService.listSettings(
      req.user,
      { scopeId: req.accessScope }
    );
    return res.render('pte/aiAssist/scoringSettings', {
      title: 'PTE AI Scoring Settings',
      data,
      includeModal: true,
      print: false,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function showScoringSettingsHelpPage(req, res) {
  return res.render('pte/aiAssist/scoringSettingsHelp', {
    title: 'PTE AI Scoring Help',
    guidance: SCORING_HELP_GUIDANCE,
    includeModal: false,
    print: false,
    user: req.user || null,
    actionStateId: req?.actionStateId || ''
  });
}

async function getScoringSettingsApi(req, res) {
  try {
    const data = await pteAiScoringSettingsDataService.listSettings(
      req.user,
      { scopeId: req.accessScope },
      { query: req.query || {} }
    );
    return res.json({
      status: 'success',
      data
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to load PTE AI scoring settings.'
    });
  }
}

async function saveScoringSettingApi(req, res) {
  try {
    const saved = await pteAiScoringSettingsDataService.upsertSetting(
      req.body || {},
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({
      status: 'success',
      message: 'PTE AI scoring setting saved.',
      data: saved
    });
  } catch (error) {
    const statusCode = /required|not found|inactive|usable|implemented/i.test(String(error?.message || '')) ? 400 : 500;
    return res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to save PTE AI scoring setting.'
    });
  }
}

async function deleteScoringSettingApi(req, res) {
  try {
    await pteAiScoringSettingsDataService.deleteSetting(
      req.params.id,
      req.user,
      { scopeId: req.accessScope }
    );
    return res.json({
      status: 'success',
      message: 'PTE AI scoring setting deleted.'
    });
  } catch (error) {
    const statusCode = /not found/i.test(String(error?.message || '')) ? 404 : 500;
    return res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to delete PTE AI scoring setting.'
    });
  }
}

module.exports = {
  showScoringSettingsPage,
  showScoringSettingsHelpPage,
  getScoringSettingsApi,
  saveScoringSettingApi,
  deleteScoringSettingApi
};
