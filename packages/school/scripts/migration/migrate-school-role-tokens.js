#!/usr/bin/env node

const path = require('path');

const rootScript = path.resolve(__dirname, '../../../../scripts/migrate-school-role-tokens.js');
require(rootScript);
