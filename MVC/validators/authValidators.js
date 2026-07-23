const { z } = require('zod');

const loginSchema = z.object({
  body: z.object({
    username: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
    captcha: z.string().optional()
  })
});

const forceLoginSchema = z.object({
  body: z.object({
    username: z.string().optional(),
    password: z.string().optional(),
    sessionIdToKill: z.string().min(1, 'Target session ID is missing.'),
    authProvider: z.string().optional()
  })
});

const switchOrgSchema = z.object({
  body: z.object({
    orgId: z.union([z.string(), z.number()]).transform(val => String(val))
  })
});

const switchModeSchema = z.object({
  body: z.object({
    mode: z.string().min(1, 'Mode is required.')
  })
});

const requestPasswordResetSchema = z.object({
  body: z.object({
    email: z.string().email('Valid email is required.').optional().or(z.literal('')),
    deliveryMethod: z.enum(['email', 'sms']).optional()
  })
});

const startPasswordResetSmsSchema = z.object({
  body: z.object({
    email: z.string().email('Valid email is required.'),
    selectionMode: z.string().optional(),
    selectedToken: z.string().optional(),
    manualPhone: z.string().optional(),
    last4: z.string().length(4, 'Last 4 digits are required.')
  })
});

const verifyPasswordResetSchema = z.object({
  body: z.object({
    email: z.string().email('Valid email is required.'),
    code: z.string().min(1, 'Code is required.'),
    deliveryMethod: z.string().optional()
  })
});

const completePasswordResetSchema = z.object({
  body: z.object({
    email: z.string().email('Valid email is required.'),
    verificationToken: z.string().min(1, 'Verification token is required.'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters.')
  })
});

module.exports = {
  loginSchema,
  forceLoginSchema,
  switchOrgSchema,
  switchModeSchema,
  requestPasswordResetSchema,
  startPasswordResetSmsSchema,
  verifyPasswordResetSchema,
  completePasswordResetSchema
};
