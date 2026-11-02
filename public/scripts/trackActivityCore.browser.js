(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TrackActivityCoreBrowser = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
return (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // scripts/core/browser-stubs/dataService.js
  var require_dataService = __commonJS({
    "scripts/core/browser-stubs/dataService.js"(exports, module) {
      "use strict";
      module.exports = {
        fetchData: async () => [],
        getDataById: async () => null
      };
    }
  });

  // MVC/utils/idAdapter.js
  var require_idAdapter = __commonJS({
    "MVC/utils/idAdapter.js"(exports, module) {
      function toPublicId(value) {
        if (value === null || value === void 0) return "";
        if (typeof value === "string") return value.trim();
        if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
          return String(value);
        }
        if (typeof value === "object") {
          if (typeof value.toHexString === "function") {
            return String(value.toHexString()).trim();
          }
          if (value._id !== void 0 && value._id !== null) {
            return toPublicId(value._id);
          }
          if (value.id !== void 0 && value.id !== null) {
            return toPublicId(value.id);
          }
          if (typeof value.toString === "function") {
            const raw = String(value.toString()).trim();
            if (raw && raw !== "[object Object]") return raw;
          }
        }
        return "";
      }
      function toStorageId(value, options = {}) {
        const normalized = toPublicId(value);
        if (!normalized) return null;
        if (options?.preferNumber === true && /^-?\d+$/.test(normalized)) {
          return Number(normalized);
        }
        return normalized;
      }
      function idsEqual(left, right, options = {}) {
        const leftId = toPublicId(left);
        const rightId = toPublicId(right);
        if (!leftId || !rightId) return false;
        if (options?.caseInsensitive === true) {
          return leftId.toLowerCase() === rightId.toLowerCase();
        }
        return leftId === rightId;
      }
      function toIdArray(values) {
        if (!Array.isArray(values)) return [];
        return values.map((item) => toPublicId(item)).filter(Boolean);
      }
      module.exports = {
        toPublicId,
        toStorageId,
        idsEqual,
        toIdArray
      };
    }
  });

  // scripts/core/browser-stubs/settingService.js
  var require_settingService = __commonJS({
    "scripts/core/browser-stubs/settingService.js"(exports, module) {
      "use strict";
      module.exports = {
        get: () => ({ app: { defaultTimezone: "UTC", timezone: "UTC" } })
      };
    }
  });

  // MVC/utils/timezoneUtils.js
  var require_timezoneUtils = __commonJS({
    "MVC/utils/timezoneUtils.js"(exports, module) {
      var settingService2 = require_settingService();
      var FALLBACK_TIMEZONE = "UTC";
      var CURATED_TIMEZONE_OPTIONS = Object.freeze([
        { group: "UTC", value: "UTC", label: "UTC" },
        { group: "Americas", value: "America/St_Johns", label: "America/St_Johns (Newfoundland)" },
        { group: "Americas", value: "America/Halifax", label: "America/Halifax (Atlantic)" },
        { group: "Americas", value: "America/Toronto", label: "America/Toronto (Eastern)" },
        { group: "Americas", value: "America/New_York", label: "America/New_York (Eastern)" },
        { group: "Americas", value: "America/Chicago", label: "America/Chicago (Central)" },
        { group: "Americas", value: "America/Winnipeg", label: "America/Winnipeg (Central)" },
        { group: "Americas", value: "America/Edmonton", label: "America/Edmonton (Mountain)" },
        { group: "Americas", value: "America/Denver", label: "America/Denver (Mountain)" },
        { group: "Americas", value: "America/Vancouver", label: "America/Vancouver (Pacific)" },
        { group: "Americas", value: "America/Los_Angeles", label: "America/Los_Angeles (Pacific)" },
        { group: "Americas", value: "America/Mexico_City", label: "America/Mexico_City" },
        { group: "Americas", value: "America/Sao_Paulo", label: "America/Sao_Paulo" },
        { group: "Europe", value: "Europe/London", label: "Europe/London" },
        { group: "Europe", value: "Europe/Paris", label: "Europe/Paris" },
        { group: "Europe", value: "Europe/Berlin", label: "Europe/Berlin" },
        { group: "Europe", value: "Europe/Istanbul", label: "Europe/Istanbul" },
        { group: "Europe", value: "Europe/Moscow", label: "Europe/Moscow" },
        { group: "Asia", value: "Asia/Dubai", label: "Asia/Dubai" },
        { group: "Asia", value: "Asia/Tehran", label: "Asia/Tehran" },
        { group: "Asia", value: "Asia/Karachi", label: "Asia/Karachi" },
        { group: "Asia", value: "Asia/Kolkata", label: "Asia/Kolkata" },
        { group: "Asia", value: "Asia/Dhaka", label: "Asia/Dhaka" },
        { group: "Asia", value: "Asia/Bangkok", label: "Asia/Bangkok" },
        { group: "Asia", value: "Asia/Singapore", label: "Asia/Singapore" },
        { group: "Asia", value: "Asia/Hong_Kong", label: "Asia/Hong_Kong" },
        { group: "Asia", value: "Asia/Shanghai", label: "Asia/Shanghai" },
        { group: "Asia", value: "Asia/Tokyo", label: "Asia/Tokyo" },
        { group: "Asia", value: "Asia/Seoul", label: "Asia/Seoul" },
        { group: "Pacific", value: "Australia/Perth", label: "Australia/Perth" },
        { group: "Pacific", value: "Australia/Sydney", label: "Australia/Sydney" },
        { group: "Pacific", value: "Pacific/Auckland", label: "Pacific/Auckland" }
      ]);
      function cleanTimezoneToken(value) {
        return String(value ?? "").trim().slice(0, 80);
      }
      function isValidTimezoneToken(token) {
        const value = cleanTimezoneToken(token);
        if (!value) return false;
        try {
          Intl.DateTimeFormat("en-US", { timeZone: value });
          return true;
        } catch (_) {
          return false;
        }
      }
      function normalizeTimezoneToken(value, fallback = FALLBACK_TIMEZONE) {
        const token = cleanTimezoneToken(value);
        if (!token) return normalizeTimezoneToken(fallback, FALLBACK_TIMEZONE);
        if (!isValidTimezoneToken(token)) return normalizeTimezoneToken(fallback, FALLBACK_TIMEZONE);
        return token;
      }
      function resolveDefaultTimezone() {
        try {
          const settings = settingService2.get();
          const candidate = settings?.app?.defaultTimezone || settings?.app?.timezone || FALLBACK_TIMEZONE;
          return normalizeTimezoneToken(candidate, FALLBACK_TIMEZONE);
        } catch (_) {
          return FALLBACK_TIMEZONE;
        }
      }
      function listCuratedTimezoneOptions() {
        return CURATED_TIMEZONE_OPTIONS.map((row) => ({ ...row }));
      }
      function isCuratedTimezoneValue(value) {
        const token = cleanTimezoneToken(value);
        if (!token) return false;
        return CURATED_TIMEZONE_OPTIONS.some((row) => row.value === token);
      }
      function parseOrganizationTimezoneInput(body = {}, fallback = resolveDefaultTimezone()) {
        const selectValue = cleanTimezoneToken(body.timeZone || body.timezone);
        let rawValue = selectValue;
        if (selectValue === "__default__" || !selectValue) {
          rawValue = fallback;
        } else if (selectValue === "__custom__") {
          rawValue = cleanTimezoneToken(body.timeZoneCustom || body.timezoneCustom);
        }
        if (!rawValue) {
          return {
            timeZone: normalizeTimezoneToken(fallback, FALLBACK_TIMEZONE),
            error: ""
          };
        }
        if (!isValidTimezoneToken(rawValue)) {
          return {
            timeZone: "",
            error: "Timezone must be a valid IANA timezone (e.g. America/Edmonton)."
          };
        }
        return {
          timeZone: normalizeTimezoneToken(rawValue, fallback),
          error: ""
        };
      }
      function formatNowInTimezone(timeZone = FALLBACK_TIMEZONE) {
        return formatInstantInTimezone(/* @__PURE__ */ new Date(), timeZone, {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true
        });
      }
      function resolveOrganizationTimezoneFromRow(row = {}) {
        const candidates = [
          row?.settings?.timeZone,
          row?.settings?.timezone,
          row?.timeZone,
          row?.timezone,
          row?.identity?.timeZone,
          row?.identity?.timezone
        ];
        for (const candidate of candidates) {
          const token = cleanTimezoneToken(candidate);
          if (!token) continue;
          return normalizeTimezoneToken(token, resolveDefaultTimezone());
        }
        return resolveDefaultTimezone();
      }
      function resolveActiveOrgTimezoneFromUser(user = {}) {
        const explicit = cleanTimezoneToken(user?.activeOrgTimeZone);
        if (explicit && isValidTimezoneToken(explicit)) {
          return normalizeTimezoneToken(explicit, resolveDefaultTimezone());
        }
        const activeOrgId = String(user?.activeOrgId || "").trim();
        if (activeOrgId && activeOrgId !== "SYSTEM") {
          const allowedOrgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
          const activeOrg = allowedOrgs.find((row) => {
            const orgId = String(row?.orgId || row?.id || "").trim();
            return orgId && orgId === activeOrgId;
          });
          if (activeOrg?.timeZone) {
            return normalizeTimezoneToken(activeOrg.timeZone, resolveDefaultTimezone());
          }
        }
        if (activeOrgId === "SYSTEM") {
          return resolveDefaultTimezone();
        }
        return resolveDefaultTimezone();
      }
      function getDateTimePartsInTimezone(ms = Date.now(), timeZone = FALLBACK_TIMEZONE) {
        const date = new Date(Number(ms || 0));
        if (Number.isNaN(date.getTime())) return null;
        try {
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: normalizeTimezoneToken(timeZone, FALLBACK_TIMEZONE),
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
            hour12: false
          }).formatToParts(date);
          const pick = (type) => parts.find((part) => part.type === type)?.value || "";
          let hour = Number(pick("hour") || 0);
          if (hour === 24) hour = 0;
          return {
            year: Number(pick("year") || 0),
            month: Number(pick("month") || 0),
            day: Number(pick("day") || 0),
            hour,
            minute: Number(pick("minute") || 0),
            second: Number(pick("second") || 0)
          };
        } catch (_) {
          return {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
            hour: date.getUTCHours(),
            minute: date.getUTCMinutes(),
            second: date.getUTCSeconds()
          };
        }
      }
      function getTodayDateKeyInTimezone(timeZone = FALLBACK_TIMEZONE, referenceMs = Date.now()) {
        const parts = getDateTimePartsInTimezone(referenceMs, timeZone);
        if (!parts?.year || !parts?.month || !parts?.day) {
          return new Date(referenceMs).toISOString().slice(0, 10);
        }
        return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
      }
      function getDateKeyInTimezone(isoDateTime = "", timeZone = FALLBACK_TIMEZONE) {
        const ms = isoDateTime ? coerceInstantMs(isoDateTime) : Date.now();
        if (!Number.isFinite(ms)) return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        const parts = getDateTimePartsInTimezone(ms, timeZone);
        if (!parts?.year || !parts?.month || !parts?.day) {
          return new Date(ms).toISOString().slice(0, 10);
        }
        return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
      }
      function shiftCalendarParts(parts = {}, deltaDays = 0) {
        const year = Number(parts.year || 0);
        const month = Number(parts.month || 0);
        const day = Number(parts.day || 0);
        if (!year || !month || !day) return { year: 0, month: 0, day: 0 };
        const date = new Date(Date.UTC(year, month - 1, day));
        date.setUTCDate(date.getUTCDate() + Number(deltaDays || 0));
        return {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate()
        };
      }
      function toUtcMsFromTimezoneLocal(parts = {}, timeZone = FALLBACK_TIMEZONE) {
        const year = Number(parts.year || 0);
        const month = Number(parts.month || 0);
        const day = Number(parts.day || 0);
        const hour = Number(parts.hour || 0);
        const minute = Number(parts.minute || 0);
        const second = Number(parts.second || 0);
        if (!year || !month || !day) return Number.NaN;
        let guess = Date.UTC(year, month - 1, day, hour, minute, second);
        for (let i = 0; i < 3; i += 1) {
          const currentParts = getDateTimePartsInTimezone(guess, timeZone);
          if (!currentParts) break;
          const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second);
          const currentUtc = Date.UTC(
            currentParts.year,
            currentParts.month - 1,
            currentParts.day,
            currentParts.hour,
            currentParts.minute,
            currentParts.second
          );
          const diff = desiredUtc - currentUtc;
          if (!diff) break;
          guess += diff;
        }
        return guess;
      }
      function getDayBoundsMs(referenceMs, timeZone = FALLBACK_TIMEZONE) {
        const parts = getDateTimePartsInTimezone(referenceMs, timeZone);
        if (!parts) {
          return {
            dateKey: "",
            dayStartMs: Number.NaN,
            dayEndMs: Number.NaN
          };
        }
        const dayStartMs = toUtcMsFromTimezoneLocal({
          year: parts.year,
          month: parts.month,
          day: parts.day,
          hour: 0,
          minute: 0,
          second: 0
        }, timeZone);
        const nextParts = shiftCalendarParts(parts, 1);
        const nextStartMs = toUtcMsFromTimezoneLocal({
          year: nextParts.year,
          month: nextParts.month,
          day: nextParts.day,
          hour: 0,
          minute: 0,
          second: 0
        }, timeZone);
        return {
          dateKey: `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
          dayStartMs,
          dayEndMs: Number(nextStartMs) - 1
        };
      }
      function formatMsToDateTimeLocalInput(ms, timeZone = FALLBACK_TIMEZONE) {
        const parts = getDateTimePartsInTimezone(ms, timeZone);
        if (!parts) return "";
        return [
          String(parts.year).padStart(4, "0"),
          "-",
          String(parts.month).padStart(2, "0"),
          "-",
          String(parts.day).padStart(2, "0"),
          "T",
          String(parts.hour).padStart(2, "0"),
          ":",
          String(parts.minute).padStart(2, "0")
        ].join("");
      }
      function coerceInstantMs(value) {
        if (value === void 0 || value === null || value === "") return NaN;
        if (typeof value === "number" && Number.isFinite(value)) return value;
        const date = new Date(value);
        return date.getTime();
      }
      function formatInstantInTimezone(value, timeZone = FALLBACK_TIMEZONE, options = {}) {
        const ms = coerceInstantMs(value);
        if (!Number.isFinite(ms)) return "-";
        const normalized = normalizeTimezoneToken(timeZone, FALLBACK_TIMEZONE);
        const {
          weekday,
          year = "numeric",
          month = "short",
          day = "2-digit",
          hour = "2-digit",
          minute = "2-digit",
          second,
          hour12 = false
        } = options;
        try {
          const formatOptions = {
            timeZone: normalized,
            year,
            month,
            day,
            hour,
            minute,
            hour12
          };
          if (second) formatOptions.second = second;
          if (weekday) formatOptions.weekday = weekday;
          return new Intl.DateTimeFormat("en-US", formatOptions).format(new Date(ms));
        } catch (_) {
          return new Date(ms).toISOString();
        }
      }
      function formatDateKeyInTimezone(dateKey, timeZone = FALLBACK_TIMEZONE, options = {}) {
        const token = String(dateKey || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return token || "-";
        const ms = coerceInstantMs(`${token}T12:00:00.000Z`);
        return formatInstantInTimezone(ms, timeZone, {
          weekday: options.weekday,
          year: options.year || "numeric",
          month: options.month || "short",
          day: options.day || "numeric",
          hour: void 0,
          minute: void 0,
          hour12: void 0
        });
      }
      function buildOrgTimezoneContext(user = null) {
        const timeZone = user ? resolveActiveOrgTimezoneFromUser(user) : resolveDefaultTimezone();
        const today = user?.orgToday && /^\d{4}-\d{2}-\d{2}$/.test(String(user.orgToday)) ? String(user.orgToday) : getTodayDateKeyInTimezone(timeZone);
        return {
          timeZone,
          today,
          source: user?.activeOrgTimeZone ? "user" : user ? "allowedOrgs" : "default"
        };
      }
      function attachOrgTimezoneContext(req, res) {
        const user = req?.user || null;
        const context = buildOrgTimezoneContext(user);
        req.orgTimeZone = context.timeZone;
        req.orgToday = context.today;
        if (user && !user.activeOrgTimeZone) {
          user.activeOrgTimeZone = context.timeZone;
        }
        if (user && !user.orgToday) {
          user.orgToday = context.today;
        }
        if (res?.locals) {
          res.locals.orgTimeZone = context.timeZone;
          res.locals.orgToday = context.today;
          res.locals.formatOrgDateTime = (value, opts = {}) => formatInstantInTimezone(value, context.timeZone, opts);
          res.locals.formatOrgDate = (value, opts = {}) => formatDateKeyInTimezone(value, context.timeZone, opts);
          res.locals.formatInstantInTimezone = (value, timeZone, opts = {}) => formatInstantInTimezone(
            value,
            cleanTimezoneToken(timeZone) || context.timeZone,
            opts
          );
        }
        return context;
      }
      function resolveOrgTodayFromRequest(req) {
        const fromRequest = String(req?.orgToday || req?.user?.orgToday || "").trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(fromRequest)) return fromRequest;
        return getTodayDateKeyInTimezone(req?.orgTimeZone || req?.user?.activeOrgTimeZone);
      }
      function resolveOrgYearFromRequest(req) {
        return resolveOrgTodayFromRequest(req).slice(0, 4);
      }
      function resolveOrgTodayFromContext({ orgToday, orgTimeZone, user, orgId } = {}) {
        void orgId;
        const explicit = String(orgToday || user?.orgToday || "").trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
        const tzToken = cleanTimezoneToken(orgTimeZone || user?.activeOrgTimeZone);
        if (tzToken && isValidTimezoneToken(tzToken)) {
          return getTodayDateKeyInTimezone(normalizeTimezoneToken(tzToken, resolveDefaultTimezone()));
        }
        return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      }
      function zonedWallClockToUtcMs(dateKey = "", timeHm = "00:00", timeZone = FALLBACK_TIMEZONE) {
        const dateToken = String(dateKey || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateToken)) return NaN;
        const timeToken = String(timeHm || "00:00").trim() || "00:00";
        const timeMatch = timeToken.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!timeMatch) return NaN;
        const year = Number(dateToken.slice(0, 4));
        const month = Number(dateToken.slice(5, 7));
        const day = Number(dateToken.slice(8, 10));
        const hour = Number(timeMatch[1]);
        const minute = Number(timeMatch[2]);
        const second = Number(timeMatch[3] || 0);
        if (![year, month, day, hour, minute, second].every((n) => Number.isFinite(n))) return NaN;
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return NaN;
        const tz = normalizeTimezoneToken(timeZone, FALLBACK_TIMEZONE);
        const desiredUtcLike = Date.UTC(year, month - 1, day, hour, minute, second);
        let guess = desiredUtcLike;
        for (let i = 0; i < 6; i += 1) {
          const parts = getDateTimePartsInTimezone(guess, tz);
          if (!parts) return NaN;
          let partHour = Number(parts.hour);
          if (partHour === 24) partHour = 0;
          const actualUtcLike = Date.UTC(
            Number(parts.year),
            Number(parts.month) - 1,
            Number(parts.day),
            partHour,
            Number(parts.minute),
            Number(parts.second)
          );
          const delta = desiredUtcLike - actualUtcLike;
          if (delta === 0) return guess;
          guess += delta;
        }
        return guess;
      }
      function zonedWallClockToIso(dateKey = "", timeHm = "00:00", timeZone = FALLBACK_TIMEZONE) {
        const ms = zonedWallClockToUtcMs(dateKey, timeHm, timeZone);
        if (!Number.isFinite(ms)) return "";
        return new Date(ms).toISOString();
      }
      module.exports = {
        FALLBACK_TIMEZONE,
        cleanTimezoneToken,
        isValidTimezoneToken,
        normalizeTimezoneToken,
        resolveDefaultTimezone,
        resolveOrganizationTimezoneFromRow,
        resolveActiveOrgTimezoneFromUser,
        getDateTimePartsInTimezone,
        getTodayDateKeyInTimezone,
        getDateKeyInTimezone,
        shiftCalendarParts,
        toUtcMsFromTimezoneLocal,
        getDayBoundsMs,
        formatMsToDateTimeLocalInput,
        formatInstantInTimezone,
        formatDateKeyInTimezone,
        buildOrgTimezoneContext,
        attachOrgTimezoneContext,
        resolveOrgTodayFromRequest,
        resolveOrgYearFromRequest,
        resolveOrgTodayFromContext,
        zonedWallClockToUtcMs,
        zonedWallClockToIso,
        listCuratedTimezoneOptions,
        isCuratedTimezoneValue,
        parseOrganizationTimezoneInput,
        formatNowInTimezone
      };
    }
  });

  // MVC/services/security/trackActivityCore.js
  var require_trackActivityCore = __commonJS({
    "MVC/services/security/trackActivityCore.js"(exports, module) {
      "use strict";
      var dataService = require_dataService();
      var { toPublicId } = require_idAdapter();
      var {
        resolveOrganizationTimezoneFromRow,
        getDateTimePartsInTimezone,
        getDateKeyInTimezone,
        getDayBoundsMs,
        toUtcMsFromTimezoneLocal,
        formatMsToDateTimeLocalInput
      } = require_timezoneUtils();
      var DEFAULT_LOOKBACK_DAYS = 7;
      var DEFAULT_MERGE_LIMIT = 1500;
      var DEFAULT_PAGE_SIZE = 50;
      var MAX_PAGE_SIZE = 200;
      var MIN_PAGE_SIZE = 5;
      var MAX_MERGE_LIMIT = 5e3;
      var MIN_MERGE_LIMIT = 100;
      var MAX_RANGE_DAYS = 7;
      var MAX_RANGE_MS = MAX_RANGE_DAYS * 24 * 60 * 60 * 1e3;
      var FALLBACK_MATCH_WINDOW_MS = 10 * 60 * 1e3;
      var REQUEST_MATCH_WINDOW_MS = 2 * 60 * 60 * 1e3;
      var DEFAULT_ORG_TIMEZONE = "UTC";
      var SYSTEM_SECTION_IDS = /* @__PURE__ */ new Set(["000000", "0000000"]);
      var SYSTEM_HTTP_OPERATION_NAME_MAP = Object.freeze({
        OP9001: "HTTP POST",
        OP9002: "HTTP GET",
        OP9003: "HTTP UNKNOWN",
        OP9004: "HTTP DELETE",
        OP9005: "HTTP PUT",
        OP9006: "HTTP PATCH"
      });
      var SUCCESS_STATUS_SET = /* @__PURE__ */ new Set(["success", "completed"]);
      var FAILURE_STATUS_SET = /* @__PURE__ */ new Set(["failure", "failed", "error", "denied", "blocked", "cancelled", "terminated"]);
      var DANGEROUS_CSV_PREFIX = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/;
      var SENSITIVE_KEY_PATTERN = /(password|passphrase|secret|token|authorization|cookie|set-cookie|apikey|api[_-]?key|session|jwt|ip|useragent|email|phone)/i;
      function cleanText(value, max = 220) {
        if (value === void 0 || value === null) return "";
        const text = String(value).trim();
        return text.length > max ? text.slice(0, max) : text;
      }
      function parsePositiveInteger(value, fallback = null) {
        const parsed = Number.parseInt(String(value ?? ""), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
        return parsed;
      }
      function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
      }
      function normalizeIdToken(value, max = 120) {
        const token = cleanText(value, max);
        if (!token) return "";
        return toPublicId(token) || token;
      }
      function parseIdList(rawValue, max = 120, maxItems = 100) {
        const collected = [];
        const pushToken = (token) => {
          const normalized = normalizeIdToken(token, max);
          if (!normalized) return;
          collected.push(normalized);
        };
        const collect = (input) => {
          if (Array.isArray(input)) {
            input.forEach((item) => collect(item));
            return;
          }
          const token = cleanText(input, 5e3);
          if (!token) return;
          token.split(",").map((row) => row.trim()).filter(Boolean).forEach((row) => pushToken(row));
        };
        collect(rawValue);
        return Array.from(new Set(collected)).slice(0, Math.max(1, Number(maxItems) || 1));
      }
      function buildIdFilterSet(rawList, rawSingle, max = 120) {
        const list = parseIdList(rawList, max, 200);
        if (list.length) return new Set(list);
        const single = normalizeIdToken(rawSingle, max);
        return single ? /* @__PURE__ */ new Set([single]) : /* @__PURE__ */ new Set();
      }
      function normalizeSource(value) {
        const token = cleanText(value, 40).toLowerCase();
        if (token === "log" || token === "logs") return "log";
        if (token === "action_state" || token === "actionstate" || token === "action_states" || token === "actionstates") return "action_state";
        return "";
      }
      function normalizeZoomLevel(value) {
        const token = cleanText(value, 20).toLowerCase();
        if (token === "5m") return "5m";
        if (token === "event") return "event";
        return "30m";
      }
      function normalizeStatus(value) {
        return cleanText(value, 80).toLowerCase();
      }
      function normalizeTimezoneToken(value, fallback = DEFAULT_ORG_TIMEZONE) {
        const token = cleanText(value, 80) || fallback;
        try {
          Intl.DateTimeFormat("en-US", { timeZone: token });
          return token;
        } catch (_) {
          return fallback;
        }
      }
      function resolveDefaultTimezone() {
        const settings = settingService.get();
        const token = settings?.app?.defaultTimezone || settings?.app?.timezone || DEFAULT_ORG_TIMEZONE;
        return normalizeTimezoneToken(token, DEFAULT_ORG_TIMEZONE);
      }
      function formatDateTimeInTimezone(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
        const date = new Date(Number(ms || 0));
        if (Number.isNaN(date.getTime())) return "-";
        try {
          return new Intl.DateTimeFormat("en-US", {
            timeZone: normalizeTimezoneToken(timeZone, resolveDefaultTimezone()),
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
          }).format(date);
        } catch (_) {
          return date.toISOString();
        }
      }
      function toDateKeyInTimezone(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
        const date = new Date(Number(ms || 0));
        if (Number.isNaN(date.getTime())) return "";
        return getDateKeyInTimezone(date.toISOString(), timeZone);
      }
      function parseDateTimeInputToMs(value, timeZone = DEFAULT_ORG_TIMEZONE, { endOfDay = false } = {}) {
        const token = cleanText(value, 80);
        if (!token) return Number.NaN;
        if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
          const normalized = `${token}T${endOfDay ? "23:59:59" : "00:00:00"}`;
          const parsed2 = new Date(normalized);
          return Number.isNaN(parsed2.getTime()) ? Number.NaN : parsed2.getTime();
        }
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(token)) {
          const normalized = token.length === 16 ? `${token}:00` : token;
          const parsed2 = new Date(normalized);
          return Number.isNaN(parsed2.getTime()) ? Number.NaN : parsed2.getTime();
        }
        const parsed = new Date(token);
        return Number.isNaN(parsed.getTime()) ? Number.NaN : parsed.getTime();
      }
      function resolveDefaultRangeMs(nowMs = Date.now()) {
        const endAtMs = Number(nowMs || Date.now());
        const startAtMs = endAtMs - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1e3 + 1;
        return { startAtMs, endAtMs };
      }
      function buildLookupMap(rows = []) {
        const map = /* @__PURE__ */ new Map();
        (Array.isArray(rows) ? rows : []).forEach((row) => {
          const id = toPublicId(row?.id);
          if (!id) return;
          map.set(id, row);
        });
        return map;
      }
      function resolveSectionInfo(sectionId, sectionMap) {
        const id = cleanText(sectionId, 120);
        if (!id) return { id: "", name: "N/A" };
        if (SYSTEM_SECTION_IDS.has(id)) return { id, name: "SYSTEM" };
        const row = sectionMap.get(toPublicId(id)) || null;
        return { id, name: cleanText(row?.name, 180) || id };
      }
      function resolveOperationFallbackName(operationId = "", context = {}) {
        const fromMap = cleanText(SYSTEM_HTTP_OPERATION_NAME_MAP[String(operationId || "").toUpperCase()], 180);
        if (fromMap) return fromMap;
        const method = cleanText(context?.method || context?.httpMethod, 20).toUpperCase();
        if (method) return `HTTP ${method}`;
        return "";
      }
      function resolveOperationInfo(operationId, operationMap, context = null) {
        const id = cleanText(operationId, 120);
        if (!id) return { id: "", name: "N/A" };
        const row = operationMap.get(toPublicId(id)) || null;
        const lookupName = cleanText(row?.name, 180);
        if (lookupName) return { id, name: lookupName };
        const fallbackName = resolveOperationFallbackName(id, context || {});
        return { id, name: fallbackName || id };
      }
      function resolveOrgName(org) {
        return cleanText(org?.identity?.displayName || org?.name, 180);
      }
      function resolveUserDisplayName(user = null) {
        if (!user || typeof user !== "object") return "";
        const displayName = cleanText(user.displayName, 180);
        if (displayName) return displayName;
        if (typeof user.name === "string") return cleanText(user.name, 180);
        if (user.name && typeof user.name === "object") {
          return cleanText(`${user.name.first || ""} ${user.name.last || ""}`, 180);
        }
        return "";
      }
      function resolveUserOrgId(user = null) {
        if (!user || typeof user !== "object") return "";
        const direct = toPublicId(user.activeOrgId || user.primaryOrgId || user.orgId);
        if (direct) return direct;
        const rows = Array.isArray(user.organizations) ? user.organizations : [];
        for (const row of rows) {
          const token = toPublicId(row?.orgId || row?.id || "");
          if (token) return token;
        }
        return "";
      }
      function isSystemActorToken(value) {
        const token = cleanText(value, 120).toLowerCase();
        return token === "system" || token === "sys" || token === "root_system";
      }
      function buildActorIdentity(base = {}, userMap = /* @__PURE__ */ new Map(), orgMap = /* @__PURE__ */ new Map()) {
        const input = base && typeof base === "object" ? base : {};
        const userIdRaw = cleanText(input.userId, 120);
        const userId = toPublicId(userIdRaw) || userIdRaw;
        const knownUser = userId ? userMap.get(userId) : null;
        const username = cleanText(input.username, 140) || cleanText(knownUser?.username, 140);
        const displayName = cleanText(input.displayName, 180) || resolveUserDisplayName(knownUser);
        const orgId = toPublicId(input.orgId) || resolveUserOrgId(knownUser);
        const orgName = orgId ? resolveOrgName(orgMap.get(orgId)) : "";
        const isSystem = cleanText(input.actorType, 40).toLowerCase() === "system" || isSystemActorToken(userId);
        const primary = isSystem ? "System" : displayName || username || (userId ? `User ${userId}` : "User");
        const secondaryParts = [];
        if (!isSystem && username && username.toLowerCase() !== primary.toLowerCase()) secondaryParts.push(`@${username}`);
        if (!isSystem && userId) secondaryParts.push(`ID: ${userId}`);
        if (orgName && orgId) secondaryParts.push(`Org: ${orgName} (${orgId})`);
        else if (orgName) secondaryParts.push(`Org: ${orgName}`);
        else if (orgId) secondaryParts.push(`Org: ${orgId}`);
        return {
          actorType: isSystem ? "system" : "user",
          userId: isSystem ? "system" : userId,
          username: username || "",
          displayName: displayName || "",
          orgId: orgId || "",
          orgName: orgName || "",
          primary,
          secondary: secondaryParts.join(" | ")
        };
      }
      function resolveLogTimestamp(log = {}) {
        return cleanText(
          log.timestamp || log.createdAt || log.updatedAt || log?.audit?.createDateTime || log?.audit?.lastUpdateDateTime,
          80
        );
      }
      function resolveLogRequestId(log = {}) {
        return cleanText(log.requestId || log?.details?.requestId, 120);
      }
      function resolveLogActionStateId(log = {}) {
        return cleanText(log.actionStateId || log?.details?.actionStateId, 180);
      }
      function collectActionContextCandidates(state = {}) {
        const rows = [];
        const push = (value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return;
          rows.push(value);
        };
        push(state.initialContext);
        push(state.context);
        push(state.progress?.context);
        push(state.result?.context);
        push(state.failure?.context);
        push(state.retryableError?.context);
        if (Array.isArray(state.history)) {
          state.history.forEach((item) => push(item?.context));
        }
        return rows;
      }
      function resolveActionTimestamp(state = {}) {
        return cleanText(
          state.startedAt || state.createdAt || state.updatedAt || state.lastActiveAt || state?.history?.[0]?.ts,
          80
        );
      }
      function resolveActionContextValue(state = {}, keys = []) {
        const candidates = collectActionContextCandidates(state);
        for (const key of keys) {
          const direct = cleanText(state?.[key], 180);
          if (direct) return direct;
          for (const candidate of candidates) {
            const token = cleanText(candidate?.[key], 180);
            if (token) return token;
          }
        }
        return "";
      }
      function resolveActionRequestId(state = {}) {
        const direct = cleanText(state.requestId, 120);
        if (direct) return direct;
        const fromContext = resolveActionContextValue(state, ["requestId"]);
        if (fromContext) return cleanText(fromContext, 120);
        return "";
      }
      function buildActionSummary(action = {}, sectionName = "", operationName = "") {
        const method = cleanText(action.method, 20).toUpperCase();
        const url = cleanText(action.url, 240);
        const targetKey = cleanText(action.targetKey, 140);
        const status = cleanText(action.statusRaw, 80);
        const base = [method, url].filter(Boolean).join(" ").trim() || `${operationName || "N/A"} in ${sectionName || "N/A"}`;
        const target = targetKey && targetKey !== "GLOBAL_SCOPE" ? ` target:${targetKey}` : "";
        const statusToken = status ? ` (${status})` : "";
        return `${base}${target}${statusToken}`.trim();
      }
      function buildLogSummary(log = {}, sectionName = "", operationName = "") {
        const details = log && typeof log.details === "object" ? log.details : {};
        const method = cleanText(details.method || details.httpMethod, 20).toUpperCase();
        const url = cleanText(details.url || details.targetUrl || details.path, 240);
        const errorMessage = cleanText(details.errorMessage || details.message, 220);
        const base = [method, url].filter(Boolean).join(" ").trim() || `${operationName || "N/A"} in ${sectionName || "N/A"}`;
        return errorMessage ? `${base} | ${errorMessage}` : base;
      }
      function buildActionStateProjection(state = {}, lookups = {}, timezone = DEFAULT_ORG_TIMEZONE) {
        const sectionInfo = resolveSectionInfo(state.sectionId, lookups.sectionMap);
        const methodFromState = cleanText(resolveActionContextValue(state, ["method"]), 20).toUpperCase();
        const operationInfo = resolveOperationInfo(state.operationId, lookups.operationMap, { method: methodFromState });
        const actor = buildActorIdentity({
          userId: state.userId || resolveActionContextValue(state, ["userId"]),
          username: resolveActionContextValue(state, ["username"]),
          displayName: resolveActionContextValue(state, ["displayName"]),
          orgId: resolveActionContextValue(state, ["orgId"]),
          actorType: isSystemActorToken(state.userId) ? "system" : "user"
        }, lookups.userMap, lookups.orgMap);
        const occurredAt = resolveActionTimestamp(state);
        const occurredAtMs = Number.isNaN(new Date(occurredAt).getTime()) ? 0 : new Date(occurredAt).getTime();
        const requestId = resolveActionRequestId(state);
        const orgId = toPublicId(resolveActionContextValue(state, ["orgId"])) || actor.orgId || "";
        const orgName = resolveActionContextValue(state, ["orgName"]) || actor.orgName || (orgId ? resolveOrgName(lookups.orgMap.get(orgId)) : "");
        const projection = {
          source: "action_state",
          sourceLabel: "Action State",
          recordId: cleanText(state.id, 140),
          requestId,
          statusRaw: cleanText(state.status, 80),
          statusNormalized: normalizeStatus(state.status),
          userId: actor.userId,
          username: actor.username,
          displayName: actor.displayName,
          orgId,
          orgName,
          actorPrimary: actor.primary,
          actorSecondary: actor.secondary,
          sectionId: sectionInfo.id,
          sectionName: sectionInfo.name,
          operationId: operationInfo.id,
          operationName: operationInfo.name,
          targetKey: cleanText(state.targetKey, 140),
          method: cleanText(resolveActionContextValue(state, ["method"]), 20).toUpperCase(),
          url: cleanText(resolveActionContextValue(state, ["url"]), 240),
          occurredAt,
          occurredAtMs,
          occurredAtDisplay: formatDateTimeInTimezone(occurredAtMs, timezone),
          details: {
            targetKey: cleanText(state.targetKey, 140),
            attemptCount: Number(state.attemptCount || 0),
            volumeUsageKB: Number(state.volumeUsageKB || 0),
            appliedLimits: state.appliedLimits || {},
            initialContext: state.initialContext || {},
            context: state.context || {},
            history: Array.isArray(state.history) ? state.history : [],
            progress: state.progress || {},
            result: state.result || {},
            failure: state.failure || {},
            retryableError: state.retryableError || {},
            encryptedPayloadSaved: Boolean(state.finalData),
            changeEventsSaved: Array.isArray(state.changeEvents) && state.changeEvents.length > 0
          }
        };
        projection.summary = buildActionSummary(projection, sectionInfo.name, operationInfo.name);
        return projection;
      }
      function buildLogEvent(log = {}, lookups = {}, timezone = DEFAULT_ORG_TIMEZONE) {
        const details = log && typeof log.details === "object" && log.details ? log.details : {};
        const sectionInfo = resolveSectionInfo(log.sectionId, lookups.sectionMap);
        const operationInfo = resolveOperationInfo(log.operationId, lookups.operationMap, details);
        const actorFromDetails = log && typeof log.details?.actor === "object" ? log.details.actor : {};
        const actor = buildActorIdentity({
          userId: log.userId || actorFromDetails.userId,
          username: log.username || actorFromDetails.username,
          displayName: log.displayName || actorFromDetails.displayName,
          orgId: log.orgId || actorFromDetails.orgId,
          actorType: log.actorType || actorFromDetails.actorType
        }, lookups.userMap, lookups.orgMap);
        const occurredAt = resolveLogTimestamp(log);
        const occurredAtMs = Number.isNaN(new Date(occurredAt).getTime()) ? 0 : new Date(occurredAt).getTime();
        const requestId = resolveLogRequestId(log);
        const actionStateId = resolveLogActionStateId(log);
        return {
          id: cleanText(log.id, 160) ? `log:${cleanText(log.id, 160)}` : `log:auto:${occurredAtMs}:${Math.random().toString(36).slice(2, 9)}`,
          source: "log",
          sourceLabel: "Log",
          recordId: cleanText(log.id, 140),
          occurredAt,
          occurredAtMs,
          occurredAtDisplay: formatDateTimeInTimezone(occurredAtMs, timezone),
          userId: actor.userId,
          username: actor.username,
          displayName: actor.displayName,
          orgId: actor.orgId,
          orgName: actor.orgName,
          actorType: actor.actorType,
          actorPrimary: actor.primary,
          actorSecondary: actor.secondary,
          sectionId: sectionInfo.id,
          sectionName: sectionInfo.name,
          operationId: operationInfo.id,
          operationName: operationInfo.name,
          statusRaw: cleanText(log.status, 80),
          statusNormalized: normalizeStatus(log.status),
          requestId,
          actionStateId,
          summary: buildLogSummary(log, sectionInfo.name, operationInfo.name),
          contextLine: `${sectionInfo.name} -> ${operationInfo.name}`,
          detailsRef: { source: "log", id: cleanText(log.id, 140) },
          details,
          actionState: null,
          hasActionState: false
        };
      }
      function buildEventSearchText(event = {}) {
        const tokens = [
          event.summary,
          event.sourceLabel,
          event.sectionName,
          event.operationName,
          event.statusRaw,
          event.requestId,
          event.actionStateId,
          event.actorPrimary,
          event.actorSecondary,
          event.userId,
          event.username,
          event.displayName,
          event.orgId,
          event.orgName,
          event.contextLine,
          event.actionState?.summary,
          event.actionState?.statusRaw,
          event.actionState?.targetKey
        ];
        return tokens.map((token) => cleanText(token, 500)).join(" ").toLowerCase();
      }
      function eventMatchesSearch(event = {}, searchToken = "") {
        const q = cleanText(searchToken, 220).toLowerCase();
        if (!q) return true;
        return buildEventSearchText(event).includes(q);
      }
      function eventMatchesStatus(event = {}, statusFilter = "") {
        const filter = normalizeStatus(statusFilter);
        if (!filter) return true;
        const eventStatus = normalizeStatus(event.statusNormalized || event.statusRaw);
        if (!eventStatus) return false;
        return eventStatus === filter || eventStatus.includes(filter);
      }
      function eventMatchesSource(event = {}, sourceFilter = "") {
        const source = normalizeSource(sourceFilter);
        if (!source) return true;
        if (source === "log") return true;
        if (source === "action_state") return Boolean(event.hasActionState);
        return true;
      }
      function buildActionIndexes(actions = []) {
        const requestMap = /* @__PURE__ */ new Map();
        const keyMap = /* @__PURE__ */ new Map();
        const idMap = /* @__PURE__ */ new Map();
        (Array.isArray(actions) ? actions : []).forEach((action) => {
          const recordId = cleanText(action.recordId, 180);
          if (recordId) {
            idMap.set(recordId, action);
          }
          const requestId = cleanText(action.requestId, 120);
          if (requestId) {
            if (!requestMap.has(requestId)) requestMap.set(requestId, []);
            requestMap.get(requestId).push(action);
          }
          const key = [
            toPublicId(action.userId) || cleanText(action.userId, 120),
            toPublicId(action.sectionId) || cleanText(action.sectionId, 120),
            toPublicId(action.operationId) || cleanText(action.operationId, 120)
          ].join("::");
          if (!keyMap.has(key)) keyMap.set(key, []);
          keyMap.get(key).push(action);
        });
        return { requestMap, keyMap, idMap };
      }
      function resolveNearestByTimestamp(rows = [], targetMs = 0, maxDeltaMs = Number.POSITIVE_INFINITY) {
        if (!Array.isArray(rows) || !rows.length) return null;
        let winner = null;
        let winnerDelta = Number.POSITIVE_INFINITY;
        rows.forEach((row) => {
          const delta = Math.abs(Number(row?.occurredAtMs || 0) - Number(targetMs || 0));
          if (delta > maxDeltaMs) return;
          if (delta < winnerDelta) {
            winner = row;
            winnerDelta = delta;
            return;
          }
          if (delta === winnerDelta && winner) {
            const winnerStatus = normalizeStatus(winner.statusRaw);
            const candidateStatus = normalizeStatus(row.statusRaw);
            if (winnerStatus !== "completed" && candidateStatus === "completed") {
              winner = row;
              winnerDelta = delta;
            }
          }
        });
        return winner;
      }
      function correlateLogWithAction(logEvent = {}, actionIndexes = {}) {
        if (!logEvent || typeof logEvent !== "object") return null;
        const actionStateId = cleanText(logEvent.actionStateId, 180);
        if (actionStateId) {
          const matchedById = actionIndexes.idMap?.get(actionStateId) || null;
          if (matchedById) return matchedById;
        }
        const requestId = cleanText(logEvent.requestId, 120);
        if (requestId) {
          const reqRows = actionIndexes.requestMap?.get(requestId) || [];
          const matchedByRequest = resolveNearestByTimestamp(reqRows, logEvent.occurredAtMs, REQUEST_MATCH_WINDOW_MS);
          if (matchedByRequest) return matchedByRequest;
        }
        const key = [
          toPublicId(logEvent.userId) || cleanText(logEvent.userId, 120),
          toPublicId(logEvent.sectionId) || cleanText(logEvent.sectionId, 120),
          toPublicId(logEvent.operationId) || cleanText(logEvent.operationId, 120)
        ].join("::");
        const fallbackRows = actionIndexes.keyMap?.get(key) || [];
        return resolveNearestByTimestamp(fallbackRows, logEvent.occurredAtMs, FALLBACK_MATCH_WINDOW_MS);
      }
      function pickActionSummaryForEvent(action = null) {
        if (!action || typeof action !== "object") return null;
        return {
          recordId: action.recordId,
          requestId: action.requestId,
          occurredAt: action.occurredAt,
          occurredAtMs: action.occurredAtMs,
          occurredAtDisplay: action.occurredAtDisplay,
          statusRaw: action.statusRaw,
          statusNormalized: action.statusNormalized,
          targetKey: action.targetKey,
          summary: action.summary,
          method: action.method,
          url: action.url,
          orgId: action.orgId,
          orgName: action.orgName,
          details: action.details
        };
      }
      function attachActionEnrichment(logEvents = [], actionEvents = []) {
        const actionIndexes = buildActionIndexes(actionEvents);
        return (Array.isArray(logEvents) ? logEvents : []).map((event) => {
          const matchedAction = correlateLogWithAction(event, actionIndexes);
          if (!matchedAction) return event;
          return {
            ...event,
            hasActionState: true,
            actionState: pickActionSummaryForEvent(matchedAction)
          };
        });
      }
      function applyEventFilters(events = [], filters = {}) {
        const list = Array.isArray(events) ? events : [];
        const sectionFilterSet = buildIdFilterSet(filters.sectionIds, filters.sectionId, 120);
        const operationFilterSet = buildIdFilterSet(filters.operationIds, filters.operationId, 120);
        const orgFilterSet = buildIdFilterSet(filters.orgIds, filters.orgId, 120);
        const userFilter = toPublicId(filters.userId) || cleanText(filters.userId, 120);
        const statusFilter = cleanText(filters.status, 80);
        const sourceFilter = cleanText(filters.source, 40);
        const startAtMs = Number(filters.startAtMs || Number.NEGATIVE_INFINITY);
        const endAtMs = Number(filters.endAtMs || Number.POSITIVE_INFINITY);
        return list.filter((event) => {
          const eventMs = Number(event?.occurredAtMs || 0);
          if (eventMs < startAtMs || eventMs > endAtMs) return false;
          if (!eventMatchesSource(event, sourceFilter)) return false;
          if (sectionFilterSet.size > 0) {
            const eventSectionId = normalizeIdToken(event.sectionId, 120);
            if (!eventSectionId || !sectionFilterSet.has(eventSectionId)) return false;
          }
          if (operationFilterSet.size > 0) {
            const eventOperationId = normalizeIdToken(event.operationId, 120);
            if (!eventOperationId || !operationFilterSet.has(eventOperationId)) return false;
          }
          if (orgFilterSet.size > 0) {
            const eventOrgId = normalizeIdToken(event.orgId, 120);
            if (!eventOrgId || !orgFilterSet.has(eventOrgId)) return false;
          }
          if (userFilter && (toPublicId(event.userId) || cleanText(event.userId, 120)) !== userFilter) return false;
          if (!eventMatchesStatus(event, statusFilter)) return false;
          if (!eventMatchesSearch(event, filters.q)) return false;
          return true;
        });
      }
      function buildSummary(events = []) {
        const rows = Array.isArray(events) ? events : [];
        const uniqueUsers = /* @__PURE__ */ new Set();
        const uniqueRequests = /* @__PURE__ */ new Set();
        const summary = rows.reduce((acc, event) => {
          acc.totalEvents += 1;
          acc.logCount += 1;
          if (event.hasActionState) acc.actionStateLinkedCount += 1;
          const status = normalizeStatus(event.statusRaw);
          if (SUCCESS_STATUS_SET.has(status)) acc.successCount += 1;
          else if (FAILURE_STATUS_SET.has(status)) acc.failureCount += 1;
          const userId = cleanText(event.userId, 120).toLowerCase();
          if (userId && userId !== "system") uniqueUsers.add(userId);
          const requestId = cleanText(event.requestId, 120);
          if (requestId) uniqueRequests.add(requestId);
          return acc;
        }, {
          totalEvents: 0,
          logCount: 0,
          actionStateLinkedCount: 0,
          successCount: 0,
          failureCount: 0
        });
        summary.uniqueUserCount = uniqueUsers.size;
        summary.uniqueRequestCount = uniqueRequests.size;
        return summary;
      }
      function buildPagination(totalItems = 0, page = 1, limit = DEFAULT_PAGE_SIZE) {
        const safeTotal = Math.max(0, Number(totalItems) || 0);
        const safeLimit = clamp(Number(limit) || DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE);
        const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
        const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
        const startItem = safeTotal > 0 ? (currentPage - 1) * safeLimit + 1 : 0;
        const endItem = safeTotal > 0 ? Math.min(currentPage * safeLimit, safeTotal) : 0;
        return {
          currentPage,
          totalPages,
          totalItems: safeTotal,
          limit: safeLimit,
          startItem,
          endItem
        };
      }
      function toEventRow(event = {}) {
        return {
          eventId: event.id,
          occurredAt: event.occurredAt,
          occurredAtDisplay: event.occurredAtDisplay,
          requestId: event.requestId,
          actionStateId: event.actionStateId,
          statusRaw: event.statusRaw,
          statusNormalized: event.statusNormalized,
          summary: event.summary,
          sectionId: event.sectionId,
          sectionName: event.sectionName,
          operationId: event.operationId,
          operationName: event.operationName,
          userId: event.userId,
          username: event.username,
          displayName: event.displayName,
          actorPrimary: event.actorPrimary,
          actorSecondary: event.actorSecondary,
          orgId: event.orgId,
          orgName: event.orgName,
          source: event.source,
          sourceLabel: event.sourceLabel,
          hasActionState: Boolean(event.hasActionState),
          actionStateStatus: cleanText(event.actionState?.statusRaw, 80),
          recordId: event.recordId,
          contextLine: event.contextLine
        };
      }
      function buildSafeFiltersForResponse(filters = {}) {
        const sectionIds = parseIdList(filters.sectionIds || filters.sectionId, 120, 200);
        const operationIds = parseIdList(filters.operationIds || filters.operationId, 120, 200);
        const orgIds = parseIdList(filters.orgIds || filters.orgId, 120, 200);
        return {
          startAt: filters.startAt,
          endAt: filters.endAt,
          source: filters.source,
          status: filters.status,
          sectionId: sectionIds[0] || "",
          operationId: operationIds[0] || "",
          orgId: orgIds[0] || "",
          sectionIds,
          operationIds,
          orgIds,
          userId: filters.userId,
          q: filters.q,
          zoomLevel: filters.zoomLevel,
          focusStartAt: filters.focusStartAt,
          focusEndAt: filters.focusEndAt,
          page: filters.page,
          limit: filters.limit,
          maxRows: filters.maxRows,
          rangeTrimmed: Boolean(filters.rangeTrimmed)
        };
      }
      function maskSensitiveValue(key = "", value = null) {
        const keyToken = cleanText(key, 120);
        if (SENSITIVE_KEY_PATTERN.test(keyToken)) return "[MASKED]";
        if (typeof value === "string" && value.length > 1200) {
          return `${value.slice(0, 1200)} ...`;
        }
        return value;
      }
      function maskSensitiveObject(value, parentKey = "") {
        if (Array.isArray(value)) return value.map((item) => maskSensitiveObject(item, parentKey));
        if (!value || typeof value !== "object") return maskSensitiveValue(parentKey, value);
        const output = {};
        Object.entries(value).forEach(([key, inner]) => {
          if (SENSITIVE_KEY_PATTERN.test(key)) {
            output[key] = "[MASKED]";
            return;
          }
          output[key] = maskSensitiveObject(inner, key);
        });
        return output;
      }
      function sanitizeCsvCellForSpreadsheet(value) {
        const text = String(value ?? "");
        if (!text) return "";
        const cleaned = text.replace(/\u0000/g, "");
        const leftTrimmed = cleaned.replace(/^\s+/, "");
        if (DANGEROUS_CSV_PREFIX.test(leftTrimmed)) return `	${cleaned}`;
        return cleaned;
      }
      function buildDefaultPageFilters(query = {}, fallbackTimeZone = DEFAULT_ORG_TIMEZONE) {
        const nowMs = Date.now();
        const defaultRange = resolveDefaultRangeMs(nowMs);
        const startToken = cleanText(query.startAt || "", 80);
        const endToken = cleanText(query.endAt || "", 80);
        const fallbackStart = formatMsToDateTimeLocalInput(defaultRange.startAtMs, fallbackTimeZone);
        const fallbackEnd = formatMsToDateTimeLocalInput(defaultRange.endAtMs, fallbackTimeZone);
        const sectionIds = parseIdList(query.sectionIds ?? query.sectionId, 120, 200);
        const operationIds = parseIdList(query.operationIds ?? query.operationId, 120, 200);
        const orgIds = parseIdList(query.orgIds ?? query.orgId, 120, 200);
        return {
          startAt: startToken || fallbackStart,
          endAt: endToken || fallbackEnd,
          source: normalizeSource(query.source),
          status: cleanText(query.status, 80),
          sectionId: sectionIds[0] || "",
          operationId: operationIds[0] || "",
          orgId: orgIds[0] || "",
          sectionIds,
          operationIds,
          orgIds,
          userId: cleanText(query.userId, 120),
          q: cleanText(query.q, 220),
          zoomLevel: normalizeZoomLevel(query.zoomLevel),
          focusStartAt: cleanText(query.focusStartAt, 80),
          focusEndAt: cleanText(query.focusEndAt, 80),
          page: parsePositiveInteger(query.page, 1) || 1,
          limit: clamp(parsePositiveInteger(query.limit, DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE)
        };
      }
      function parseTimelineFilters(rawQuery = {}, timeZone = DEFAULT_ORG_TIMEZONE) {
        const source = normalizeSource(rawQuery.source);
        const zoomLevel = normalizeZoomLevel(rawQuery.zoomLevel);
        const status = cleanText(rawQuery.status, 80);
        const sectionIds = parseIdList(rawQuery.sectionIds ?? rawQuery.sectionId, 120, 200);
        const operationIds = parseIdList(rawQuery.operationIds ?? rawQuery.operationId, 120, 200);
        const orgIds = parseIdList(rawQuery.orgIds ?? rawQuery.orgId, 120, 200);
        const sectionId = sectionIds[0] || "";
        const operationId = operationIds[0] || "";
        const orgId = orgIds[0] || "";
        const userId = cleanText(rawQuery.userId, 120);
        const q = cleanText(rawQuery.q, 220);
        const maxRows = clamp(parsePositiveInteger(rawQuery.maxRows, DEFAULT_MERGE_LIMIT) || DEFAULT_MERGE_LIMIT, MIN_MERGE_LIMIT, MAX_MERGE_LIMIT);
        const page = parsePositiveInteger(rawQuery.page, 1) || 1;
        const limit = clamp(parsePositiveInteger(rawQuery.limit, DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE, MAX_PAGE_SIZE);
        const explicitStartAtMs = Number(rawQuery.startAtMs);
        const explicitEndAtMs = Number(rawQuery.endAtMs);
        const hasExplicitStartAtMs = Number.isFinite(explicitStartAtMs);
        const hasExplicitEndAtMs = Number.isFinite(explicitEndAtMs);
        const defaults = resolveDefaultRangeMs(Date.now());
        const parsedStartMs = hasExplicitStartAtMs ? explicitStartAtMs : parseDateTimeInputToMs(rawQuery.startAt, timeZone);
        const parsedEndMs = hasExplicitEndAtMs ? explicitEndAtMs : parseDateTimeInputToMs(rawQuery.endAt, timeZone);
        const legacyStartMs = Number.isNaN(parsedStartMs) ? parseDateTimeInputToMs(rawQuery.startDate, timeZone, { endOfDay: false }) : parsedStartMs;
        const legacyEndMs = Number.isNaN(parsedEndMs) ? parseDateTimeInputToMs(rawQuery.endDate, timeZone, { endOfDay: true }) : parsedEndMs;
        let startAtMs = Number.isNaN(legacyStartMs) ? defaults.startAtMs : legacyStartMs;
        let endAtMs = Number.isNaN(legacyEndMs) ? defaults.endAtMs : legacyEndMs;
        if (startAtMs > endAtMs) {
          const tmp = startAtMs;
          startAtMs = endAtMs;
          endAtMs = tmp;
        }
        let rangeTrimmed = false;
        if (endAtMs - startAtMs > MAX_RANGE_MS) {
          endAtMs = startAtMs + MAX_RANGE_MS - 1;
          rangeTrimmed = true;
        }
        let focusStartAtMs = parseDateTimeInputToMs(rawQuery.focusStartAt, timeZone);
        let focusEndAtMs = parseDateTimeInputToMs(rawQuery.focusEndAt, timeZone);
        if (Number.isNaN(focusStartAtMs)) focusStartAtMs = startAtMs;
        if (Number.isNaN(focusEndAtMs)) focusEndAtMs = endAtMs;
        if (focusStartAtMs > focusEndAtMs) {
          const tmp = focusStartAtMs;
          focusStartAtMs = focusEndAtMs;
          focusEndAtMs = tmp;
        }
        focusStartAtMs = Math.max(startAtMs, focusStartAtMs);
        focusEndAtMs = Math.min(endAtMs, focusEndAtMs);
        return {
          source,
          zoomLevel,
          status,
          sectionId,
          operationId,
          orgId,
          sectionIds,
          operationIds,
          orgIds,
          userId,
          q,
          maxRows,
          page,
          limit,
          startAtMs,
          endAtMs,
          startAt: new Date(startAtMs).toISOString(),
          endAt: new Date(endAtMs).toISOString(),
          focusStartAtMs,
          focusEndAtMs,
          focusStartAt: new Date(focusStartAtMs).toISOString(),
          focusEndAt: new Date(focusEndAtMs).toISOString(),
          rangeTrimmed
        };
      }
      function buildDateTokensForQuery(startAtMs, endAtMs, timeZone = DEFAULT_ORG_TIMEZONE) {
        const shiftDateKey = (dateKey = "", deltaDays = 0) => {
          const token = cleanText(dateKey, 20);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return "";
          const base = /* @__PURE__ */ new Date(`${token}T00:00:00.000Z`);
          if (Number.isNaN(base.getTime())) return "";
          base.setUTCDate(base.getUTCDate() + Number(deltaDays || 0));
          const yyyy = String(base.getUTCFullYear()).padStart(4, "0");
          const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
          const dd = String(base.getUTCDate()).padStart(2, "0");
          return `${yyyy}-${mm}-${dd}`;
        };
        const exactStartDate = toDateKeyInTimezone(startAtMs, timeZone);
        const exactEndDate = toDateKeyInTimezone(endAtMs, timeZone);
        return {
          exactStartDate,
          exactEndDate,
          startDate: shiftDateKey(exactStartDate, -1) || exactStartDate,
          endDate: shiftDateKey(exactEndDate, 1) || exactEndDate
        };
      }
      function buildDayWindows(rangeStartMs, rangeEndMs, timezone = DEFAULT_ORG_TIMEZONE) {
        const windows = [];
        const startMs = Number(rangeStartMs || 0);
        const endMs = Number(rangeEndMs || 0);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return windows;
        let bounds = getDayBoundsMs(startMs, timezone);
        if (!bounds?.dateKey || !Number.isFinite(bounds.dayStartMs)) return windows;
        while (bounds.dayStartMs <= endMs && windows.length < MAX_RANGE_DAYS) {
          windows.push({
            dateKey: bounds.dateKey,
            dayStartMs: Math.max(bounds.dayStartMs, startMs),
            dayEndMs: Math.min(bounds.dayEndMs, endMs)
          });
          const nextMs = bounds.dayEndMs + 1;
          if (!Number.isFinite(nextMs)) break;
          const previousStartMs = bounds.dayStartMs;
          bounds = getDayBoundsMs(nextMs, timezone);
          if (!bounds?.dateKey || !Number.isFinite(bounds.dayStartMs)) break;
          if (bounds.dayStartMs <= previousStartMs) break;
        }
        return windows;
      }
      function resolveDayWindowsForRange(startMs, endMs, timezone = DEFAULT_ORG_TIMEZONE) {
        let dayWindows = buildDayWindows(startMs, endMs, timezone);
        if (!dayWindows.length) {
          const fallbackBounds = getDayBoundsMs(endMs, timezone);
          if (fallbackBounds?.dateKey && Number.isFinite(fallbackBounds.dayStartMs)) {
            dayWindows = [{
              dateKey: fallbackBounds.dateKey,
              dayStartMs: fallbackBounds.dayStartMs,
              dayEndMs: fallbackBounds.dayEndMs
            }];
          }
        }
        return dayWindows;
      }
      function buildEventsFromSourceRecords({
        logs = [],
        actionStates = [],
        rawQuery = {},
        filters: presetFilters = null,
        timezone = DEFAULT_ORG_TIMEZONE,
        lookups = { sections: [], operations: [], organizations: [] },
        userRows = []
      }) {
        const filters = presetFilters || parseTimelineFilters(rawQuery, timezone);
        const lookupMaps = {
          sectionMap: buildLookupMap(lookups.sections),
          operationMap: buildLookupMap(lookups.operations),
          orgMap: buildLookupMap(lookups.organizations),
          userMap: buildLookupMap(userRows)
        };
        const actionEvents = (Array.isArray(actionStates) ? actionStates : []).map((row) => buildActionStateProjection(row, lookupMaps, timezone));
        const logEvents = (Array.isArray(logs) ? logs : []).map((row) => buildLogEvent(row, lookupMaps, timezone));
        const enrichedEvents = attachActionEnrichment(logEvents, actionEvents);
        const filteredEvents = applyEventFilters(enrichedEvents, filters).sort((a, b) => Number(b.occurredAtMs || 0) - Number(a.occurredAtMs || 0));
        return {
          filters,
          timezone,
          events: filteredEvents,
          summary: buildSummary(filteredEvents)
        };
      }
      module.exports = {
        DEFAULT_LOOKBACK_DAYS,
        DEFAULT_MERGE_LIMIT,
        DEFAULT_PAGE_SIZE,
        MAX_PAGE_SIZE,
        MIN_PAGE_SIZE,
        MAX_MERGE_LIMIT,
        MIN_MERGE_LIMIT,
        MAX_RANGE_DAYS,
        DEFAULT_ORG_TIMEZONE,
        parseTimelineFilters,
        buildDefaultPageFilters,
        buildEventsFromSourceRecords,
        buildSummary,
        applyEventFilters,
        sanitizeCsvCellForSpreadsheet,
        toEventRow,
        buildPagination,
        buildLogEvent,
        buildActionStateProjection,
        attachActionEnrichment,
        buildLookupMap,
        buildSafeFiltersForResponse,
        cleanText,
        clamp,
        resolveLogTimestamp,
        resolveSectionInfo,
        resolveOperationInfo,
        buildDateTokensForQuery,
        resolveDayWindowsForRange,
        maskSensitiveObject,
        maskSensitiveValue
      };
    }
  });

  // MVC/services/security/trackActivityHourlyTimeline.js
  var require_trackActivityHourlyTimeline = __commonJS({
    "MVC/services/security/trackActivityHourlyTimeline.js"(exports, module) {
      "use strict";
      var trackActivityCore = require_trackActivityCore();
      var {
        getDateTimePartsInTimezone,
        getDayBoundsMs
      } = require_timezoneUtils();
      var {
        cleanText,
        clamp,
        buildLookupMap,
        parseTimelineFilters,
        buildSafeFiltersForResponse,
        resolveLogTimestamp,
        resolveSectionInfo,
        resolveOperationInfo,
        buildDateTokensForQuery,
        resolveDayWindowsForRange,
        MAX_RANGE_DAYS,
        DEFAULT_ORG_TIMEZONE
      } = trackActivityCore;
      function normalizeTimezoneToken(value, fallback = DEFAULT_ORG_TIMEZONE) {
        const token = cleanText(value, 80) || fallback;
        try {
          Intl.DateTimeFormat("en-US", { timeZone: token });
          return token;
        } catch (_) {
          return fallback;
        }
      }
      function formatDateTimeInTimezone(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
        const date = new Date(Number(ms || 0));
        if (Number.isNaN(date.getTime())) return "-";
        try {
          return new Intl.DateTimeFormat("en-US", {
            timeZone: normalizeTimezoneToken(timeZone, DEFAULT_ORG_TIMEZONE),
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
          }).format(date);
        } catch (_) {
          return date.toISOString();
        }
      }
      function formatDateInTimezone(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
        const date = new Date(Number(ms || 0));
        if (Number.isNaN(date.getTime())) return "-";
        try {
          return new Intl.DateTimeFormat("en-US", {
            timeZone: normalizeTimezoneToken(timeZone, DEFAULT_ORG_TIMEZONE),
            year: "numeric",
            month: "short",
            day: "2-digit"
          }).format(date);
        } catch (_) {
          return date.toISOString().slice(0, 10);
        }
      }
      function toDateKeyInTimezone(ms, timeZone = DEFAULT_ORG_TIMEZONE) {
        const parts = getDateTimePartsInTimezone(ms, timeZone);
        if (!parts) return "";
        const yyyy = String(parts.year || 0).padStart(4, "0");
        const mm = String(parts.month || 0).padStart(2, "0");
        const dd = String(parts.day || 0).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
      function mapRangeMeta(filters = {}, timezone = DEFAULT_ORG_TIMEZONE) {
        return {
          startAt: filters.startAt,
          endAt: filters.endAt,
          startAtMs: filters.startAtMs,
          endAtMs: filters.endAtMs,
          focusStartAt: filters.focusStartAt,
          focusEndAt: filters.focusEndAt,
          focusStartAtMs: filters.focusStartAtMs,
          focusEndAtMs: filters.focusEndAtMs,
          timezone,
          rangeTrimmed: Boolean(filters.rangeTrimmed),
          maxRangeDays: MAX_RANGE_DAYS
        };
      }
      function toHourLabel(hour) {
        const safe = clamp(Number(hour) || 0, 0, 23);
        const token = String(safe).padStart(2, "0");
        return `${token}:00 - ${token}:59`;
      }
      function toHourIsoWindow(dayStartMs, hourOffsetMs) {
        const startMs = Number(dayStartMs || 0) + Number(hourOffsetMs || 0);
        const endMs = startMs + 60 * 60 * 1e3 - 1;
        return {
          startAtMs: startMs,
          endAtMs: endMs,
          startAt: new Date(startMs).toISOString(),
          endAt: new Date(endMs).toISOString()
        };
      }
      function normalizeTrackTimelineZoomLevel(value) {
        const token = cleanText(value, 20).toLowerCase();
        if (token === "5m") return "5m";
        if (token === "15s") return "15s";
        return "hourly";
      }
      function normalizeHourIndex(value) {
        const parsed = Number.parseInt(String(value ?? ""), 10);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) return -1;
        return parsed;
      }
      function normalizeFiveMinuteIndex(value) {
        const parsed = Number.parseInt(String(value ?? ""), 10);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 11) return -1;
        return parsed;
      }
      function resolveTimelineDayKey(ms, timezone = DEFAULT_ORG_TIMEZONE) {
        return toDateKeyInTimezone(ms, timezone);
      }
      function resolveTimelineTimeParts(ms, timezone = DEFAULT_ORG_TIMEZONE) {
        const parts = getDateTimePartsInTimezone(ms, timezone);
        if (!parts) return null;
        return {
          hour: parts.hour,
          minute: parts.minute,
          second: parts.second
        };
      }
      function toFiveMinuteLabel(hour, fiveMinuteIndex) {
        const safeHour = clamp(Number(hour) || 0, 0, 23);
        const safeFive = clamp(Number(fiveMinuteIndex) || 0, 0, 11);
        const startMinute = safeFive * 5;
        const endMinute = startMinute + 4;
        return `${String(safeHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")} - ${String(safeHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
      }
      function toFifteenSecondLabel(hour, fiveMinuteIndex, secondChunkIndex) {
        const safeHour = clamp(Number(hour) || 0, 0, 23);
        const safeFive = clamp(Number(fiveMinuteIndex) || 0, 0, 11);
        const safeChunk = clamp(Number(secondChunkIndex) || 0, 0, 19);
        const minuteBase = safeFive * 5;
        const startTotalSeconds = safeChunk * 15;
        const endTotalSeconds = startTotalSeconds + 14;
        const startMinuteOffset = Math.floor(startTotalSeconds / 60);
        const endMinuteOffset = Math.floor(endTotalSeconds / 60);
        const startSecond = startTotalSeconds % 60;
        const endSecond = endTotalSeconds % 60;
        const startMinute = minuteBase + startMinuteOffset;
        const endMinute = minuteBase + endMinuteOffset;
        return `${String(safeHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")}:${String(startSecond).padStart(2, "0")} - ${String(safeHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}:${String(endSecond).padStart(2, "0")}`;
      }
      function buildEmptyMetricSlots(length = 0) {
        return Array.from({ length: Math.max(0, Number(length) || 0) }, () => ({
          requestCount: 0,
          attemptCount: 0
        }));
      }
      function applyColorWeights(chunks = []) {
        const busiest = (Array.isArray(chunks) ? chunks : []).reduce((max, row) => Math.max(max, Number(row?.requestCount || 0)), 0);
        (Array.isArray(chunks) ? chunks : []).forEach((row) => {
          const ratio = busiest > 0 ? Number(row.requestCount || 0) / busiest : 0;
          row.colorWeight = Number(ratio.toFixed(3));
        });
        return busiest;
      }
      function isAttemptLikeLog(log = {}, sectionName = "", operationName = "") {
        const sectionToken = cleanText(sectionName || log?.sectionId, 140).toLowerCase();
        const operationToken = cleanText(operationName || log?.operationId, 140).toLowerCase();
        const details = log && typeof log.details === "object" ? log.details : {};
        const urlToken = cleanText(details.url || details.targetUrl || details.path, 260).toLowerCase();
        if (sectionToken.includes("attempt") || operationToken.includes("attempt")) return true;
        if (urlToken.includes("/attempt")) return true;
        if (urlToken.includes("/practice/start") || urlToken.includes("/practice/attempt")) return true;
        return false;
      }
      function logMatchesTimelineFilters(log, filters, sectionIds, operationIds, orgIds) {
        const timestampToken = resolveLogTimestamp(log);
        if (!timestampToken) return false;
        const occurredAtMs = new Date(timestampToken).getTime();
        if (!Number.isFinite(occurredAtMs)) return false;
        if (occurredAtMs < filters.startAtMs || occurredAtMs > filters.endAtMs) return false;
        if (filters.userId) {
          const details = log && typeof log.details === "object" ? log.details : {};
          const actor = details.actor && typeof details.actor === "object" ? details.actor : {};
          const userToken = cleanText(log?.userId || actor.userId, 120);
          if (userToken !== filters.userId) return false;
        }
        if (sectionIds.length) {
          const sid = cleanText(log?.sectionId, 120);
          if (!sectionIds.includes(sid)) return false;
        }
        if (operationIds.length) {
          const oid = cleanText(log?.operationId, 120);
          if (!operationIds.includes(oid)) return false;
        }
        if (orgIds.length) {
          const oid = cleanText(log?.orgId, 120);
          if (!orgIds.includes(oid)) return false;
        }
        if (filters.status) {
          const statusToken = cleanText(log?.status, 80).toLowerCase();
          if (!statusToken.includes(String(filters.status).toLowerCase())) return false;
        }
        if (filters.q) {
          const q = String(filters.q).toLowerCase();
          const blob = [
            log?.summary,
            log?.userId,
            log?.sectionId,
            log?.operationId,
            JSON.stringify(log?.details || {})
          ].join(" ").toLowerCase();
          if (!blob.includes(q)) return false;
        }
        return true;
      }
      function filterLogsForHourlyTimeline(logs, filters, sectionIds, operationIds, orgIds) {
        return (Array.isArray(logs) ? logs : []).filter((log) => logMatchesTimelineFilters(
          log,
          filters,
          sectionIds,
          operationIds,
          orgIds
        ));
      }
      function buildHourlyTimelineFromLogs({
        logs = [],
        rawQuery = {},
        timezone = DEFAULT_ORG_TIMEZONE,
        lookups = { sections: [], operations: [] },
        presetFilters = null
      } = {}) {
        const filters = presetFilters || parseTimelineFilters(rawQuery, timezone);
        const requestedZoomLevel = normalizeTrackTimelineZoomLevel(rawQuery?.zoomLevel);
        const focusDay = cleanText(rawQuery?.focusDay, 20);
        const focusHour = normalizeHourIndex(rawQuery?.focusHour);
        const focusFiveMinute = normalizeFiveMinuteIndex(rawQuery?.focusFiveMinute);
        const dayWindows = resolveDayWindowsForRange(filters.startAtMs, filters.endAtMs, timezone);
        const sectionIds = (Array.isArray(filters.sectionIds) ? filters.sectionIds : []).map((id) => cleanText(id, 120)).filter(Boolean);
        const operationIds = (Array.isArray(filters.operationIds) ? filters.operationIds : []).map((id) => cleanText(id, 120)).filter(Boolean);
        const orgIds = (Array.isArray(filters.orgIds) ? filters.orgIds : []).map((id) => cleanText(id, 120)).filter(Boolean);
        const filteredLogs = filterLogsForHourlyTimeline(logs, filters, sectionIds, operationIds, orgIds);
        const dayWindowMap = /* @__PURE__ */ new Map();
        const dayHourCounters = /* @__PURE__ */ new Map();
        dayWindows.forEach((window) => {
          const key = cleanText(window?.dateKey, 20);
          if (!key) return;
          dayWindowMap.set(key, window);
          dayHourCounters.set(key, buildEmptyMetricSlots(24));
        });
        const sectionMap = buildLookupMap(lookups.sections);
        const operationMap = buildLookupMap(lookups.operations);
        const fiveMinuteCounters = /* @__PURE__ */ new Map();
        const fifteenSecondCounters = /* @__PURE__ */ new Map();
        const ensureFiveMinuteSlots = (key) => {
          if (!fiveMinuteCounters.has(key)) fiveMinuteCounters.set(key, buildEmptyMetricSlots(12));
          return fiveMinuteCounters.get(key);
        };
        const ensureFifteenSecondSlots = (key) => {
          if (!fifteenSecondCounters.has(key)) fifteenSecondCounters.set(key, buildEmptyMetricSlots(20));
          return fifteenSecondCounters.get(key);
        };
        filteredLogs.forEach((log) => {
          const timestampToken = resolveLogTimestamp(log);
          if (!timestampToken) return;
          const occurredAtMs = new Date(timestampToken).getTime();
          if (!Number.isFinite(occurredAtMs)) return;
          if (occurredAtMs < filters.startAtMs || occurredAtMs > filters.endAtMs) return;
          const dayKey = resolveTimelineDayKey(occurredAtMs, timezone);
          const daySlots = dayHourCounters.get(dayKey);
          if (!Array.isArray(daySlots)) return;
          const hourParts = resolveTimelineTimeParts(occurredAtMs, timezone);
          const hour = clamp(Number(hourParts?.hour || 0), 0, 23);
          const minute = clamp(Number(hourParts?.minute || 0), 0, 59);
          const second = clamp(Number(hourParts?.second || 0), 0, 59);
          const slot = daySlots[hour];
          if (!slot) return;
          const sectionInfo = resolveSectionInfo(log.sectionId, sectionMap);
          const operationInfo = resolveOperationInfo(log.operationId, operationMap);
          slot.requestCount += 1;
          const fiveMinuteIndex = clamp(Math.floor(minute / 5), 0, 11);
          const fiveMinuteKey = `${dayKey}|${hour}`;
          const fiveSlots = ensureFiveMinuteSlots(fiveMinuteKey);
          fiveSlots[fiveMinuteIndex].requestCount += 1;
          const secondOffset = minute % 5 * 60 + second;
          const fifteenSecondIndex = clamp(Math.floor(secondOffset / 15), 0, 19);
          const fifteenSecondKey = `${dayKey}|${hour}|${fiveMinuteIndex}`;
          const fifteenSlots = ensureFifteenSecondSlots(fifteenSecondKey);
          fifteenSlots[fifteenSecondIndex].requestCount += 1;
          if (isAttemptLikeLog(log, sectionInfo?.name, operationInfo?.name)) {
            slot.attemptCount += 1;
            fiveSlots[fiveMinuteIndex].attemptCount += 1;
            fifteenSlots[fifteenSecondIndex].attemptCount += 1;
          }
        });
        const dayTimelines = dayWindows.map((window) => {
          const key = cleanText(window?.dateKey, 20);
          const dayStartMs = Number(window?.dayStartMs || 0);
          const dayEndMs = Number(window?.dayEndMs || dayStartMs + 24 * 60 * 60 * 1e3 - 1);
          const daySlots = dayHourCounters.get(key) || buildEmptyMetricSlots(24);
          const chunks = Array.from({ length: 24 }, (_, hour) => {
            const slot = daySlots[hour] || { requestCount: 0, attemptCount: 0 };
            const hourWindow = toHourIsoWindow(dayStartMs, hour * 60 * 60 * 1e3);
            return {
              hour,
              label: toHourLabel(hour),
              requestCount: Number(slot.requestCount || 0),
              attemptCount: Number(slot.attemptCount || 0),
              ...hourWindow,
              colorWeight: 0
            };
          });
          const busiest = applyColorWeights(chunks);
          const totalRequests2 = chunks.reduce((sum, chunk) => sum + Number(chunk.requestCount || 0), 0);
          const totalAttempts2 = chunks.reduce((sum, chunk) => sum + Number(chunk.attemptCount || 0), 0);
          return {
            dateKey: key,
            label: formatDateInTimezone(dayStartMs, timezone),
            startAt: new Date(dayStartMs).toISOString(),
            endAt: new Date(dayEndMs).toISOString(),
            startAtDisplay: formatDateTimeInTimezone(dayStartMs, timezone),
            endAtDisplay: formatDateTimeInTimezone(dayEndMs, timezone),
            totalRequests: totalRequests2,
            totalAttempts: totalAttempts2,
            busiestChunkRequests: busiest,
            chunks
          };
        });
        const totalRequests = dayTimelines.reduce((sum, day) => sum + Number(day.totalRequests || 0), 0);
        const totalAttempts = dayTimelines.reduce((sum, day) => sum + Number(day.totalAttempts || 0), 0);
        const globalBusiestHour = dayTimelines.reduce((max, day) => Math.max(max, Number(day.busiestChunkRequests || 0)), 0);
        let zoomLevel = requestedZoomLevel;
        let focusTimeline = null;
        if (requestedZoomLevel === "5m") {
          const focusWindow = dayWindowMap.get(focusDay);
          if (focusWindow && focusHour >= 0) {
            const fiveKey = `${focusDay}|${focusHour}`;
            const fiveSlots = fiveMinuteCounters.get(fiveKey) || buildEmptyMetricSlots(12);
            const hourWindow = toHourIsoWindow(focusWindow.dayStartMs, focusHour * 60 * 60 * 1e3);
            const chunks = Array.from({ length: 12 }, (_, index) => {
              const startMs = Number(hourWindow.startAtMs) + index * 5 * 60 * 1e3;
              const endMs = startMs + 5 * 60 * 1e3 - 1;
              const slot = fiveSlots[index] || { requestCount: 0, attemptCount: 0 };
              return {
                index,
                label: toFiveMinuteLabel(focusHour, index),
                requestCount: Number(slot.requestCount || 0),
                attemptCount: Number(slot.attemptCount || 0),
                startAtMs: startMs,
                endAtMs: endMs,
                startAt: new Date(startMs).toISOString(),
                endAt: new Date(endMs).toISOString(),
                startAtDisplay: formatDateTimeInTimezone(startMs, timezone),
                endAtDisplay: formatDateTimeInTimezone(endMs, timezone),
                colorWeight: 0
              };
            });
            applyColorWeights(chunks);
            focusTimeline = {
              zoomLevel: "5m",
              dateKey: focusDay,
              hour: focusHour,
              title: `${formatDateInTimezone(focusWindow.dayStartMs, timezone)} \u2022 ${toHourLabel(focusHour)}`,
              subtitle: "5-minute chunks",
              chunks
            };
          } else {
            zoomLevel = "hourly";
          }
        } else if (requestedZoomLevel === "15s") {
          const focusWindow = dayWindowMap.get(focusDay);
          if (focusWindow && focusHour >= 0 && focusFiveMinute >= 0) {
            const fifteenKey = `${focusDay}|${focusHour}|${focusFiveMinute}`;
            const fifteenSlots = fifteenSecondCounters.get(fifteenKey) || buildEmptyMetricSlots(20);
            const hourWindow = toHourIsoWindow(focusWindow.dayStartMs, focusHour * 60 * 60 * 1e3);
            const focusFiveStartMs = Number(hourWindow.startAtMs) + focusFiveMinute * 5 * 60 * 1e3;
            const chunks = Array.from({ length: 20 }, (_, index) => {
              const startMs = focusFiveStartMs + index * 15 * 1e3;
              const endMs = startMs + 15 * 1e3 - 1;
              const slot = fifteenSlots[index] || { requestCount: 0, attemptCount: 0 };
              return {
                index,
                label: toFifteenSecondLabel(focusHour, focusFiveMinute, index),
                requestCount: Number(slot.requestCount || 0),
                attemptCount: Number(slot.attemptCount || 0),
                startAtMs: startMs,
                endAtMs: endMs,
                startAt: new Date(startMs).toISOString(),
                endAt: new Date(endMs).toISOString(),
                startAtDisplay: formatDateTimeInTimezone(startMs, timezone),
                endAtDisplay: formatDateTimeInTimezone(endMs, timezone),
                colorWeight: 0
              };
            });
            applyColorWeights(chunks);
            focusTimeline = {
              zoomLevel: "15s",
              dateKey: focusDay,
              hour: focusHour,
              fiveMinute: focusFiveMinute,
              title: `${formatDateInTimezone(focusWindow.dayStartMs, timezone)} \u2022 ${toFiveMinuteLabel(focusHour, focusFiveMinute)}`,
              subtitle: "15-second chunks",
              chunks
            };
          } else {
            zoomLevel = "hourly";
          }
        }
        return {
          timezone,
          filters: buildSafeFiltersForResponse(filters),
          range: mapRangeMeta(filters, timezone),
          zoomLevel,
          focus: {
            day: focusDay,
            hour: focusHour,
            fiveMinute: focusFiveMinute
          },
          summary: {
            totalRequests,
            totalAttempts,
            busiestChunkRequests: globalBusiestHour,
            daysCount: dayTimelines.length
          },
          dayTimelines,
          focusTimeline
        };
      }
      module.exports = {
        buildHourlyTimelineFromLogs,
        filterLogsForHourlyTimeline,
        logMatchesTimelineFilters
      };
    }
  });

  // MVC/services/security/trackActivityCore.browserEntry.js
  var require_trackActivityCore_browserEntry = __commonJS({
    "MVC/services/security/trackActivityCore.browserEntry.js"(exports, module) {
      var core = require_trackActivityCore();
      var hourly = require_trackActivityHourlyTimeline();
      module.exports = {
        parseTimelineFilters: core.parseTimelineFilters,
        buildEventsFromSourceRecords: core.buildEventsFromSourceRecords,
        buildLookupMap: core.buildLookupMap,
        cleanText: core.cleanText,
        applyEventFilters: core.applyEventFilters,
        maskSensitiveObject: core.maskSensitiveObject,
        buildSafeFiltersForResponse: core.buildSafeFiltersForResponse,
        clamp: core.clamp,
        buildHourlyTimelineFromLogs: hourly.buildHourlyTimelineFromLogs,
        buildSummary: core.buildSummary,
        MAX_RANGE_DAYS: core.MAX_RANGE_DAYS
      };
    }
  });
  return require_trackActivityCore_browserEntry();
})();

}));
