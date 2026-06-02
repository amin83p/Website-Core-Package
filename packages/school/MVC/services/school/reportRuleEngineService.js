const MAX_EXPRESSION_LENGTH = 240;
const MAX_CALCULATION_EXPRESSION_LENGTH = 0; // 0 = no explicit length cap
const VALID_SEVERITIES = new Set(['error', 'warning']);
const VALID_WHEN_VALUES = new Set(['always', 'if_has_value']);
const VALID_CONVERSION_ON_ERROR = new Set(['use_raw', 'empty']);
const VALID_VALUE_MODES = new Set(['manual', 'calculated']);
const VALID_CALC_ON_ERROR = new Set(['keep_last', 'empty']);

function isVisualOnlyField(field) {
  const type = String(field?.type || '').trim().toLowerCase();
  return type === 'section' || type === 'subheader' || type === 'row_break';
}

function hasValue(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function normalizeValueMode(rawMode) {
  const token = String(rawMode || 'manual').trim().toLowerCase();
  return VALID_VALUE_MODES.has(token) ? token : 'manual';
}

function normalizeCalculationDependencies(rawList) {
  const list = Array.isArray(rawList)
    ? rawList
    : String(rawList || '')
      .split(',')
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  const out = [];
  const seen = new Set();
  list.forEach((item) => {
    const id = String(item || '').trim();
    if (!id) return;
    const key = id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(id);
  });
  return out;
}

function normalizeCalculationRule(rawRule) {
  const rule = rawRule && typeof rawRule === 'object' ? rawRule : {};
  const enabled = rule.enabled === true || String(rule.enabled || '').trim().toLowerCase() === 'true';
  const expression = ensureExpressionText(rule.expression, {
    allowEmpty: true,
    maxLength: MAX_CALCULATION_EXPRESSION_LENGTH
  });
  const onErrorRaw = String(rule.onError || 'keep_last').trim().toLowerCase();
  const onError = VALID_CALC_ON_ERROR.has(onErrorRaw) ? onErrorRaw : 'keep_last';
  return { enabled, expression, onError };
}

function isCalculatedField(field) {
  if (isVisualOnlyField(field)) return false;
  return normalizeValueMode(field?.valueMode) === 'calculated';
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function createHelperSet() {
  return Object.freeze({
    num(value, fallback = 0) {
      return toFiniteNumber(value, fallback);
    },
    str(value) {
      if (value === undefined || value === null) return '';
      return String(value);
    },
    len(value) {
      if (Array.isArray(value) || typeof value === 'string') return value.length;
      if (value && typeof value === 'object') return Object.keys(value).length;
      return 0;
    },
    round(value, decimals = 0) {
      const n = toFiniteNumber(value, NaN);
      const d = Math.max(0, Math.min(8, Math.floor(toFiniteNumber(decimals, 0))));
      if (!Number.isFinite(n)) return NaN;
      const factor = 10 ** d;
      return Math.round(n * factor) / factor;
    },
    min(...args) {
      return Math.min(...args.map((v) => toFiniteNumber(v, NaN)));
    },
    max(...args) {
      return Math.max(...args.map((v) => toFiniteNumber(v, NaN)));
    },
    abs(value) {
      return Math.abs(toFiniteNumber(value, NaN));
    },
    clamp(value, minValue, maxValue) {
      const n = toFiniteNumber(value, NaN);
      const min = toFiniteNumber(minValue, NaN);
      const max = toFiniteNumber(maxValue, NaN);
      if (!Number.isFinite(n) || !Number.isFinite(min) || !Number.isFinite(max)) return NaN;
      return Math.min(Math.max(n, min), max);
    },
    ifelse(condition, whenTrue, whenFalse = '') {
      return condition ? whenTrue : whenFalse;
    },
    caseof(value, ...branches) {
      if (branches.length === 0) return value;
      const hasDefault = branches.length % 2 === 1;
      const pairLimit = hasDefault ? branches.length - 1 : branches.length;
      for (let i = 0; i < pairLimit; i += 2) {
        const caseValue = branches[i];
        const caseResult = branches[i + 1];
        if (value == caseValue) return caseResult; // eslint-disable-line eqeqeq
      }
      if (hasDefault) return branches[branches.length - 1];
      return value;
    }
  });
}

const HELPERS = createHelperSet();

function ensureExpressionText(expression, { allowEmpty = false, maxLength = MAX_EXPRESSION_LENGTH } = {}) {
  const text = String(expression || '').trim();
  if (!text && allowEmpty) return '';
  if (!text) throw new Error('Expression is required.');
  if (Number.isFinite(maxLength) && maxLength > 0 && text.length > maxLength) {
    throw new Error(`Expression is too long. Max ${maxLength} chars.`);
  }
  return text;
}

function tokenize(expression) {
  const src = ensureExpressionText(expression);
  const tokens = [];
  let i = 0;

  const push = (type, value = null) => tokens.push({ type, value });

  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(two)) {
      push('op', two);
      i += 2;
      continue;
    }

    if (['+', '-', '*', '/', '%', '<', '>', '!', '(', ')', ',', '.'].includes(ch)) {
      if (ch === '(' || ch === ')') push('paren', ch);
      else if (ch === ',') push('comma', ch);
      else push('op', ch);
      i += 1;
      continue;
    }

    if (ch === '"' || ch === '\'') {
      const quote = ch;
      i += 1;
      let out = '';
      let closed = false;
      while (i < src.length) {
        const c = src[i];
        if (c === '\\') {
          const next = src[i + 1];
          if (next === undefined) break;
          const escaped = next === 'n' ? '\n' : next === 't' ? '\t' : next;
          out += escaped;
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          closed = true;
          break;
        }
        out += c;
        i += 1;
      }
      if (!closed) throw new Error('Unterminated string literal in expression.');
      push('string', out);
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1]))) {
      let end = i + 1;
      while (end < src.length && /[0-9.]/.test(src[end])) end += 1;
      const raw = src.slice(i, end);
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`Invalid number "${raw}".`);
      push('number', n);
      i = end;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let end = i + 1;
      while (end < src.length && /[A-Za-z0-9_]/.test(src[end])) end += 1;
      const ident = src.slice(i, end);
      push('ident', ident);
      i = end;
      continue;
    }

    throw new Error(`Unsupported character "${ch}" in expression.`);
  }

  push('eof', null);
  return tokens;
}

