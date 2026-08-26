const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const accessConstants = require('../config/accessConstants');
const libraryCopyModel = require('../MVC/models/school/libraryCopyModel');
const libraryPatronModel = require('../MVC/models/school/libraryPatronModel');
const libraryPolicyModel = require('../MVC/models/school/libraryPolicyModel');
const libraryLoanModel = require('../MVC/models/school/libraryLoanModel');
const libraryCirculationService = require('../MVC/services/school/libraryCirculationService');
const libraryLocationModel = require('../MVC/models/school/libraryLocationModel');
const libraryLocationService = require('../MVC/services/school/libraryLocationService');
const bookAssignmentModel = require('../MVC/models/school/bookAssignmentModel');

test('access constants declare library sections', () => {
  assert.equal(accessConstants.SCHOOL_SECTIONS.SCHOOL_LIBRARY, 'SCHOOL_LIBRARY');
  assert.equal(accessConstants.SECTIONS.SCHOOL_LIBRARY_COPIES, 'SCHOOL_LIBRARY_COPIES');
  assert.equal(accessConstants.SECTIONS.SCHOOL_LIBRARY_CIRCULATION, 'SCHOOL_LIBRARY_CIRCULATION');
  assert.equal(accessConstants.SECTIONS.SCHOOL_LIBRARY_LOCATIONS, 'SCHOOL_LIBRARY_LOCATIONS');
  assert.equal(accessConstants.SECTIONS.SCHOOL_LIBRARY_BOOK_ASSIGNMENTS, 'SCHOOL_LIBRARY_BOOK_ASSIGNMENTS');
  assert.equal(accessConstants.SECTIONS.SCHOOL_LIBRARY_BOOK_COVERING, 'SCHOOL_LIBRARY_BOOK_COVERING');
});

test('library copy model validates copy code uniqueness semantics', () => {
  assert.equal(libraryCopyModel.normalizeCopyType('DIGITAL'), 'digital');
  assert.equal(libraryCopyModel.normalizeCopyStatus('AVAILABLE'), 'available');
});

test('library patron model normalizes roles and statuses', () => {
  assert.equal(libraryPatronModel.normalizePatronRole('Teacher'), 'teacher');
  assert.equal(libraryPatronModel.normalizePatronStatus('BLOCKED'), 'blocked');
});

test('library patron model stores dated policy override history', () => {
  const patron = libraryPatronModel.normalizeStoredPatron({
    id: 'LP-1',
    orgId: 'ORG1',
    personId: 'PERSON1',
    patronRole: 'student',
    policyOverrideRecords: [{
      validFrom: '2026-08-01',
      validTo: '2099-08-31',
      policyOverrides: {
        maxConcurrentLoans: '6',
        loanPeriodDays: '21',
        digitalAccessDays: '45',
        allowDigitalDownload: 'false',
        maxRenewals: '3'
      }
    }]
  });
  assert.equal(patron.maxConcurrentLoans, 6);
  assert.equal(patron.policyOverrideRecords.length, 1);
  assert.deepEqual(patron.policyOverrides, {
    maxConcurrentLoans: 6,
    loanPeriodDays: 21,
    digitalAccessDays: 45,
    allowDigitalDownload: false,
    maxRenewals: 3
  });
  assert.equal(patron.policyOverrideStartsAt, '2026-08-01');
  assert.equal(patron.policyOverrideExpiresAt, '2099-08-31');
});

test('library patron model rejects overlapping override records', () => {
  assert.throws(() => {
    libraryPatronModel.sanitizeInput({
      orgId: 'ORG1',
      personId: 'PERSON1',
      patronRole: 'student',
      status: 'active',
      libraryCardNumber: 'LIB-STU-PERSON1',
      policyOverrideRecords: [
        {
          validFrom: '2026-08-01',
          validTo: '2026-08-15',
          policyOverrides: { maxConcurrentLoans: '5' }
        },
        {
          validFrom: '2026-08-15',
          validTo: '2026-08-31',
          policyOverrides: { loanPeriodDays: '21' }
        }
      ]
    });
  }, /cannot overlap/);
});

