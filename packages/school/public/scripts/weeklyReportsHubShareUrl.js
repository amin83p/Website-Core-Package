(function (global) {
  'use strict';

  const SECTION_WEEKLY_REPORTS = 'weekly-reports';
  const SECTION_STUDENT_PROGRESS = 'student-progress';

  function trimString(value) {
    return String(value == null ? '' : value).trim();
  }

  function selectionIds(selections) {
    return (Array.isArray(selections) ? selections : [])
      .map(function (item) { return trimString(item && item.id); })
      .filter(Boolean);
  }

  function selectionNames(selections) {
    return (Array.isArray(selections) ? selections : [])
      .map(function (item) {
        const id = trimString(item && item.id);
        const name = trimString(item && item.name);
        return name || id;
      })
      .filter(Boolean);
  }

  function selectionsFromIds(idsCsv, namesCsv) {
    const ids = trimString(idsCsv).split(',').map(function (part) { return part.trim(); }).filter(Boolean);
    const names = trimString(namesCsv).split(',').map(function (part) { return part.trim(); });
    return ids.map(function (id, index) {
      return { id: id, name: names[index] || id };
    });
  }

  /**
   * @param {{ filtersSnapshot?: object, viewState?: object, tab?: object }} input
   * @returns {object}
   */
  function buildWeeklyReportsShareState(input) {
    const opts = input || {};
    const filters = opts.filtersSnapshot || {};
    const viewState = opts.viewState || {};
    const tab = opts.tab || {};
    const tabType = tab.type === 'students' ? 'students' : 'classes';
    const view = tabType === 'students' ? 'students' : 'classes';
    const classIds = selectionIds(filters.classSelections);
    const studentIds = selectionIds(filters.studentSelections);

    const state = {
      section: SECTION_WEEKLY_REPORTS,
      startDate: trimString(filters.startDate),
      endDate: trimString(filters.endDate),
      departmentId: trimString(filters.departmentId),
      programId: trimString(filters.programId),
      teacherPersonId: trimString(filters.teacherPersonId),
      classIds: classIds.join(','),
      studentIds: studentIds.join(','),
      view: view,
      classId: tabType === 'students' ? trimString(tab.classId || viewState.selectedClassId) : '',
      className: tabType === 'students'
        ? trimString(tab.className || viewState.selectedClassName)
        : '',
      viewMode: viewState.viewMode === 'board' ? 'board' : 'list',
      listSort: trimString(viewState.listSort && viewState.listSort.key),
      listSortDir: viewState.listSort && viewState.listSort.dir === 'desc' ? 'desc' : 'asc',
      classListSort: trimString(viewState.classListSort && viewState.classListSort.key),
      classListSortDir: viewState.classListSort && viewState.classListSort.dir === 'desc' ? 'desc' : 'asc',
      studentDetailId: trimString(viewState.studentDetailId),
      studentDetailName: trimString(viewState.studentDetailName)
    };

    if (!state.listSort) {
      state.listSort = 'name';
    }
    if (!state.classListSort) {
      state.classListSort = 'className';
    }

    return state;
  }

  /**
   * @param {{ filtersSnapshot?: object, viewState?: object }} input
   * @returns {object}
   */
  function buildStudentProgressShareState(input) {
    const opts = input || {};
    const filters = opts.filtersSnapshot || {};
    const viewState = opts.viewState || {};
    const studentIds = selectionIds(filters.studentSelections);
    return {
      section: SECTION_STUDENT_PROGRESS,
      startDate: trimString(filters.startDate),
      endDate: trimString(filters.endDate),
      studentIds: studentIds.join(','),
      progressView: viewState.viewMode === 'table' ? 'table' : 'analytics'
    };
  }

  function setParamIfPresent(params, key, value) {
    const normalized = trimString(value);
    if (!normalized) return;
    params.set(key, normalized);
  }

  /**
   * @param {object} state
   * @returns {URLSearchParams}
   */
  function stateToSearchParams(state) {
    const src = state || {};
    const params = new URLSearchParams();
    setParamIfPresent(params, 'section', src.section || SECTION_WEEKLY_REPORTS);
    setParamIfPresent(params, 'startDate', src.startDate);
    setParamIfPresent(params, 'endDate', src.endDate);
    setParamIfPresent(params, 'departmentId', src.departmentId);
    setParamIfPresent(params, 'programId', src.programId);
    setParamIfPresent(params, 'teacherPersonId', src.teacherPersonId);
    setParamIfPresent(params, 'classIds', src.classIds);
    setParamIfPresent(params, 'studentIds', src.studentIds);
    setParamIfPresent(params, 'view', src.view);
    setParamIfPresent(params, 'classId', src.classId);
    setParamIfPresent(params, 'className', src.className);
    setParamIfPresent(params, 'viewMode', src.viewMode);
    if (src.listSort && src.listSort !== 'name') {
      setParamIfPresent(params, 'listSort', src.listSort);
    }
    if (src.listSortDir === 'desc') {
      setParamIfPresent(params, 'listSortDir', 'desc');
    }
    if (src.classListSort && src.classListSort !== 'className') {
      setParamIfPresent(params, 'classListSort', src.classListSort);
    }
    if (src.classListSortDir === 'desc') {
      setParamIfPresent(params, 'classListSortDir', 'desc');
    }
    setParamIfPresent(params, 'studentDetailId', src.studentDetailId);
    setParamIfPresent(params, 'studentDetailName', src.studentDetailName);
    if (src.section === SECTION_STUDENT_PROGRESS) {
      setParamIfPresent(params, 'studentIds', src.studentIds);
      if (src.progressView === 'table') {
        setParamIfPresent(params, 'progressView', 'table');
      }
    }
    return params;
  }

  /**
   * @param {URLSearchParams|object|string} paramsInput
   * @returns {{ section: string, filtersSnapshot: object, viewState: object, tab: object }}
   */
  function searchParamsToState(paramsInput) {
    let params;
    if (paramsInput instanceof URLSearchParams) {
      params = paramsInput;
    } else if (typeof paramsInput === 'string') {
      params = new URLSearchParams(paramsInput.startsWith('?') ? paramsInput.slice(1) : paramsInput);
    } else {
      params = new URLSearchParams(paramsInput || {});
    }

    const section = trimString(params.get('section')).toLowerCase();
    if (section === SECTION_STUDENT_PROGRESS) {
      const studentSelections = selectionsFromIds(params.get('studentIds'), '');
      const progressViewRaw = trimString(params.get('progressView')).toLowerCase();
      return {
        section: SECTION_STUDENT_PROGRESS,
        filtersSnapshot: {
          startDate: trimString(params.get('startDate')),
          endDate: trimString(params.get('endDate')),
          studentSelections: studentSelections
        },
        viewState: {
          viewMode: progressViewRaw === 'table' ? 'table' : 'analytics'
        },
        tab: { type: 'student-progress' }
      };
    }
    if (section !== SECTION_WEEKLY_REPORTS) {
      return {
        section: section,
        filtersSnapshot: {},
        viewState: {},
        tab: { type: 'classes' }
      };
    }

    const classSelections = selectionsFromIds(params.get('classIds'), '');
    const studentSelections = selectionsFromIds(params.get('studentIds'), '');
    const view = trimString(params.get('view')).toLowerCase() === 'students' ? 'students' : 'classes';
    const classId = trimString(params.get('classId'));
    const className = trimString(params.get('className')) || classId;
    const viewModeRaw = trimString(params.get('viewMode')).toLowerCase();
    const listSort = trimString(params.get('listSort')) || 'name';
    const listSortDir = trimString(params.get('listSortDir')).toLowerCase() === 'desc' ? 'desc' : 'asc';
    const classListSort = trimString(params.get('classListSort')) || 'className';
    const classListSortDir = trimString(params.get('classListSortDir')).toLowerCase() === 'desc' ? 'desc' : 'asc';

    const filtersSnapshot = {
      startDate: trimString(params.get('startDate')),
      endDate: trimString(params.get('endDate')),
      departmentId: trimString(params.get('departmentId')),
      programId: trimString(params.get('programId')),
      teacherPersonId: trimString(params.get('teacherPersonId')),
      classSelections: classSelections,
      studentSelections: studentSelections
    };

    const viewState = {
      level: view === 'students' ? 'students' : 'classes',
      selectedClassId: view === 'students' ? classId : '',
      selectedClassName: view === 'students' ? className : '',
      viewMode: viewModeRaw === 'board' ? 'board' : 'list',
      listSort: { key: listSort, dir: listSortDir },
      classListSort: { key: classListSort, dir: classListSortDir },
      studentDetailId: trimString(params.get('studentDetailId')),
      studentDetailName: trimString(params.get('studentDetailName'))
    };

    const tab = {
      type: view === 'students' ? 'students' : 'classes',
      classId: classId,
      className: className
    };

    return {
      section: SECTION_WEEKLY_REPORTS,
      filtersSnapshot: filtersSnapshot,
      viewState: viewState,
      tab: tab
    };
  }

  function buildShareUrl(origin, pathname, state) {
    const baseOrigin = trimString(origin) || '';
    const basePath = trimString(pathname) || '/school/report-hub';
    const params = stateToSearchParams(state);
    const query = params.toString();
    return baseOrigin + basePath + (query ? '?' + query : '');
  }

  const api = {
    SECTION_WEEKLY_REPORTS: SECTION_WEEKLY_REPORTS,
    SECTION_STUDENT_PROGRESS: SECTION_STUDENT_PROGRESS,
    buildWeeklyReportsShareState: buildWeeklyReportsShareState,
    buildStudentProgressShareState: buildStudentProgressShareState,
    stateToSearchParams: stateToSearchParams,
    searchParamsToState: searchParamsToState,
    buildShareUrl: buildShareUrl,
    selectionIds: selectionIds,
    selectionNames: selectionNames
  };

  global.WeeklyReportsHubShareUrl = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
