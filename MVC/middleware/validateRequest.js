const { z } = require('zod');

function validateRequest(schema) {
  return (req, res, next) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params
      });
      
      // Replace only request segments that the schema actually validates.
      // A body-only schema must not erase Express route params or query values.
      if (Object.prototype.hasOwnProperty.call(parsed, 'body')) {
        req.body = parsed.body;
      }
      if (Object.prototype.hasOwnProperty.call(parsed, 'query')) {
        req.query = parsed.query;
      }
      if (Object.prototype.hasOwnProperty.call(parsed, 'params')) {
        req.params = parsed.params;
      }
      
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
        
        const isAjaxRequest = Boolean(req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json'));
        if (isAjaxRequest) {
          return res.status(400).json({
            status: 'error',
            message: `Validation failed: ${errorMessages}`,
            errors: error.errors
          });
        }
        
        // For non-AJAX requests, render an error page or redirect
        return res.status(400).render('error', {
          title: 'Validation Error',
          message: `Validation failed: ${errorMessages}`,
          user: req.user || null
        });
      }
      next(error);
    }
  };
}

module.exports = validateRequest;