function parseExpressionAst(expression) {
  const tokens = tokenize(expression);
  let pos = 0;

  function current() {
    return tokens[pos];
  }

  function match(type, value = null) {
    const t = current();
    if (!t || t.type !== type) return false;
    if (value !== null && t.value !== value) return false;
    pos += 1;
    return true;
  }

  function expect(type, value = null) {
    if (match(type, value)) return tokens[pos - 1];
    const t = current();
    const got = t ? `${t.type}:${t.value}` : 'EOF';
    throw new Error(`Unexpected token ${got}.`);
  }

  function parsePrimary() {
    const t = current();
    if (!t) throw new Error('Unexpected end of expression.');

    if (match('number')) return { type: 'literal', value: t.value };
    if (match('string')) return { type: 'literal', value: t.value };
    if (match('paren', '(')) {
      const expr = parseOr();
      expect('paren', ')');
      return expr;
    }
    if (match('ident')) {
      const path = [t.value];
      while (match('op', '.')) {
        const nextIdent = expect('ident');
        path.push(nextIdent.value);
      }
      if (match('paren', '(')) {
        const args = [];
        if (!match('paren', ')')) {
          while (true) {
            args.push(parseOr());
            if (match('paren', ')')) break;
            expect('comma', ',');
          }
        }
        return { type: 'call', path, args };
      }
      return { type: 'path', path };
    }

    throw new Error('Invalid expression syntax.');
  }

  function parseUnary() {
    if (match('op', '!')) return { type: 'unary', op: '!', arg: parseUnary() };
    if (match('op', '-')) return { type: 'unary', op: '-', arg: parseUnary() };
    if (match('op', '+')) return { type: 'unary', op: '+', arg: parseUnary() };
    return parsePrimary();
  }

  function parseMul() {
    let left = parseUnary();
    while (true) {
      if (match('op', '*')) left = { type: 'binary', op: '*', left, right: parseUnary() };
      else if (match('op', '/')) left = { type: 'binary', op: '/', left, right: parseUnary() };
      else if (match('op', '%')) left = { type: 'binary', op: '%', left, right: parseUnary() };
      else break;
    }
    return left;
  }

  function parseAdd() {
    let left = parseMul();
    while (true) {
      if (match('op', '+')) left = { type: 'binary', op: '+', left, right: parseMul() };
      else if (match('op', '-')) left = { type: 'binary', op: '-', left, right: parseMul() };
      else break;
    }
    return left;
  }

  function parseCmp() {
    let left = parseAdd();
    while (true) {
      if (match('op', '<')) left = { type: 'binary', op: '<', left, right: parseAdd() };
      else if (match('op', '>')) left = { type: 'binary', op: '>', left, right: parseAdd() };
      else if (match('op', '<=')) left = { type: 'binary', op: '<=', left, right: parseAdd() };
      else if (match('op', '>=')) left = { type: 'binary', op: '>=', left, right: parseAdd() };
      else break;
    }
    return left;
  }

  function parseEq() {
    let left = parseCmp();
    while (true) {
      if (match('op', '==')) left = { type: 'binary', op: '==', left, right: parseCmp() };
      else if (match('op', '!=')) left = { type: 'binary', op: '!=', left, right: parseCmp() };
      else break;
    }
    return left;
  }

  function parseAnd() {
    let left = parseEq();
    while (match('op', '&&')) left = { type: 'binary', op: '&&', left, right: parseEq() };
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (match('op', '||')) left = { type: 'binary', op: '||', left, right: parseAnd() };
    return left;
  }

  const ast = parseOr();
  expect('eof');
  return ast;
}

