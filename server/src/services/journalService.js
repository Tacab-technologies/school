import mongoose from 'mongoose';
import JournalEntry from '../models/JournalEntry.js';
import JournalLine from '../models/JournalLine.js';
import ChartOfAccount from '../models/ChartOfAccount.js';

// Standard account mapping for auto-creation / fallback
const STANDARD_ACCOUNTS = {
  '1000': { accountCode: '1000', accountName: 'Cash', type: 'Asset', normalBalance: 'Debit', isSystemAccount: true },
  '1010': { accountCode: '1010', accountName: 'Bank', type: 'Asset', normalBalance: 'Debit' },
  '1200': { accountCode: '1200', accountName: 'Accounts Receivable', type: 'Asset', normalBalance: 'Debit', isSystemAccount: true },
  '4000': { accountCode: '4000', accountName: 'Tuition Revenue', type: 'Revenue', normalBalance: 'Credit', isSystemAccount: true },
  '5000': { accountCode: '5000', accountName: 'Salaries Expense', type: 'Expense', normalBalance: 'Debit' },
  '5100': { accountCode: '5100', accountName: 'Scholarship Expense', type: 'Expense', normalBalance: 'Debit', isSystemAccount: true },
  '5300': { accountCode: '5300', accountName: 'Utilities Expense', type: 'Expense', normalBalance: 'Debit' },
  '5400': { accountCode: '5400', accountName: 'Supplies Expense', type: 'Expense', normalBalance: 'Debit' },
  '5500': { accountCode: '5500', accountName: 'General Expenses', type: 'Expense', normalBalance: 'Debit' },
  '5600': { accountCode: '5600', accountName: 'Rent Expense', type: 'Expense', normalBalance: 'Debit' },
  '5700': { accountCode: '5700', accountName: 'Repairs & Maintenance Expense', type: 'Expense', normalBalance: 'Debit' },
};

/** Where money moves for a payment method: bank-like methods use Bank, everything else Cash. */
export const moneyAccountCode = (methodName = '') =>
  (/bank|transfer|cheque|check/i.test(methodName) ? '1010' : '1000');

const createOne = (doc, querySession) =>
  ChartOfAccount.create([doc], querySession).then((res) => (Array.isArray(res) ? res[0] : res));

// Create an account; if a concurrent caller created the same code first
// (unique accountCode), use theirs instead of failing.
const createAccount = async (doc, querySession) => {
  try {
    return await createOne(doc, querySession);
  } catch (err) {
    if (err?.code === 11000 && doc.accountCode) {
      const existing = await ChartOfAccount.findOne({ accountCode: doc.accountCode }, null, querySession);
      if (existing) return existing;
    }
    throw err;
  }
};

/**
 * Looks up the accounts for `codes` once, so a batch of journals (e.g. a whole
 * month's fee charge) can pass the result to postJournalEntry as `accounts`
 * instead of looking them up per entry. Returns a Map accountCode ->
 * ChartOfAccount document. With `createMissing: false`, codes that don't exist
 * yet are left out and postJournalEntry creates them on first use, as usual.
 */
export const resolveAccountsByCode = async (codes, session = null, { createMissing = true } = {}) => {
  const querySession = session ? { session } : {};
  const unique = [...new Set(codes.map(String))];
  const found = await ChartOfAccount.find({ accountCode: { $in: unique } }, null, querySession);
  const byCode = new Map(found.map((a) => [a.accountCode, a]));
  for (const code of unique) {
    if (byCode.has(code) || !createMissing) continue;
    const template = STANDARD_ACCOUNTS[code] ?? {
      accountCode: code,
      accountName: `Account ${code}`,
      type: 'Expense',
      normalBalance: 'Debit',
    };
    byCode.set(code, await createAccount(template, querySession));
  }
  return byCode;
};

// Resolve one journal line to its ChartOfAccount document.
const resolveLineAccount = async (line, querySession, accounts) => {
  let account = null;

  if (line.accountId) {
    account = await ChartOfAccount.findById(line.accountId, null, querySession);
  } else if (line.accountCode) {
    account = accounts?.get(String(line.accountCode))
      ?? await ChartOfAccount.findOne({ accountCode: line.accountCode }, null, querySession);
  } else if (line.accountName) {
    // Fuzzy match or exact match on name
    const name = line.accountName.toLowerCase();
    let codeMatch = null;
    if (name.includes('cash')) codeMatch = '1000';
    else if (name.includes('bank')) codeMatch = '1010';
    else if (name.includes('receivable')) codeMatch = '1200';
    else if (name.includes('revenue') || name.includes('tuition')) codeMatch = '4000';
    else if (name.includes('scholarship')) codeMatch = '5100';

    if (codeMatch) {
      account = await ChartOfAccount.findOne({ accountCode: codeMatch }, null, querySession);
    }
    if (!account) {
      account = await ChartOfAccount.findOne({
        accountName: { $regex: new RegExp('^' + line.accountName + '$', 'i') }
      }, null, querySession);
    }
  }

  // Auto-create standard account if it does not exist yet
  if (!account && line.accountCode && STANDARD_ACCOUNTS[line.accountCode]) {
    account = await createAccount(STANDARD_ACCOUNTS[line.accountCode], querySession);
  }

  if (!account) {
    // Create a generic account as fallback to ensure transaction does not fail
    const fallbackCode = line.accountCode || `ACC-${Date.now().toString().slice(-4)}`;
    const fallbackName = line.accountName || `Account ${fallbackCode}`;
    account = await createAccount({
      accountCode: fallbackCode,
      accountName: fallbackName,
      type: Number(line.debit) > 0 ? 'Expense' : 'Revenue',
      normalBalance: Number(line.debit) > 0 ? 'Debit' : 'Credit',
    }, querySession);
  }

  return account;
};

