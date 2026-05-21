// MVC/controllers/ielts/promptController.js
const ieltsService = require('../../services/ielts/ieltsDataService');
const paginate = require('../../utils/paginationHelper');
const {
    assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
    canCreateOrgScopedItem
} = require('../../utils/orgContextUtils');

function parseListInput(value) {
    if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
    return String(value || '').split(/[\n,]+/).map((v) => v.trim()).filter(Boolean);
}

function buildPromptPayload(body = {}) {
    return {
        id: String(body.id || '').trim(),
        name: String(body.name || '').trim(),
        description: String(body.description || '').trim(),
        category: String(body.category || 'NO_CATEGORY').trim() || 'NO_CATEGORY',
        variables: parseListInput(body.variables),
        isActive: body.isActive === true || body.isActive === 'true' || body.isActive === 'on',
        content: String(body.content || '').trim(),
        config: {
            modelHint: String(body.modelHint || '').trim(),
            temperature: body.temperature,
            topP: body.topP,
            topK: body.topK
        }
    };
}

exports.showPromptSettings = async (req, res) => {
    try {
        const prompts = await ieltsService.fetchData('prompts', req.query, req.user);
        const canCreatePrompts = await canCreateOrgScopedItem(req.user, { scopeLabel: 'prompt templates' });
        const { data, pagination } = paginate(prompts, req.query.page, req.query.limit);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', data, pagination });
        }

        res.render('ielts/promptList', {
            title: 'Prompt Tuning',
            data,
            newUrl: 'ielts/prompts',
            newLabel: canCreatePrompts ? 'Create Prompt' : null,
            tableName: 'Prompt Templates',
            includeModal: true,
            print: true,
            pagination,
            filters: req.query,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        if (req.headers['x-ajax-request']) {
            return res.status(500).json({ status: 'error', error, message: error.message });
        }
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

exports.showAddPromptForm = async (req, res) => {
    try {
        await assertCreateOrgContextOrThrowShared(req.user, { scopeLabel: 'prompt templates' });
        const [samples, assessments] = await Promise.all([
            ieltsService.fetchData('task2Samples', {}, req.user),
            ieltsService.fetchData('microAssessments', {}, req.user)
        ]);
        res.render('ielts/promptForm', {
            title: 'Create Prompt',
            prompt: null,
            samples,
            assessments,
            includeModal: true,
            print: true,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

exports.showEditPromptForm = async (req, res) => {
    try {
        const [prompt, samples, assessments] = await Promise.all([
            ieltsService.getDataById('prompts', req.params.id, req.user),
            ieltsService.fetchData('task2Samples', {}, req.user),
            ieltsService.fetchData('microAssessments', {}, req.user)
        ]);
        if (!prompt) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Prompt not found.',
                user: req.user || null
            });
        }

        res.render('ielts/promptForm', {
            title: 'Edit Prompt',
            prompt,
            samples,
            assessments,
            includeModal: true,
            print: true,
            user: req.user || null,
            actionStateId: req?.actionStateId || ''
        });
    } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

exports.addPrompt = async (req, res) => {
    try {
        const payload = buildPromptPayload(req.body);
        await ieltsService.addData('prompts', payload, req.user);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Prompt created successfully.' });
        }

        res.redirect('/ielts/prompts');
    } catch (error) {
        if (req.headers['x-ajax-request']) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

exports.editPrompt = async (req, res) => {
    try {
        const payload = buildPromptPayload(req.body);
        await ieltsService.updateData('prompts', req.params.id, payload, req.user);

        if (req.headers['x-ajax-request']) {
            return res.json({ status: 'success', message: 'Prompt updated successfully.' });
        }

        res.redirect('/ielts/prompts');
    } catch (error) {
        if (req.headers['x-ajax-request']) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
};

exports.savePrompt = async (req, res) => {
    try {
        const payload = buildPromptPayload(req.body);
        const saved = await ieltsService.addData('prompts', payload, req.user);

        res.json({ status: 'success', message: 'Prompt saved successfully.', data: saved });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ✅ NEW: Delete Action
exports.deletePrompt = async (req, res) => {
    try {
        await ieltsService.deleteData('prompts', req.params.id, req.user);
        //await promptModel.deletePrompt(req.params.id);
        res.json({ status: 'success', message: 'Prompt deleted.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

exports.getPromptTemplate = async (req, res) => {
    try {
        const prompt = await ieltsService.getDataById('prompts',req.params.id, req.user);
        //const prompt = await promptModel.getPromptById(req.params.id);
        res.json({ status: 'success', content: prompt ? prompt.content : '' });
    } catch (error) {
        res.json({ status: 'error', content: '' });
    }
};
