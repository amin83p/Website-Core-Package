function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function isAlpha(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isAlphaNumeric(ch) {
  return isAlpha(ch) || isDigit(ch);
}

function tokenize(expression) {
  const src = String(expression || '').trim();
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (isDigit(ch) || ch === '.') {
      let start = i;
      let dotCount = 0;
      while (i < src.length && (isDigit(src[i]) || src[i] === '.')) {
        if (src[i] === '.') dotCount += 1;
        i += 1;
      }
      if (dotCount > 1) throw new Error('Invalid number format in formula.');
      const raw = src.slice(start, i);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error('Invalid numeric value in formula.');
      tokens.push({ type: 'number', value });
      continue;
    }

    if (isAlpha(ch)) {
      let start = i;
      while (i < src.length && isAlphaNumeric(src[i])) i += 1;
      const name = src.slice(start, i).toLowerCase();
      tokens.push({ type: 'identifier', value: name });
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '(' || ch === ')') {
      tokens.push({ type: 'operator', value: ch });
      i += 1;
      continue;
    }

    throw new Error(`Unsupported character "${ch}" in formula.`);
  }

  return tokens;
}

function toRpn(tokens) {
  const output = [];
  const stack = [];
  const precedence = {
    'u-': 3,
    '*': 2,
    '/': 2,
    '+': 1,
    '-': 1
  };
  const rightAssociative = new Set(['u-']);

  let previous = null;
  tokens.forEach((token) => {
    if (token.type === 'number' || token.type === 'identifier') {
      output.push(token);
      previous = token;
      return;
    }

    const op = token.value;
    if (op === '(') {
      stack.push(token);
      previous = token;
      return;
    }

    if (op === ')') {
      while (stack.length && stack[stack.length - 1].value !== '(') {
        output.push(stack.pop());
      }
      if (!stack.length) throw new Error('Unbalanced parentheses in formula.');
      stack.pop();
      previous = token;
      return;
    }

    const isUnaryMinus =
      op === '-' &&
      (!previous || (previous.type === 'operator' && previous.value !== ')'));
    const normalizedOp = isUnaryMinus ? 'u-' : op;
    const normalizedToken = { type: 'operator', value: normalizedOp };

    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.value === '(') break;
      const topPrec = precedence[top.value] || 0;
      const currentPrec = precedence[normalizedOp] || 0;
      const shouldPop = rightAssociative.has(normalizedOp)
        ? currentPrec < topPrec
        : currentPrec <= topPrec;
      if (!shouldPop) break;
      output.push(stack.pop());
    }

    stack.push(normalizedToken);
    previous = normalizedToken;
  });

  while (stack.length) {
    const top = stack.pop();
    if (top.value === '(' || top.value === ')') throw new Error('Unbalanced parentheses in formula.');
    output.push(top);
  }

  return output;
}

function evaluateRpn(rpnTokens, variables = {}) {
  const stack = [];
  const allowedVars = Object.create(null);
  Object.keys(variables || {}).forEach((key) => {
    allowedVars[String(key).toLowerCase()] = Number(variables[key]);
  });

  rpnTokens.forEach((token) => {
    if (token.type === 'number') {
      stack.push(token.value);
      return;
    }

    if (token.type === 'identifier') {
      const name = token.value;
      if (!Object.prototype.hasOwnProperty.call(allowedVars, name)) {
        throw new Error(`Unknown variable "${name}" in formula.`);
      }
      const value = Number(allowedVars[name]);
      if (!Number.isFinite(value)) throw new Error(`Invalid value for variable "${name}".`);
      stack.push(value);
      return;
    }

    if (token.value === 'u-') {
      if (stack.length < 1) throw new Error('Invalid unary operation in formula.');
      stack.push(-stack.pop());
      return;
    }

    if (stack.length < 2) throw new Error('Invalid formula expression.');
    const b = stack.pop();
    const a = stack.pop();

    if (token.value === '+') stack.push(a + b);
    else if (token.value === '-') stack.push(a - b);
    else if (token.value === '*') stack.push(a * b);
    else if (token.value === '/') {
      if (b === 0) throw new Error('Division by zero in formula.');
      stack.push(a / b);
    } else {
      throw new Error('Unsupported formula operator.');
    }
  });

  if (stack.length !== 1) throw new Error('Invalid formula result.');
  return stack[0];
}

function evaluateSimpleFormula(expression, variables = {}) {
  const tokens = tokenize(expression);
  if (!tokens.length) throw new Error('Formula cannot be empty.');
  const rpn = toRpn(tokens);
  return evaluateRpn(rpn, variables);
}

module.exports = {
  evaluateSimpleFormula
};
