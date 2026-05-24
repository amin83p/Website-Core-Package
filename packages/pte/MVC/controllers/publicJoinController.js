const {
  ptePublicJoinService
} = require('./publicJoinControllerDependencies');

async function showPtePublicJoinForm(req, res) {
  const currentUser = req.user || null;
  if (currentUser) {
    const joinState = await ptePublicJoinService.resolvePtePublicJoinState(currentUser);
    return res.render('person/publicJoin', {
      title: 'Join PTE Public Practice',
      person: {},
      user: currentUser,
      includeModal: true,
      showOrganizationsTab: false,
      canEditOrganizations: false,
      availableOrganizations: [],
      fixedOrganizations: [],
      formAction: '/pte/join',
      existingUserJoin: true,
      existingUserAlreadyJoined: joinState.alreadyJoined,
      existingUserName: currentUser.name || currentUser.username || currentUser.email || 'your account',
      existingUserEmail: currentUser.email || currentUser.username || '',
      joinHeadingTitle: joinState.alreadyJoined ? 'PTE Public Access Active' : 'Join PTE Public Practice',
      joinHeadingSubtitle: joinState.alreadyJoined
        ? 'Your current account already has public PTE access.'
        : 'Use your current account to join public PTE packages and practice access.',
      existingUserContinueHref: joinState.alreadyJoined ? '/pte/packages' : '/pte',
      submitButtonLabel: joinState.alreadyJoined ? 'Browse Public Packages' : 'Join Public PTE'
    });
  }

  return res.render('person/publicJoin', {
    title: 'Join PTE Practice',
    person: {},
    user: null,
    includeModal: true,
    showOrganizationsTab: false,
    canEditOrganizations: false,
    availableOrganizations: [],
    fixedOrganizations: [],
    formAction: '/pte/join',
    joinHeadingTitle: 'Join PTE Practice',
    joinHeadingSubtitle: 'Create your account to start PTE practice and mock exams.',
    submitButtonLabel: 'Create PTE Account'
  });
}

async function processPtePublicJoin(req, res) {
  try {
    if (req.user) {
      const joinResult = await ptePublicJoinService.joinExistingUserToPtePublic(req.user);
      return res.json({
        status: 'success',
        message: joinResult.alreadyJoined
          ? 'Your account already has public PTE access. You can use public PTE packages with this same login.'
          : 'Your account now has public PTE access. You can use public PTE packages with this same login.',
        existingUserJoin: true,
        existingUserAlreadyJoined: joinResult.alreadyJoined === true,
        redirect: '/pte/packages'
      });
    }

    const result = await ptePublicJoinService.registerGuestPtePublic(req.body);
    return res.json({
      status: 'success',
      message: 'PTE account created successfully.',
      tempPassword: result.tempPassword,
      userEditUrl: null,
      isPublicJoin: true
    });
  } catch (error) {
    console.error('PTE Join Error:', error);
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Registration Error',
      message: error.message,
      user: req.user || null
    });
  }
}

module.exports = {
  showPtePublicJoinForm,
  processPtePublicJoin
};