test('library patron model stores optional account validity dates', () => {
  const noLimit = libraryPatronModel.sanitizeInput({
    orgId: 'ORG1',
    personId: 'PERSON1',
    patronRole: 'student',
    status: 'active',
    libraryCardNumber: 'LIB-STU-PERSON1',
    validFrom: '',
    validTo: ''
  });
  assert.equal(noLimit.validFrom, '');
  assert.equal(noLimit.validTo, '');
  assert.equal(libraryPatronModel.isPatronAccountValid(noLimit, new Date('2026-08-10T12:00:00')), true);

  const limited = libraryPatronModel.sanitizeInput({
    orgId: 'ORG1',
    personId: 'PERSON1',
    patronRole: 'student',
    status: 'active',
    libraryCardNumber: 'LIB-STU-PERSON2',
    validFrom: '2026-08-01',
    validTo: '2026-08-31'
  });
  assert.equal(libraryPatronModel.isPatronAccountValid(limited, new Date('2026-08-10T12:00:00')), true);
  assert.equal(libraryPatronModel.isPatronAccountValid(limited, new Date('2026-09-01T12:00:00')), false);
});

test('library patron model rejects invalid account validity range', () => {
  assert.throws(() => {
    libraryPatronModel.sanitizeInput({
      orgId: 'ORG1',
      personId: 'PERSON1',
      patronRole: 'student',
      status: 'active',
      libraryCardNumber: 'LIB-STU-PERSON1',
      validFrom: '2026-09-01',
      validTo: '2026-08-31'
    });
  }, /valid-to date/);
});

test('library patron model rejects empty required write fields', () => {
  assert.throws(() => {
    libraryPatronModel.sanitizeInput({
      orgId: 'ORG1',
      personId: '',
      patronRole: 'student',
      status: 'active',
      libraryCardNumber: 'LIB-STU-PERSON1'
    });
  }, /Person is required/);
  assert.throws(() => {
    libraryPatronModel.sanitizeInput({
      orgId: 'ORG1',
      personId: 'PERSON1',
      patronRole: '',
      status: 'active',
      libraryCardNumber: 'LIB-STU-PERSON1'
    });
  }, /Patron role is required/);
  assert.throws(() => {
    libraryPatronModel.sanitizeInput({
      orgId: 'ORG1',
      personId: 'PERSON1',
      patronRole: 'student',
      status: '',
      libraryCardNumber: 'LIB-STU-PERSON1'
    });
  }, /Patron status is required/);
  assert.throws(() => {
    libraryPatronModel.sanitizeInput({
      orgId: 'ORG1',
      personId: 'PERSON1',
      patronRole: 'student',
      status: 'active',
      libraryCardNumber: ''
    });
  }, /Library card number is required/);
});

test('library policy model exposes defaults per role', () => {
  const student = libraryPolicyModel.DEFAULT_POLICIES.student;
  assert.ok(student.maxConcurrentLoans > 0);
  assert.ok(student.loanPeriodDays > 0);
});

test('library loan model tracks open statuses', () => {
  assert.equal(libraryLoanModel.OPEN_STATUSES.has('active'), true);
  assert.equal(libraryLoanModel.OPEN_STATUSES.has('overdue'), true);
});

