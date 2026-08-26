'use strict';

const express = require('express');
const router = express.Router();

router.use('/books', require('./bookRoutes'));
router.use('/copies', require('./libraryCopyRoutes'));
router.use('/patrons', require('./libraryPatronRoutes'));
router.use('/circulation', require('./libraryCirculationRoutes'));
router.use('/policies', require('./libraryPolicyRoutes'));
router.use('/locations', require('./libraryLocationRoutes'));
router.use('/book-assignments', require('./bookAssignmentRoutes'));
router.use('/book-covering', require('./bookCoveringReportRoutes'));
router.use('/my', require('./myLibraryRoutes'));

module.exports = router;