/**
 * Helper to post a balanced journal entry
 * @param {Object} params
 * @param {Date} params.date
 * @param {String} params.referenceType (e.g. 'Payment', 'Invoice')
 * @param {String} params.referenceId (ObjectId)
 * @param {String} params.journalNumber (e.g. 'PAY-123')
 * @param {String} params.description
 * @param {Array} params.lines Array of { accountName or accountCode, debit, credit, description, studentId }
 * @param {ClientSession} params.session Mongoose transaction session
 * @param {Map} [params.accounts] Optional preloaded accountCode -> account (see resolveAccountsByCode)
 */
export const postJournalEntry = async ({
  date = new Date(),
  referenceType,
  referenceId,
  journalNumber,
  description,
  lines,
  session,
  accounts,
}) => {
  if (!lines || lines.length < 2) {
    throw new Error('A journal entry must have at least two lines.');
  }

  // 1. Calculate and validate balancing
  let totalDebit = 0;
  let totalCredit = 0;
  
  for (const line of lines) {
    totalDebit += Number(line.debit || 0);
    totalCredit += Number(line.credit || 0);
  }

  // Fix floating point issues
  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;

  if (totalDebit !== totalCredit) {
    throw new Error(`Unbalanced journal entry: Debits ($${totalDebit}) do not equal Credits ($${totalCredit}).`);
  }
  
  if (totalDebit === 0) {
    return null; // Nothing to post
  }

  // 2. Resolve Account IDs. Without a transaction the lookups run in parallel;
  // inside one they stay sequential (a session can't run operations at once).
  const querySession = session ? { session } : {};
  let resolvedAccounts;
  if (session) {
    resolvedAccounts = [];
    for (const line of lines) resolvedAccounts.push(await resolveLineAccount(line, querySession, accounts));
  } else {
    // Lines naming the same account share one lookup, so a missing account is
    // only auto-created once.
    const keyOf = (l) => (l.accountId ? `id:${l.accountId}` : l.accountCode ? `code:${l.accountCode}` : `name:${l.accountName}`);
    const pending = new Map();
    for (const line of lines) {
      const key = keyOf(line);
      if (!pending.has(key)) pending.set(key, resolveLineAccount(line, querySession, accounts));
    }
    resolvedAccounts = await Promise.all(lines.map((l) => pending.get(keyOf(l))));
  }

  const resolvedLines = lines.map((line, i) => ({
    accountId: resolvedAccounts[i]._id,
    debit: Number(line.debit || 0),
    credit: Number(line.credit || 0),
    description: line.description || description,
    studentId: line.studentId,
  }));

  // 3. Create the Header — ensure journalNumber uniqueness by retrying with
  // suffixed variants if the provided journalNumber collides.
  const MAX_TRIES = 5;
  let savedHeader = null;
  let attempt = 0;
  let candidateJournalNumber = journalNumber;
  while (!savedHeader && attempt < MAX_TRIES) {
    attempt += 1;
    try {
      const header = new JournalEntry({
        journalNumber: candidateJournalNumber,
        date,
        referenceType,
        referenceId,
        description,
        status: 'Posted',
      });

      savedHeader = await header.save({ session });
    } catch (err) {
      // Duplicate key on journalNumber — try a suffixed alternative and retry.
      if (err && err.code === 11000 && candidateJournalNumber === journalNumber) {
        candidateJournalNumber = `${journalNumber}-${Date.now().toString().slice(-4)}`;
        continue;
      }
      // If it's a different error or retries exhausted, rethrow.
      throw err;
    }
  }
  if (!savedHeader) throw new Error('Failed to create unique journal entry header');

  // 4. Create the Lines
  const linesToSave = resolvedLines.map((line) => ({
    ...line,
    journalEntryId: savedHeader._id,
  }));

  await JournalLine.insertMany(linesToSave, { session });

  return savedHeader;
};

/**
 * Undoes a posted journal with an opposite one on `date`. The original stays
 * posted, so the ledger shows both the mistake and its correction. Returns the
 * new journal, or null when there is nothing to undo.
 */
export const reverseJournalEntry = async (journalEntryId, { date = new Date(), description, session = null } = {}) => {
  if (!journalEntryId) return null;
  const querySession = session ? { session } : {};
  const original = await JournalEntry.findById(journalEntryId, null, querySession);
  if (!original) return null;
  const lines = await JournalLine.find({ journalEntryId }, null, querySession);
  return postJournalEntry({
    date,
    referenceType: `${original.referenceType} Reversal`,
    referenceId: original.referenceId,
    journalNumber: `${original.journalNumber}-REV`,
    description: description ?? `Reversal of ${original.journalNumber}`,
    lines: lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: l.description, studentId: l.studentId })),
    session,
  });
};