function resolvePath(path, context) {
  const root = path[0];
  if (root === 'true') return true;
  if (root === 'false') return false;
  if (root === 'null') return null;
  if (root === 'undefined') return undefined;
  if (!Object.prototype.hasOwnProperty.call(context, root)) {
    throw new Error(`Unknown identifier "${root}".`);
  }
  let out = context[root];
  for (let i = 1; i < path.length; i += 1) {
    const key = path[i];
    if (out === null || out === undefined) return undefined;
    if (typeof out !== 'object' && typeof out !== 'function') return undefined;
    if (!Object.prototype.hasOwnProperty.call(out, key)) return undefined;
    out = out[key];
  }
  return out;
}

function evalAst(node, context) {
  if (!node) return undefined;
  if (node.type === 'literal') return node.value;
  if (node.type === 'path') return resolvePath(node.path, context);
  if (node.type === 'call') {
    if (!Array.isArray(node.path) || node.path.length !== 1) {
      throw new Error('Only direct helper calls are allowed.');
    }
    const fnName = node.path[0];
    const fn = HELPERS[fnName];
    if (typeof fn !== 'function') throw new Error(`Unknown helper "${fnName}".`);
    const args = node.args.map((arg) => evalAst(arg, context));
    return fn(...args);
  }
  if (node.type === 'unary') {
    const value = evalAst(node.arg, context);
    if (node.op === '!') return !value;
    if (node.op === '-') return -Number(value);
    if (node.op === '+') return Number(value);
    throw new Error(`Unsupported unary operator "${node.op}".`);
  }
  if (node.type === 'binary') {
    if (node.op === '&&') {
      const left = evalAst(node.left, context);
      return left ? evalAst(node.right, context) : left;
    }
    if (node.op === '||') {
      const left = evalAst(node.left, context);
      return left ? left : evalAst(node.right, context);
    }
    const left = evalAst(node.left, context);
    const right = evalAst(node.right, context);
    if (node.op === '+') return left + right;
    if (node.op === '-') return Number(left) - Number(right);
    if (node.op === '*') return Number(left) * Number(right);
    if (node.op === '/') return Number(left) / Number(right);
    if (node.op === '%') return Number(left) % Number(right);
    if (node.op === '<') return left < right;
    if (node.op === '>') return left > right;
    if (node.op === '<=') return left <= right;
    if (node.op === '>=') return left >= right;
    if (node.op === '==') return left == right; // eslint-disable-line eqeqeq
    if (node.op === '!=') return left != right; // eslint-disable-line eqeqeq
    throw new Error(`Unsupported operator "${node.op}".`);
  }
  throw new Error('Unsupported AST node.');
}