test('library routes are mounted under /library', () => {
  const mainRoute = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/schoolMainRoute.js'), 'utf8');
  const libraryMain = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/libraryMainRoute.js'), 'utf8');
  const patronRoutes = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/libraryPatronRoutes.js'), 'utf8');
  assert.match(mainRoute, /\/library/);
  assert.match(libraryMain, /\/books/);
  assert.match(libraryMain, /\/copies/);
  assert.match(libraryMain, /\/circulation/);
  assert.match(libraryMain, /\/locations/);
  assert.match(patronRoutes, /router\.get\('\/delete\/:id'/);
  assert.match(patronRoutes, /router\.delete\('\/delete\/:id'/);
  assert.match(patronRoutes, /allowOperationTokenFallback:\s*true/);
});

test('book mutations tolerate staged uploads and retryable action-state attempts', () => {
  const route = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/bookRoutes.js'), 'utf8');
  assert.match(route, /const bookMutationActionState = \{/);
  assert.match(route, /allowOperationTokenFallback:\s*true/);
  assert.match(route, /allowInactiveTokenFallback:\s*true/);
  assert.match(route, /const bookStagedUploadActionState = \{/);
  assert.match(route, /keepActive:\s*true/);
  assert.match(route, /trackActionState\(SECTIONS\.SCHOOL_BOOKS,\s*OPERATIONS\.CREATE,\s*bookStagedUploadActionState\)/);
  assert.match(route, /trackActionState\(SECTIONS\.SCHOOL_BOOKS,\s*OPERATIONS\.CREATE,\s*bookMutationActionState\)/);
  assert.match(route, /trackActionState\(SECTIONS\.SCHOOL_BOOKS,\s*OPERATIONS\.UPDATE,\s*bookMutationActionState\)/);
});

test('library copy duplicate tolerates list-page action-state tokens', () => {
  const route = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/libraryCopyRoutes.js'), 'utf8');
  const controller = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/libraryCopyController.js'), 'utf8');
  assert.match(route, /const copyMutationActionState = \{/);
  assert.match(route, /allowOperationTokenFallback:\s*true/);
  assert.match(route, /allowInactiveTokenFallback:\s*true/);
  assert.match(route, /trackActionState\(SECTIONS\.SCHOOL_LIBRARY_COPIES,\s*OPERATIONS\.CREATE,\s*copyMutationActionState\)/);
  assert.match(route, /router\.post\('\/duplicate\/:id'/);
  assert.match(controller, /school_library_copy_duplicate/);
  assert.match(controller, /Copy duplication is already in progress/);
  assert.match(controller, /idempotencyGuardService\.completeGuard\(guardKey,\s*response\)/);
});

test('circulation desk uses standard page chrome and patron picker checkout', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/circulationDesk.ejs'), 'utf8');
  const controller = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/libraryCirculationController.js'), 'utf8');
  const route = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/libraryCirculationRoutes.js'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/services/school/libraryCirculationService.js'), 'utf8');
  assert.match(view, /partials\/tablePages-start/);
  assert.match(view, /School Dashboard/);
  assert.match(view, /School Library/);
  assert.match(view, /Active Loans/);
  assert.match(view, /Overdue/);
  assert.match(view, /modal_GenericPicker/);
  assert.match(view, /id="deskPickPatron"/);
  assert.match(view, /sourceMode:\s*'local'/);
  assert.match(view, /localItems:\s*patronPickerItems/);
  assert.match(view, /checkout_patronId/);
  assert.match(view, /patronLoansBody/);
  assert.match(view, /Active Policy/);
  assert.match(view, /policyAllowanceList/);
  assert.match(view, /copySearchTerm/);
  assert.match(view, /api\/copies\/search/);
  assert.match(view, /checkoutBasketBody/);
  assert.match(view, /state\.searchResults/);
  assert.match(view, /renderBookCover/);
  assert.match(view, /coverPhotoUrl/);
  assert.match(view, /buttonText = inBasket \? 'Added' : 'Add'/);
  assert.match(view, /renderSearchResults\(state\.searchResults\)/);
  assert.match(view, /copyIds:\s*state\.basket\.map/);
  assert.match(view, /confirmCheckoutDetails/);
  assert.match(view, /renderCheckoutReviewModal/);
  assert.match(view, /data-checkout-due-at/);
  assert.match(view, /data-checkout-digital-expires-at/);
  assert.match(view, /data-checkout-item-notes/);
  assert.match(view, /checkoutItems/);
  assert.match(view, /runWithWaiting/);
  assert.match(view, /showLoading/);
  assert.match(view, /setButtonBusy/);
  assert.match(view, /btnReturnSelected/);
  assert.match(view, /loanSelectAll/);
  assert.match(view, /loan-return-check/);
  assert.match(view, /renderReturnPreview/);
  assert.match(view, /api\/loans\/' \+ encodeURIComponent\(firstId\) \+ '\/preview/);
  assert.match(view, /loanIds/);
  assert.match(view, /Pick a library patron before checkout/);
  assert.match(view, /Pick a library patron before searching for copies/);
  assert.match(view, /patronId,/);
  assert.match(view, /showMessageModal/);
  assert.match(view, /applyGuardedApiResult/);
  assert.doesNotMatch(view, /checkoutCopyId/);
  assert.doesNotMatch(view, /deskPickStudent/);
  assert.doesNotMatch(view, /checkout_personId/);
  assert.doesNotMatch(view, /alert\(/);
  assert.match(controller, /buildPatronPickerItems/);
  assert.match(controller, /apiPatronDeskSummary/);
  assert.match(controller, /apiSearchAvailableCopies/);
  assert.match(controller, /summarizePolicyForDesk/);
  assert.match(controller, /coverPhotoUrl/);
  assert.match(controller, /coverPhoto:\s*book\?\.coverPhoto/);
  assert.match(controller, /exports\.apiPreviewLoans/);
  assert.match(controller, /checkoutItems/);
  assert.match(controller, /requestedCopyIds/);
  assert.match(controller, /requestedLoanIds/);
  assert.match(controller, /patronPickerItems/);
  assert.match(controller, /buildPersonByIdMap/);
  assert.match(serviceSource, /requestedDueAt/);
  assert.match(serviceSource, /requestedDigitalAccessExpiresAt/);
  assert.match(route, /api\/patrons\/:patronId\/summary/);
  assert.match(route, /api\/copies\/search/);
  assert.match(route, /api\/loans\/:loanId\/preview/);
  assert.match(route, /const circulationMutationActionState = \{/);
  assert.match(route, /allowOperationTokenFallback:\s*true/);
  assert.match(route, /allowInactiveTokenFallback:\s*true/);
});

test('library location saves use ajax modal flow and retryable action-state tokens', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/locationForm.ejs'), 'utf8');
  const route = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/libraryLocationRoutes.js'), 'utf8');
  const controller = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/libraryLocationController.js'), 'utf8');
  assert.match(view, /id="libraryLocationForm"/);
  assert.match(view, /fetch\(form\.action/);
  assert.match(view, /X-AJAX-Request/);
  assert.match(view, /showMessageModal/);
  assert.match(view, /Location Saved/);
  assert.match(view, /Unable to Save Location/);
  assert.match(view, /applyGuardedApiResult/);
  assert.doesNotMatch(view, /alert\(/);
  assert.match(route, /const locationMutationActionState = \{/);
  assert.match(route, /allowOperationTokenFallback:\s*true/);
  assert.match(route, /allowInactiveTokenFallback:\s*true/);
  assert.match(controller, /formatLocationSaveError/);
  assert.match(controller, /Location code is already used for this organization/);
  assert.match(controller, /includeModal:\s*true/);
  assert.doesNotMatch(view, /render\('error'/);
});

test('library locations page uses standard list page header actions', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/locationTree.ejs'), 'utf8');
  assert.match(view, /partials\/tablePages-start/);
  assert.match(view, /newHref:\s*canCreate \? '\/school\/library\/locations\/new'/);
  assert.match(view, /newLabel:\s*canCreate \? 'Add Building'/);
  assert.match(view, /schoolSectionDashboardHref/);
  assert.match(view, /School Dashboard/);
  assert.match(view, /School Library/);
  assert.match(view, /partials\/tablePages-end/);
  assert.doesNotMatch(view, /justify-content-between mb-4/);
  assert.doesNotMatch(view, /Library Hub/);
});

test('library location repository unsets blank optional codes for mongo sparse index', () => {
  const repository = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/repositories/school/index.js'), 'utf8');
  const model = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/models/school/libraryLocationModel.js'), 'utf8');
  const mongoIndexManager = fs.readFileSync(path.join(ROOT, 'MVC/infrastructure/mongo/mongoIndexManager.js'), 'utf8');
  assert.match(repository, /function normalizeLibraryLocationPayload/);
  assert.match(repository, /output\.__unsetFields/);
  assert.match(repository, /splitRepositoryUnsetPayload/);
  assert.match(repository, /updateOperation\.\$unset/);
  assert.match(repository, /normalizePayload:\s*normalizeLibraryLocationPayload/);
  assert.match(model, /payload\?\.__unsetFields/);
  assert.match(model, /mergedInput\.code = ''/);
  assert.match(mongoIndexManager, /idx_school_library_locations_org_code/);
  assert.match(mongoIndexManager, /partialFilterExpression:\s*\{\s*code:\s*\{\s*\$exists:\s*true,\s*\$type:\s*'string',\s*\$gt:\s*''\s*\}/);
  assert.doesNotMatch(mongoIndexManager, /idx_school_library_locations_org_code',\s*unique:\s*true,\s*sparse:\s*true/);
  assert.match(mongoIndexManager, /repairKnownIndexOptionDrift/);
});

test('library circulation service validates digital access window', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const loan = {
    status: 'active',
    copyType: 'digital',
    dueAt: future,
    digitalAccessExpiresAt: future
  };
  assert.equal(libraryCirculationService.isDigitalAccessValid(loan), true);
  assert.equal(libraryCirculationService.isDigitalAccessValid({ ...loan, status: 'returned' }), false);
});

test('library circulation service blocks patrons outside account validity', () => {
  assert.throws(() => {
    libraryCirculationService.assertPatronEligible({
      status: 'active',
      validFrom: '',
      validTo: '2000-01-01'
    });
  }, /outside its validity dates/);
});

test('library circulation service applies patron policy overrides until expiry', () => {
  const policy = {
    maxConcurrentLoans: 3,
    loanPeriodDays: 14,
    digitalAccessDays: 30,
    allowDigitalDownload: true,
    maxRenewals: 1
  };
  const patron = {
    policyOverrideRecords: [{
      validFrom: '2026-08-01',
      validTo: '2026-08-10',
      policyOverrides: {
        maxConcurrentLoans: 8,
        loanPeriodDays: 28,
        digitalAccessDays: 60,
        allowDigitalDownload: false,
        maxRenewals: 4
      }
    }]
  };
  const active = libraryCirculationService.applyPatronPolicyOverrides(policy, patron, {
    now: new Date('2026-08-10T16:00:00Z')
  });
  assert.equal(active.overrideActive, true);
  assert.equal(active.maxConcurrentLoans, 8);
  assert.equal(active.allowDigitalDownload, false);

  const expired = libraryCirculationService.applyPatronPolicyOverrides(policy, {
    policyOverrideRecords: [{
      ...patron.policyOverrideRecords[0],
      validTo: '2026-08-09'
    }]
  }, {
    now: new Date('2026-08-10T16:00:00Z')
  });
  assert.equal(expired.overrideActive, false);
  assert.equal(expired.maxConcurrentLoans, 3);
  assert.equal(expired.allowDigitalDownload, true);
});

test('library seed script declares hub and child sections', () => {
  const seedPath = path.join(ROOT, 'scripts/seed-school-library-section.js');
  const source = fs.readFileSync(seedPath, 'utf8');
  assert.match(source, /446110/);
  assert.match(source, /SCHOOL_LIBRARY/);
  assert.match(source, /446111/);
  assert.match(source, /446113/);
  assert.match(source, /446115/);
  assert.match(source, /SCHOOL_LIBRARY_LOCATIONS/);
  assert.match(source, /\/school\/library\/books/);
});

test('copy list view includes make a copy action', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/copyList.ejs'), 'utf8');
  assert.match(view, /Make a Copy/);
  assert.match(view, /data-duplicate-copy-form="true"/);
  assert.match(view, /duplicateNotice/);
  assert.match(view, /showDuplicateResult/);
  assert.match(view, /showMessageModal/);
  assert.match(view, /Open Copied Item/);
  assert.match(view, /Stay on List/);
  assert.match(view, /applyGuardedApiResult/);
  assert.match(view, /\/school\/library\/copies\/edit\//);
  assert.doesNotMatch(view, /Open new copy/);
  assert.match(view, /btn-row-actions-toggle/);
});

test('copy form uses generic picker for catalog book', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/copyForm.ejs'), 'utf8');
  assert.match(view, /modal_GenericPicker/);
  assert.match(view, /GenericPickerPresets\.book/);
  assert.match(view, /activeOrganizationScope/);
  assert.match(view, /max-width: 1400px/);
});

test('copy form uses assignable spot location picker for physical copies', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/copyForm.ejs'), 'utf8');
  assert.match(view, /hid_locationId/);
  assert.match(view, /btnPickLocation/);
  assert.match(view, /locationSpotModal/);
  assert.match(view, /assignable-spots/);
  assert.match(view, /toggleLocationField/);
  assert.doesNotMatch(view, /name="location"/);
});

test('copy edit form renders a scannable barcode preview for copy code', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/copyForm.ejs'), 'utf8');
  assert.match(view, /copy-barcode-row/);
  assert.match(view, /copyBarcodePanel/);
  assert.match(view, /copyBarcodeSvg/);
  assert.match(view, /CODE128_PATTERNS/);
  assert.match(view, /buildCode128BitString/);
  assert.match(view, /renderCopyBarcode\(\)/);
});

test('patron form suggests cards, shows barcode, and exposes policy overrides', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/patronForm.ejs'), 'utf8');
  assert.match(view, /max-width: 1400px/);
  assert.match(view, /suggestLibraryCardNumber/);
  assert.match(view, /libraryCardBarcodeSvg/);
  assert.match(view, /buildCode128BitString/);
  assert.match(view, /policyCatalogJson/);
  assert.match(view, /Applied policy/);
  assert.match(view, /pickedPersonCard/);
  assert.match(view, /buildPersonSummary/);
  assert.match(view, /id="hid_patronRole"/);
  assert.match(view, /id="patronRole" class="form-select size-md" disabled/);
  assert.match(view, /name="validFrom"/);
  assert.match(view, /name="validTo"/);
  assert.match(view, /Policy override history/);
  assert.match(view, /policyOverrideRecords\[/);
  assert.match(view, /validFrom/);
  assert.match(view, /validTo/);
  assert.match(view, /policyOverrides\]\[maxConcurrentLoans\]/);
  assert.match(view, /policyOverrides\]\[loanPeriodDays\]/);
  assert.match(view, /policyOverrides\]\[digitalAccessDays\]/);
  assert.match(view, /policyOverrides\]\[allowDigitalDownload\]/);
  assert.match(view, /policyOverrides\]\[maxRenewals\]/);
  assert.match(view, /validateSelectedPerson/);
  assert.match(view, /showMessageModal/);
  assert.match(view, /School Person Required/);
  assert.match(view, /validateOverrideDates/);
});

