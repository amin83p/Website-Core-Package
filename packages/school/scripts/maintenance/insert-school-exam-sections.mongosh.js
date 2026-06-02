#!/usr/bin/env node

const path = require('path');

const rootScript = path.resolve(__dirname, '../../../../scripts/insert-school-exam-sections.mongosh.js');
require(rootScript);