function evaluateSafeExpression(expression, context = {}) {
  const ast = parseExpressionAst(expression);
  const localContext = {
    value: context.value,
    answers: context.answers && typeof context.answers === 'object' ? context.answers : {},
    prefill: context.prefill && typeof context.prefill === 'object' ? context.prefill : {}
  };
  return evalAst(ast, localContext);
}

function normalizeValidationRule(rawRule, index = 0) {
  const rule = rawRule && typeof rawRule === 'object' ? rawRule : {};
  const idRaw = String(rule.id || '').trim();
  const id = idRaw || `rule_${index + 1}`;
  const enabled = rule.enabled !== false && String(rule.enabled).trim().toLowerCase() !== 'false';
  const severityRaw = String(rule.severity || 'error').trim().toLowerCase();
  const severity = VALID_SEVERITIES.has(severityRaw) ? severityRaw : 'error';
  const whenRaw = String(rule.when || 'always').trim().toLowerCase();
  const when = VALID_WHEN_VALUES.has(whenRaw) ? whenRaw : 'always';
  const expression = ensureExpressionText(rule.expression, { allowEmpty: true });
  const message = String(rule.message || '').trim().slice(0, 300);
  return {
    id,
    enabled,
    severity,
    when,
    expression,
    message
  };
}

function normalizeConversionRule(rawRule) {
  const rule = rawRule && typeof rawRule === 'object' ? rawRule : {};
  const enabled = rule.enabled === true || String(rule.enabled || '').trim().toLowerCase() === 'true';
  const expression = ensureExpressionText(rule.expression, { allowEmpty: true });
  const onErrorRaw = String(rule.onError || 'use_raw').trim().toLowerCase();
  const onError = VALID_CONVERSION_ON_ERROR.has(onErrorRaw) ? onErrorRaw : 'use_raw';
  return { enabled, expression, onError };
}

