function roundMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function normalizeDraftTransactionItems(itemsInput) {
  const items = Array.isArray(itemsInput) ? itemsInput : [];
  return items.map((item) => {
    const direction = String(item?.amount?.direction || '').trim().toLowerCase();
    const amountValue = Number(item?.amount?.value || 0);
    const amountCurrency = String(item?.amount?.currency || 'CAD').trim().toUpperCase() || 'CAD';
    return {
      ...(item && typeof item === 'object' ? item : {}),
      source: (item?.source && typeof item.source === 'object') ? { ...item.source } : {},
      party: (item?.party && typeof item.party === 'object') ? { ...item.party } : {},
      fee: (item?.fee && typeof item.fee === 'object') ? { ...item.fee } : {},
      metadata: (item?.metadata && typeof item.metadata === 'object') ? { ...item.metadata } : {},
      memo: String(item?.memo || '').trim(),
      amount: {
        value: roundMoney(amountValue),
        currency: amountCurrency,
        direction
      }
    };
  }).filter((item) => {
    if (!['debit', 'credit'].includes(String(item?.amount?.direction || ''))) return false;
    if (!Number.isFinite(Number(item?.amount?.value || 0)) || Number(item.amount.value) <= 0) return false;
    return Boolean(String(item?.metadata?.accountId || '').trim());
  });
}

function buildDraftPreviewRowsFromItems(itemsInput) {
  const items = normalizeDraftTransactionItems(itemsInput);
  const rows = [];
  for (let i = 0, rowIndex = 0; i < items.length; i += 2, rowIndex += 1) {
    const first = items[i];
    const second = items[i + 1];
    if (!first || !second) continue;

    const firstDirection = String(first?.amount?.direction || '').toLowerCase();
    const secondDirection = String(second?.amount?.direction || '').toLowerCase();
    const debit = firstDirection === 'debit' ? first : (secondDirection === 'debit' ? second : null);
    const credit = firstDirection === 'credit' ? first : (secondDirection === 'credit' ? second : null);
    if (!debit || !credit) continue;

    rows.push({
      rowIndex,
      include: true,
      memo: String(debit?.memo || credit?.memo || '').trim(),
      amount: roundMoney(debit?.amount?.value || credit?.amount?.value || 0),
      currency: String(debit?.amount?.currency || credit?.amount?.currency || 'CAD').trim().toUpperCase() || 'CAD',
      debitAccount: {
        id: String(debit?.metadata?.accountId || '').trim(),
        code: String(debit?.metadata?.accountCode || '').trim(),
        name: String(debit?.metadata?.accountName || '').trim()
      },
      creditAccount: {
        id: String(credit?.metadata?.accountId || '').trim(),
        code: String(credit?.metadata?.accountCode || '').trim(),
        name: String(credit?.metadata?.accountName || '').trim()
      }
    });
  }
  return rows;
}

function applyDraftRowEditsToItems(itemsInput, editsInput) {
  const items = normalizeDraftTransactionItems(itemsInput);
  const edits = Array.isArray(editsInput) ? editsInput : [];
  const editMap = new Map(
    edits
      .map((row) => [Number(row?.rowIndex), row])
      .filter(([rowIndex]) => Number.isInteger(rowIndex) && rowIndex >= 0)
  );

  const nextItems = [];
  let rowCounter = 0;
  for (let i = 0; i < items.length; i += 2, rowCounter += 1) {
    const first = items[i];
    const second = items[i + 1];
    if (!first || !second) continue;

    const firstDirection = String(first?.amount?.direction || '').toLowerCase();
    const secondDirection = String(second?.amount?.direction || '').toLowerCase();
    const firstIsDebit = firstDirection === 'debit';
    const debit = firstIsDebit ? first : second;
    const credit = firstIsDebit ? second : first;
    if (String(debit?.amount?.direction || '').toLowerCase() !== 'debit') continue;
    if (String(credit?.amount?.direction || '').toLowerCase() !== 'credit') continue;

    const edit = editMap.get(rowCounter) || {};
    const include = !(edit.include === false || String(edit.include || '').toLowerCase() === 'false' || String(edit.include || '') === '0');
    if (!include) continue;

    const requestedAmount = edit.amount !== undefined ? Number(edit.amount) : Number(debit?.amount?.value || credit?.amount?.value || 0);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new Error(`Draft transaction row #${rowCounter + 1} amount must be greater than zero.`);
    }
    const amountValue = roundMoney(requestedAmount);
    const currency = String(edit.currency || debit?.amount?.currency || credit?.amount?.currency || 'CAD').trim().toUpperCase() || 'CAD';
    const memo = String(edit.memo !== undefined ? edit.memo : (debit?.memo || credit?.memo || '')).trim();
    const requestedDebitAccount = (edit?.debitAccount && typeof edit.debitAccount === 'object')
      ? {
          id: String(edit.debitAccount.id || '').trim(),
          code: String(edit.debitAccount.code || '').trim(),
          name: String(edit.debitAccount.name || '').trim()
        }
      : null;
    const requestedCreditAccount = (edit?.creditAccount && typeof edit.creditAccount === 'object')
      ? {
          id: String(edit.creditAccount.id || '').trim(),
          code: String(edit.creditAccount.code || '').trim(),
          name: String(edit.creditAccount.name || '').trim()
        }
      : null;

    const updatedDebit = {
      ...debit,
      memo,
      amount: {
        ...debit.amount,
        value: amountValue,
        currency,
        direction: 'debit'
      },
      metadata: {
        ...(debit?.metadata && typeof debit.metadata === 'object' ? debit.metadata : {}),
        ...(requestedDebitAccount?.id ? {
          accountId: requestedDebitAccount.id,
          accountCode: requestedDebitAccount.code,
          accountName: requestedDebitAccount.name
        } : {})
      }
    };
    const updatedCredit = {
      ...credit,
      memo,
      amount: {
        ...credit.amount,
        value: amountValue,
        currency,
        direction: 'credit'
      },
      metadata: {
        ...(credit?.metadata && typeof credit.metadata === 'object' ? credit.metadata : {}),
        ...(requestedCreditAccount?.id ? {
          accountId: requestedCreditAccount.id,
          accountCode: requestedCreditAccount.code,
          accountName: requestedCreditAccount.name
        } : {})
      }
    };

    if (firstIsDebit) {
      nextItems.push(updatedDebit, updatedCredit);
    } else {
      nextItems.push(updatedCredit, updatedDebit);
    }
  }

  return {
    items: nextItems,
    previewRows: buildDraftPreviewRowsFromItems(nextItems)
  };
}

module.exports = {
  roundMoney,
  normalizeDraftTransactionItems,
  buildDraftPreviewRowsFromItems,
  applyDraftRowEditsToItems
};
