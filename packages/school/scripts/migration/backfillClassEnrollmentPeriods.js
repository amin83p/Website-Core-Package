#!/usr/bin/env node

const path = require('path');

const rootScript = path.resolve(__dirname, '../../../../scripts/school/migration/backfillClassEnrollmentPeriods.js');
require(rootScript);