function findCyclePath(adjacency, nodeSet) {
  const state = new Map();
  const stack = [];

  function visit(node) {
    state.set(node, 1);
    stack.push(node);
    const nextNodes = adjacency.get(node) || [];
    for (const next of nextNodes) {
      if (!nodeSet.has(next)) continue;
      const nextState = state.get(next) || 0;
      if (nextState === 0) {
        const found = visit(next);
        if (found) return found;
      } else if (nextState === 1) {
        const start = stack.indexOf(next);
        const loop = stack.slice(start).concat(next);
        return loop;
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  }

  for (const node of nodeSet) {
    if ((state.get(node) || 0) !== 0) continue;
    const found = visit(node);
    if (found) return found;
  }
  return null;
}

function buildCalculatedFieldPlan(template, { strict = true } = {}) {
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const dataFields = fields.filter((field) => !isVisualOnlyField(field) && field?.id);
  const fieldMap = new Map(dataFields.map((field) => [String(field.id), field]));
  const calculatedFields = dataFields.filter((field) => isCalculatedField(field));
  const calculatedIds = new Set(calculatedFields.map((field) => String(field.id)));

  const dependenciesByField = new Map();
  const reverseAdj = new Map();
  const indegree = new Map();

  calculatedFields.forEach((field) => {
    const fieldId = String(field.id);
    indegree.set(fieldId, 0);
    reverseAdj.set(fieldId, []);
  });

  calculatedFields.forEach((field) => {
    const fieldId = String(field.id);
    const label = String(field?.label || fieldId || 'Field').trim();
    const calcRule = normalizeCalculationRule(field?.calculationRule || {});
    const deps = normalizeCalculationDependencies(field?.calculationDependencies || []);
    const depsSeen = new Set();

    if (strict && !calcRule.expression) {
      throw new Error(`Calculated field "${label}" is missing calculation expression.`);
    }
    if (strict && deps.length === 0) {
      throw new Error(`Calculated field "${label}" must define at least one dependency.`);
    }

    deps.forEach((depIdRaw) => {
      const depId = String(depIdRaw || '').trim();
      if (!depId) return;
      const depKey = depId.toLowerCase();
      if (depsSeen.has(depKey)) {
        if (strict) throw new Error(`Calculated field "${label}" has duplicate dependency "${depId}".`);
        return;
      }
      depsSeen.add(depKey);
      if (depId === fieldId) {
        if (strict) throw new Error(`Calculated field "${label}" cannot depend on itself.`);
        return;
      }
      if (!fieldMap.has(depId)) {
        if (strict) throw new Error(`Calculated field "${label}" depends on unknown field "${depId}".`);
        return;
      }
      if (!calculatedIds.has(depId)) return;
      reverseAdj.get(depId).push(fieldId);
      indegree.set(fieldId, (indegree.get(fieldId) || 0) + 1);
    });

    dependenciesByField.set(fieldId, deps);
  });

  const queue = [...calculatedIds].filter((id) => (indegree.get(id) || 0) === 0);
  const orderedIds = [];

  while (queue.length) {
    const current = queue.shift();
    orderedIds.push(current);
    const targets = reverseAdj.get(current) || [];
    targets.forEach((targetId) => {
      const next = (indegree.get(targetId) || 0) - 1;
      indegree.set(targetId, next);
      if (next === 0) queue.push(targetId);
    });
  }

  if (orderedIds.length !== calculatedIds.size && strict) {
    const cyclePath = findCyclePath(reverseAdj, calculatedIds);
    const loopText = Array.isArray(cyclePath) && cyclePath.length ? cyclePath.join(' -> ') : 'calculated dependencies';
    throw new Error(`Calculated field dependency cycle detected: ${loopText}.`);
  }

  return {
    orderedIds,
    fieldMap,
    dependenciesByField
  };
}

function recomputeCalculatedAnswers({ template, mergedAnswers = {}, prefill = {} }) {
  const base = mergedAnswers && typeof mergedAnswers === 'object' ? { ...mergedAnswers } : {};
  const prefillSafe = prefill && typeof prefill === 'object' ? prefill : {};
  const diagnostics = [];
  const plan = buildCalculatedFieldPlan(template, { strict: true });

  plan.orderedIds.forEach((fieldId) => {
    const field = plan.fieldMap.get(fieldId);
    if (!field) return;
    const calcRule = normalizeCalculationRule(field?.calculationRule || {});
    if (!calcRule.enabled || !calcRule.expression) return;
    const previousValue = base[fieldId];

    try {
      const nextValue = evaluateSafeExpression(calcRule.expression, {
        value: previousValue,
        answers: base,
        prefill: prefillSafe
      });
      base[fieldId] = nextValue;
    } catch (error) {
      if (calcRule.onError === 'empty') {
        base[fieldId] = '';
      } else {
        base[fieldId] = previousValue;
      }
      diagnostics.push({
        fieldId,
        fieldLabel: String(field?.label || fieldId || 'Field').trim(),
        message: `Calculation failed for "${String(field?.label || fieldId || 'field').trim()}".`,
        error: error.message,
        onError: calcRule.onError
      });
    }
  });

  return {
    answers: base,
    diagnostics,
    orderedIds: plan.orderedIds
  };
}

function evaluateFieldValidations({ field, value, answers = {}, prefill = {} }) {
  const fieldId = String(field?.id || '').trim();
  const label = String(field?.label || fieldId || 'Field').trim();
  const rulesRaw = Array.isArray(field?.validationRules) ? field.validationRules : [];
  const rules = rulesRaw.map((rule, index) => normalizeValidationRule(rule, index));
  const issues = [];
  const fieldType = String(field?.type || '').trim().toLowerCase();

  if (field?.required === true && !hasValue(value)) {
    issues.push({
      fieldId,
      fieldLabel: label,
      ruleId: 'required',
      severity: 'error',
      message: `Field "${label}" is required.`,
      source: 'required'
    });
  }
  if (fieldType === 'number' && hasValue(value) && !Number.isFinite(Number(value))) {
    issues.push({
      fieldId,
      fieldLabel: label,
      ruleId: 'number',
      severity: 'error',
      message: `Invalid numeric value for "${label}".`,
      source: 'type'
    });
  }

  rules.forEach((rule, index) => {
    if (!rule.enabled || !rule.expression) return;
    if (rule.when === 'if_has_value' && !hasValue(value)) return;

    let passed = false;
    try {
      passed = Boolean(evaluateSafeExpression(rule.expression, { value, answers, prefill }));
    } catch (error) {
      issues.push({
        fieldId,
        fieldLabel: label,
        ruleId: rule.id || `rule_${index + 1}`,
        severity: 'error',
        message: `Validation rule failed to evaluate for "${label}".`,
        source: 'engine',
        detail: error.message
      });
      return;
    }

    if (passed) return;
    issues.push({
      fieldId,
      fieldLabel: label,
      ruleId: rule.id || `rule_${index + 1}`,
      severity: rule.severity,
      message: rule.message || `Validation failed for "${label}".`,
      source: 'rule'
    });
  });

  return issues;
}

function evaluateTemplateValidations({ template, mergedAnswers = {}, prefill = {}, extraIssues = [] }) {
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const answersRaw = mergedAnswers && typeof mergedAnswers === 'object' ? mergedAnswers : {};
  const prefillSafe = prefill && typeof prefill === 'object' ? prefill : {};
  const recalculated = recomputeCalculatedAnswers({
    template,
    mergedAnswers: answersRaw,
    prefill: prefillSafe
  });
  const answers = recalculated.answers;
  const issues = [];

  fields.forEach((field) => {
    if (isVisualOnlyField(field) || !field?.id) return;
    const value = answers[field.id];
    const fieldIssues = evaluateFieldValidations({
      field,
      value,
      answers,
      prefill: prefillSafe
    });
    issues.push(...fieldIssues);
  });

  if (Array.isArray(extraIssues) && extraIssues.length) {
    extraIssues.forEach((issue) => {
      const row = issue && typeof issue === 'object' ? issue : {};
      issues.push({
        fieldId: String(row.fieldId || '').trim(),
        fieldLabel: String(row.fieldLabel || row.fieldId || 'Field').trim() || 'Field',
        ruleId: String(row.ruleId || '').trim(),
        severity: String(row.severity || 'error').trim().toLowerCase() === 'warning' ? 'warning' : 'error',
        message: String(row.message || 'Validation failed.').trim(),
        source: String(row.source || 'parse')
      });
    });
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const issuesByField = {};
  issues.forEach((issue) => {
    const key = String(issue.fieldId || '__form').trim() || '__form';
    if (!issuesByField[key]) issuesByField[key] = [];
    issuesByField[key].push(issue);
  });

  return {
    allIssues: issues,
    errors,
    warnings,
    issuesByField,
    hasBlockingErrors: errors.length > 0,
    recalculatedAnswers: answers,
    calculationDiagnostics: recalculated.diagnostics
  };
}

function convertFieldValueForExport({ field, value, answers = {}, prefill = {} }) {
  const normalized = normalizeConversionRule(field?.conversionRule || {});
  if (!normalized.enabled || !normalized.expression) {
    return { value, diagnostic: null };
  }

  try {
    const converted = evaluateSafeExpression(normalized.expression, {
      value,
      answers,
      prefill
    });
    return { value: converted, diagnostic: null };
  } catch (error) {
    return {
      value: normalized.onError === 'empty' ? '' : value,
      diagnostic: {
        fieldId: String(field?.id || '').trim(),
        fieldLabel: String(field?.label || field?.id || 'Field').trim(),
        message: `Conversion failed for "${String(field?.label || field?.id || 'field').trim()}".`,
        error: error.message,
        onError: normalized.onError
      }
    };
  }
}

module.exports = {
  MAX_EXPRESSION_LENGTH,
  MAX_CALCULATION_EXPRESSION_LENGTH,
  VALID_SEVERITIES: Object.freeze([...VALID_SEVERITIES]),
  VALID_WHEN_VALUES: Object.freeze([...VALID_WHEN_VALUES]),
  VALID_CONVERSION_ON_ERROR: Object.freeze([...VALID_CONVERSION_ON_ERROR]),
  VALID_VALUE_MODES: Object.freeze([...VALID_VALUE_MODES]),
  VALID_CALC_ON_ERROR: Object.freeze([...VALID_CALC_ON_ERROR]),
  HELPERS,
  hasValue,
  ensureExpressionText,
  normalizeValueMode,
  normalizeCalculationDependencies,
  normalizeCalculationRule,
  isCalculatedField,
  normalizeValidationRule,
  normalizeConversionRule,
  buildCalculatedFieldPlan,
  recomputeCalculatedAnswers,
  evaluateSafeExpression,
  evaluateFieldValidations,
  evaluateTemplateValidations,
  convertFieldValueForExport
};