test('patron controller enables message modal for create and edit forms', () => {
  const controller = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/libraryPatronController.js'), 'utf8');
  assert.match(controller, /includeModal:\s*true,\s*includeGenericPicker:\s*true/);
  assert.match(controller, /includeModal:\s*true,\s*includeGenericPicker:\s*false/);
});

test('patron controller validates required patron fields before save', () => {
  const controller = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/libraryPatronController.js'), 'utf8');
  assert.match(controller, /if \(!effectivePersonId\)/);
  assert.match(controller, /Select a student, teacher, or staff member before registering a patron/);
  assert.match(controller, /This patron is missing a selected school person and cannot be saved/);
  assert.match(controller, /Patron role is required/);
  assert.match(controller, /Patron status is required/);
  assert.match(controller, /Library card number is required/);
});

test('patron list resolves the patron column from linked person names', () => {
  const controller = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/libraryPatronController.js'), 'utf8');
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/patronList.ejs'), 'utf8');
  assert.match(controller, /buildPersonByIdMap/);
  assert.match(controller, /formatPersonName\(person,\s*''\)/);
  assert.match(controller, /if \(personName\) return personName/);
  assert.match(controller, /roleRecordName/);
  assert.match(view, /<%= item\.displayName %>/);
});

test('patron controller only deletes patrons without circulation history', () => {
  const controller = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/libraryPatronController.js'), 'utf8');
  assert.match(controller, /exports\.deletePatron/);
  assert.match(controller, /fetchAllData\('libraryLoans'/);
  assert.match(controller, /loan\.patronId/);
  assert.match(controller, /library circulation history exists/);
  assert.match(controller, /deleteData\('libraryPatrons'/);
});

test('library circulation auto-created patrons include a card number', () => {
  const service = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/services/school/libraryCirculationService.js'), 'utf8');
  assert.match(service, /buildLibraryCardNumber/);
  assert.match(service, /libraryCardNumber:\s*buildLibraryCardNumber/);
});

test('patron list uses standard second-row register button and row action menu', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/patronList.ejs'), 'utf8');
  assert.match(view, /newHref:\s*'\/school\/library\/patrons\/new'/);
  assert.match(view, /newLabel:\s*'Register Patron'/);
  assert.doesNotMatch(view, /headerManageBtns:[\s\S]*Register Patron/);
  assert.match(view, /table-actions text-end pe-4/);
  assert.match(view, /row-actions-wrap/);
  assert.match(view, /btn-row-actions-toggle/);
  assert.match(view, /bi-three-dots-vertical/);
  assert.match(view, /row-actions-menu d-none/);
  assert.match(view, /title="Patron actions"/);
  assert.match(view, /delete-patron-btn/);
  assert.match(view, /Delete Patron\?/);
  assert.match(view, /showMessageModal/);
  assert.match(view, /\/school\/library\/patrons\/delete\//);
  assert.match(view, /data-patron-row-id/);
  assert.match(view, /removePatronRow/);
  assert.match(view, /ensureEmptyPatronState/);
  assert.doesNotMatch(view, /window\.location\.reload/);
});

test('list page guide documents guarded delete and no-refresh row removal', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'packages/school/docs/list-page-development-guide.md'), 'utf8');
  assert.match(guide, /Guarded delete with no page refresh/);
  assert.match(guide, /showMessageModal/);
  assert.match(guide, /remove the row from `#first-table` without refreshing/);
  assert.match(guide, /Do not call `window\.location\.reload\(\)`/);
  assert.match(guide, /newHref/);
  assert.match(guide, /Library Patrons is the reference for guarded delete/);
});

