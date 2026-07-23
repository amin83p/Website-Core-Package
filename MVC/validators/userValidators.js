const { z } = require('zod');

const userSchema = z.object({
  body: z.object({
    email: z.string().email('Email is invalid.'),
    username: z.string().optional().nullable(),
    passwordHash: z.string().optional(),
    status: z.enum(['pending', 'active', 'suspended', 'deleted']).default('pending'),
    registrationSource: z.enum(['self', 'org_invite', 'admin_create', 'org_admin_create']).default('admin_create'),
    personId: z.string().min(1, 'personId is required.'),
    accessLevel: z.union([z.string(), z.number()]).transform(val => parseInt(val, 10)).refine(val => val >= 1 && val <= 10, 'Access Level must be 1..10.'),
    primaryOrgId: z.union([z.string(), z.number()]).optional().nullable(),
    systemAccessProfileId: z.string().optional().nullable(),
    active: z.union([z.boolean(), z.string(), z.number()]).optional(),
    isEmailVerified: z.union([z.boolean(), z.string(), z.number()]).optional(),
    lastLoginAt: z.string().optional().nullable(),
    organizations: z.any().optional() // Can be JSON string or array, handled by normalizeOrganizations
  })
});

const editUserSchema = z.object({
  body: z.object({
    email: z.string().email('Email is invalid.'),
    username: z.string().optional().nullable(),
    passwordHash: z.string().optional(),
    status: z.enum(['pending', 'active', 'suspended', 'deleted']).default('pending'),
    registrationSource: z.enum(['self', 'org_invite', 'admin_create', 'org_admin_create']).default('admin_create'),
    accessLevel: z.union([z.string(), z.number()]).transform(val => parseInt(val, 10)).refine(val => val >= 1 && val <= 10, 'Access Level must be 1..10.'),
    primaryOrgId: z.union([z.string(), z.number()]).optional().nullable(),
    systemAccessProfileId: z.string().optional().nullable(),
    active: z.union([z.boolean(), z.string(), z.number()]).optional(),
    isEmailVerified: z.union([z.boolean(), z.string(), z.number()]).optional(),
    lastLoginAt: z.string().optional().nullable(),
    organizations: z.any().optional()
  })
});

module.exports = {
  userSchema,
  editUserSchema
};
