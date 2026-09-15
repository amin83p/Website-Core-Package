const canadaPostAddressCompleteService = require('../services/canadaPostAddressCompleteService');

async function searchAddresses(req, res) {
  try {
    const query = String(req.query?.q || '').trim();
    if (query.length < 3) {
      return res.status(400).json({
        status: 'error',
        message: 'Search query must be at least 3 characters.'
      });
    }

    const limit = Number.parseInt(String(req.query?.limit || ''), 10);
    const country = String(req.query?.country || '').trim().toUpperCase();
    const lastId = String(req.query?.lastId || '').trim();
    const result = await canadaPostAddressCompleteService.findAddresses({
      query,
      lastId,
      maxSuggestions: Number.isFinite(limit) ? limit : undefined,
      country: country || undefined
    });

    return res.json({
      status: 'success',
      ...result
    });
  } catch (error) {
    const status = error.code === 'configuration_error' ? 503 : 400;
    return res.status(status).json({
      status: 'error',
      message: error.message || 'Unable to search addresses.',
      code: error.code || 'search_failed'
    });
  }
}

async function retrieveAddress(req, res) {
  try {
    const id = String(req.query?.id || '').trim();
    if (!id) {
      return res.status(400).json({
        status: 'error',
        message: 'Address id is required.'
      });
    }

    const result = await canadaPostAddressCompleteService.retrieveAddress({ id });
    return res.json({
      status: 'success',
      ...result
    });
  } catch (error) {
    const status = error.code === 'configuration_error' ? 503 : 400;
    return res.status(status).json({
      status: 'error',
      message: error.message || 'Unable to retrieve address details.',
      code: error.code || 'retrieve_failed'
    });
  }
}

module.exports = {
  searchAddresses,
  retrieveAddress
};