test('copy list shows resolved location path', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/copyList.ejs'), 'utf8');
  assert.match(view, /locationPath/);
});

test('library location model enforces hierarchy child types', () => {
  assert.equal(libraryLocationModel.getChildTypeForParent('building'), 'floor');
  assert.equal(libraryLocationModel.getChildTypeForParent('shelf'), 'spot');
  assert.equal(libraryLocationModel.getChildTypeForParent('spot'), null);
  assert.equal(libraryLocationModel.normalizeLocationType('SPOT'), 'spot');
});

test('library location service builds paths and assignable spots', () => {
  const rows = [
    { id: 'b1', orgId: 'ORG1', parentId: null, locationType: 'building', name: 'Main', sortOrder: 1, active: true },
    { id: 'f1', orgId: 'ORG1', parentId: 'b1', locationType: 'floor', name: 'Floor 2', sortOrder: 1, active: true },
    { id: 's1', orgId: 'ORG1', parentId: 'f1', locationType: 'spot', name: 'Spot 3', sortOrder: 1, active: true },
    { id: 's2', orgId: 'ORG1', parentId: 'f1', locationType: 'spot', name: 'Spot inactive', sortOrder: 2, active: false }
  ];
  const path = libraryLocationService.buildLocationPath('s1', rows);
  assert.equal(path, 'Main / Floor 2 / Spot 3');
  const spots = libraryLocationService.listAssignableSpots(rows);
  assert.equal(spots.length, 1);
  assert.equal(spots[0].id, 's1');
  assert.match(spots[0].path, /Spot 3/);
  const tree = libraryLocationService.buildLocationTree(rows);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children.length, 1);
});

