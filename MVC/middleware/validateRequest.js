const { z } = require('zod');

function validateRequest(schema) {
  return (req, res, next) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params
      });
      
      // Replace request data with validated data (strips unknown fields if schema is strict/strip)
      req.body = parsed.body;
      req.query = parsed.query;
      req.params = parsed.params;
      
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
