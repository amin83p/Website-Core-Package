#!/usr/bin/env node

const path = require('path');

const rootScript = path.resolve(__dirname, '../../../../scripts/mongo-railway/insert-school-gradebook.mongosh.js');
require(rootScript);