test('my library view exposes digital open action', () => {
  const view = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/myLibrary.ejs'), 'utf8');
  assert.match(view, /btn-open-digital/);
  assert.match(view, /api\/digital/);
});

test('book assignment routes and controller are registered', () => {
  const mainRoute = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/libraryMainRoute.js'), 'utf8');
  const controller = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/bookAssignmentController.js'), 'utf8');
  assert.match(mainRoute, /book-assignments/);
  assert.match(controller, /listAssignments/);
  assert.match(controller, /upsertForClass/);
});

test('book assignment model rejects duplicate class assignments', async () => {
  const dataPath = path.join(ROOT, 'data/school/bookAssignments.json');
  const backup = fs.readFileSync(dataPath, 'utf8');
  try {
    fs.writeFileSync(dataPath, JSON.stringify([
      {
        id: 'BKASG-TEST-1',
        orgId: 'ORG-TEST',
        classId: 'CLS-TEST',
        status: 'active',
        notes: '',
        books: [{ bookId: 'BK-TEST', sortOrder: 100, notes: '', status: 'active' }],
        audit: { createUser: 'TEST', createDateTime: '2026-01-01', lastUpdateUser: 'TEST', lastUpdateDateTime: '2026-01-01' }
      }
    ], null, 2));
    await assert.rejects(
      () => bookAssignmentModel.addBookAssignment({
        orgId: 'ORG-TEST',
        classId: 'CLS-TEST',
        status: 'active',
        books: [{ bookId: 'BK-OTHER', sortOrder: 10, notes: '', status: 'active' }]
      }),
      /already exists/
    );
  } finally {
    fs.writeFileSync(dataPath, backup);
  }
});

test('book assignment model rejects duplicate books in books array', () => {
  assert.throws(() => {
    bookAssignmentModel.sanitizeBookLines([
      { bookId: 'BK-TEST', sortOrder: 10 },
      { bookId: 'BK-TEST', sortOrder: 20 }
    ]);
  }, /Duplicate book/);
});

test('book assignment list and form views use class-centric books table', () => {
  const listView = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/bookAssignmentList.ejs'), 'utf8');
  const formView = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/library/bookAssignmentForm.ejs'), 'utf8');
  assert.match(listView, /bookCount/);
  assert.match(listView, /bookTitleSummary/);
  assert.match(formView, /initialBooksPayload/);
  assert.match(formView, /<%- initialBooksPayload %>/);
  assert.match(formView, /max-width: 1400px/);
  assert.match(formView, /coverPhotoUrl/);
  assert.match(formView, /assignment-book-cover/);
  assert.match(formView, /activeOrganizationScope/);
  assert.match(formView, /btnAddBooks/);
  assert.match(formView, /booksTable/);
});
