const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');

const aiAssistRoutes = require('../MVC/routes/pte/aiAssistRoutes');
const aiScoringSettingsController = require('../MVC/controllers/pte/aiScoringSettingsController');

function makeRenderResponse() {
  return {
    rendered: null,
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    }
  };
}

test('PTE AI scoring settings help route is registered behind the settings route prefix', () => {
  const routeLayer = aiAssistRoutes.stack.find((layer) => (
    layer.route?.path === '/scoring-settings/help'
    && layer.route?.methods?.get
  ));

  assert.ok(routeLayer, 'expected GET /scoring-settings/help route to be registered');
  assert.equal(
    routeLayer.route.stack.at(-1)?.handle,
    aiScoringSettingsController.showScoringSettingsHelpPage
  );
});

test('PTE AI scoring settings help page renders model guidance payload', async () => {
  const res = makeRenderResponse();

  await aiScoringSettingsController.showScoringSettingsHelpPage({
    user: { id: 'USER_001' },
    actionStateId: 'STATE_001'
  }, res);

  assert.equal(res.rendered?.view, 'pte/aiAssist/scoringSettingsHelp');
  assert.equal(res.rendered?.payload?.title, 'PTE AI Scoring Help');
  assert.equal(res.rendered?.payload?.actionStateId, 'STATE_001');
  assert.equal(res.rendered?.payload?.guidance?.defaults?.openAiVisionModelEnv, 'PTE_OPENAI_DESCRIBE_IMAGE_VISION_MODEL_ID');
  assert.equal(res.rendered?.payload?.guidance?.defaults?.openAiVisionModelDefault, 'gpt-5.4-mini');
  assert.ok(
    res.rendered?.payload?.guidance?.useCases?.some((row) => (
      row.title === 'Describe Image'
      && /vision pre-pass/i.test(row.openai)
      && /Gemini multimodal/i.test(row.gemini)
    ))
  );
  assert.ok(
    res.rendered?.payload?.guidance?.useCases?.some((row) => (
      row.title === 'Read Aloud, Repeat Sentence, Answer Short Question'
      && /gpt-audio/i.test(row.openai)
      && /rejected/i.test(row.openai)
    ))
  );
});

test('PTE AI scoring settings help EJS compiles with guidance locals', () => {
  const viewPath = path.join(process.cwd(), 'MVC', 'views', 'pte', 'aiAssist', 'scoringSettingsHelp.ejs');
  const template = fs.readFileSync(viewPath, 'utf8');
  const render = ejs.compile(template, { filename: viewPath });
  const html = render({
    title: 'PTE AI Scoring Help',
    pteSectionDashboardHref: '/pte/dashboard',
    guidance: {
      defaults: {
        openAiVisionModelEnv: 'PTE_OPENAI_DESCRIBE_IMAGE_VISION_MODEL_ID',
        openAiVisionModelDefault: 'gpt-5.4-mini'
      },
      useCases: [
        {
          title: 'Describe Image',
          guidance: 'Use audio plus visual context.',
          gemini: 'Gemini multimodal models can handle audio plus image/context.',
          openai: 'Use gpt-audio with a gpt-5.4-mini vision pre-pass.'
        }
      ],
      notes: ['Azure OpenAI is future setup.']
    }
  });

  assert.match(html, /PTE AI Scoring Help/);
  assert.match(html, /Describe Image/);
  assert.match(html, /gpt-5\.4-mini/);
  assert.match(html, /PTE_OPENAI_DESCRIBE_IMAGE_VISION_MODEL_ID/);
});
