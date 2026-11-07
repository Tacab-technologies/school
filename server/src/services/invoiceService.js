import StudentInvoice from '../models/StudentInvoice.js';
import FeeStructure from '../models/FeeStructure.js';
import Student from '../models/Student.js';
import StudentScholarship from '../models/StudentScholarship.js';
import Status from '../models/Status.js';
import Counter from '../models/Counter.js';
import Family from '../models/Family.js';
import SiblingRule from '../models/SiblingRule.js';
import { getSiblingDiscountPercent } from './familyService.js';
import { postJournalEntry } from './journalService.js';
import SystemSetting from '../models/SystemSetting.js';

// Auto-generates INV-<year>-<seq> when the caller doesn't supply invoice_no,
// using the same atomic per-year Counter pattern as admission numbers
// (studentService.js) and receipt numbers (paymentService.js).
export const generateInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { year },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `INV-${year}-${String(counter.seq).padStart(4, '0')}`;
};

// A student's active scholarship (if any) contributes its discount_value,
// treated as a percentage — the same convention the Scholarships UI uses for
// its "Discount (%)" field.
export const getActiveScholarshipDiscountPercent = async (studentId) => {
  const activeStatus = await Status.findOne({ st_name: 'Active' });
  if (!activeStatus) return 0;

  const now = new Date();
  const assignment = await StudentScholarship.findOne({
    st_no: studentId,
    status_no: activeStatus._id,
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).populate('scholarship_id');

  return assignment?.scholarship_id?.discount_value || 0;
};

/**
 * Loads, in a handful of queries, everything computeStudentDiscount needs for
 * a batch of students (their families' sibling discount, their active
 * scholarships and the school's discount rule), so charging a whole class
 * doesn't look these up again for every student. Mirrors
 * getSiblingDiscountPercent and getActiveScholarshipDiscountPercent exactly.
 */
export const loadDiscountContext = async (studentDocs) => {
  const studentIds = studentDocs.map((s) => s._id);
  const familyIds = [...new Set(studentDocs.map((s) => s.familyId).filter(Boolean).map(String))];
  const now = new Date();

  const [families, siblingRules, activeStatus, setting] = await Promise.all([
    familyIds.length ? Family.find({ _id: { $in: familyIds } }).select('siblingCount') : [],
    SiblingRule.find({ is_active: true }).sort({ minimum_siblings: -1 }),
    Status.findOne({ st_name: 'Active' }),
    SystemSetting.findOne().select('discountRule').lean(),
  ]);

  const siblingPctByFamily = new Map();
  for (const family of families) {
    let pct = 0;
    if (family.siblingCount) {
      const rule = siblingRules.find((r) => r.minimum_siblings <= family.siblingCount);
      pct = rule ? rule.discount_percentage : 0;
    }
    siblingPctByFamily.set(String(family._id), pct);
  }

  const scholarshipPctByStudent = new Map();
  if (activeStatus && studentIds.length) {
    const assignments = await StudentScholarship.find({
      st_no: { $in: studentIds },
      status_no: activeStatus._id,
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).populate('scholarship_id');
    // Like findOne: the first matching assignment per student counts.
    for (const a of assignments) {
      const key = String(a.st_no);
      if (!scholarshipPctByStudent.has(key)) scholarshipPctByStudent.set(key, a.scholarship_id?.discount_value || 0);
    }
  }

  return {
    students: new Set(studentIds.map(String)),
    siblingPctByFamily,
    scholarshipPctByStudent,
    discountRule: setting?.discountRule ?? 'highest_only',
  };
};

/**
 * What a student would actually be charged for `original_amount`: sibling % +
 * scholarship % + their own standing discount (Student.fee_discount, a % or a
 * fixed amount), capped at the fee. Used both to create invoices and to preview
 * a student's monthly fee, so the two can never disagree.
 *
 * `context` (optional, from loadDiscountContext) supplies the lookups already
 * loaded for a batch; without it (or for a student it doesn't cover) they are
 * queried here.
 */
export const computeStudentDiscount = async (studentDoc, original_amount, context = null) => {
  const ctx = context?.students?.has(String(studentDoc._id)) ? context : null;
  const [siblingPct, scholarshipPct] = ctx
    ? [
      studentDoc.familyId ? ctx.siblingPctByFamily.get(String(studentDoc.familyId)) ?? 0 : 0,
      ctx.scholarshipPctByStudent.get(String(studentDoc._id)) ?? 0,
    ]
    : await Promise.all([
      getSiblingDiscountPercent(studentDoc.familyId),
      getActiveScholarshipDiscountPercent(studentDoc._id),
    ]);
  const own = studentDoc.fee_discount;
  const ownPct = own?.kind === 'percent' ? Number(own.value) || 0 : 0;
  const ownAmount = own?.kind === 'amount' ? Number(own.value) || 0 : 0;

  // The school's Discount Policy (Settings): either only the single best
  // discount applies, or all of them add up.
  const rule = ctx
    ? ctx.discountRule
    : (await SystemSetting.findOne().select('discountRule').lean())?.discountRule ?? 'highest_only';
  const round2 = (n) => Math.round(n * 100) / 100;
  let discount_percentage;
  let discount_amount;
  if (rule === 'combined') {
    discount_percentage = Math.min(100, Math.max(0, siblingPct + scholarshipPct + ownPct));
    discount_amount = Math.min(original_amount, round2(original_amount * discount_percentage / 100 + ownAmount));
  } else {
    const bestPct = Math.min(100, Math.max(0, siblingPct, scholarshipPct, ownPct));
    const fromPct = round2(original_amount * bestPct / 100);
    // A fixed-amount discount competes with the best percentage.
    discount_percentage = ownAmount > fromPct ? 0 : bestPct;
    discount_amount = Math.min(original_amount, Math.max(fromPct, ownAmount));
  }
  return {
    discount_percentage,
    discount_amount,
    invoice_amount: Math.max(0, round2(original_amount - discount_amount)),
    parts: { siblingPct, scholarshipPct, ownPct, ownAmount },
  };
};

/**
 * Re-applies a student's discounts to their monthly bills that nobody has paid
 * anything on yet, so a discount or scholarship given mid-month shows on this
 * month's bill too. Bills with any payment keep their amount. Each change posts
 * a small adjusting journal (receivable against scholarship expense) so the
 * ledger still matches the bills.
 */
export const repriceOpenInvoices = async (studentId) => {
  const studentDoc = await Student.findById(studentId);
  if (!studentDoc) return 0;
  const open = await StudentInvoice.find({ student: studentId, status: 'Unpaid', paid_amount: 0, period: { $exists: true } });
  let changed = 0;
  for (const inv of open) {
    const { discount_percentage, discount_amount, invoice_amount } = await computeStudentDiscount(studentDoc, inv.original_amount);
    const diff = Math.round((invoice_amount - inv.invoice_amount) * 100) / 100;
    if (diff === 0) continue;
    inv.discount_percentage = discount_percentage;
    inv.discount_amount = discount_amount;
    inv.invoice_amount = invoice_amount;
    inv.balance = invoice_amount;
    if (invoice_amount === 0) inv.status = 'Paid';
    await inv.save();
    const amount = Math.abs(diff);
    await postJournalEntry({
      referenceType: 'Invoice',
      referenceId: inv._id,
      journalNumber: `JRN-${inv.invoice_no}-ADJ-${Date.now()}`,
      description: `Discount change - ${studentDoc.firstName} ${studentDoc.lastName} (${inv.period})`,
      lines: diff < 0
        ? [{ accountCode: '5100', debit: amount, credit: 0, studentId: studentDoc._id }, { accountCode: '1200', debit: 0, credit: amount, studentId: studentDoc._id }]
        : [{ accountCode: '1200', debit: amount, credit: 0, studentId: studentDoc._id }, { accountCode: '5100', debit: 0, credit: amount, studentId: studentDoc._id }],
    });
    changed += 1;
  }
  return changed;
};

/**
 * Creates one invoice, applying every discount the student qualifies for, and
 * posts its accounting journal. Shared by the one-off invoice endpoints and
 * the monthly fee charge so discounts and numbering only live in one place.
 *
 * Discounts stack: sibling % + scholarship % + the student's own standing
 * discount (Student.fee_discount, a % or a fixed amount), capped at the fee.
 *
 * Options:
 *   period   'YYYY-MM' — set for monthly class fees; one invoice per student per month
 *   class_id the class the student was in when charged, for class reports
 *
 * `preloaded` (optional) lets a batch caller such as the monthly charge skip
 * lookups it has already done; results are identical either way:
 *   feeStructure     the FeeStructure document for fee_struc_no
 *   studentDoc       the Student document for student
 *   discountContext  from loadDiscountContext
 *   accounts         Map accountCode -> ChartOfAccount (resolveAccountsByCode)
 *
 * Throws { statusCode, message } on a known/expected failure.
 */
export const buildInvoiceForStudent = async (
  student,
  fee_struc_no,
  { paid_amount = 0, dueDate, invoice_no, invoice_amount: amountOverride, period, class_id } = {},
  session = null,
  { feeStructure: preFee, studentDoc: preStudent, discountContext, accounts } = {}
) => {
  if (invoice_no) {
    const existing = await StudentInvoice.findOne({ invoice_no });
    if (existing) {
      throw { statusCode: 400, message: 'Invoice number already exists' };
    }
  } else {
    invoice_no = await generateInvoiceNumber();
  }

  const feeStructure = preFee ?? await FeeStructure.findById(fee_struc_no);
  if (!feeStructure) {
    throw { statusCode: 404, message: 'Fee structure not found' };
  }

  const studentDoc = preStudent ?? await Student.findById(student);
  if (!studentDoc) {
    throw { statusCode: 404, message: 'Student not found' };
  }

  const original_amount = amountOverride !== undefined ? amountOverride : feeStructure.amount;
  const { discount_percentage, discount_amount, invoice_amount } = await computeStudentDiscount(studentDoc, original_amount, discountContext);

  const balance = Math.max(0, invoice_amount - paid_amount);
  let status = 'Unpaid';
  if (paid_amount >= invoice_amount || invoice_amount === 0) {
    status = 'Paid';
  } else if (paid_amount > 0) {
    status = 'Partially_Paid';
  }

  const createdInvoiceArray = await StudentInvoice.create([{
    invoice_no,
    student,
    fee_struc_no,
    invoice_amount,
    original_amount,
    discount_percentage,
    discount_amount,
    paid_amount,
    balance,
    status,
    period,
    class_id,
    dueDate: dueDate ? new Date(dueDate) : undefined,
    registerDate: new Date()
  }], { session });
  const createdInvoice = createdInvoiceArray[0];

  const studentName = `${studentDoc.firstName} ${studentDoc.lastName}`;
  try {
    const lines = [];

    // 1. Debit Accounts Receivable (net invoice amount)
    if (invoice_amount > 0) {
      lines.push({ accountCode: '1200', debit: invoice_amount, credit: 0, studentId: studentDoc._id });
    }

    // 2. Debit Scholarship Expense (discount amount)
    if (discount_amount > 0) {
      lines.push({ accountCode: '5100', debit: discount_amount, credit: 0, studentId: studentDoc._id });
    }

    // 3. Credit Tuition Revenue (original gross amount)
    if (original_amount > 0) {
      lines.push({ accountCode: '4000', debit: 0, credit: original_amount, studentId: studentDoc._id });
    }

    if (lines.length >= 2) {
      await postJournalEntry({
        date: new Date(),
        referenceType: 'Invoice',
        referenceId: createdInvoice._id,
        journalNumber: `JRN-${invoice_no}`,
        description: `Student Invoice - ${studentName}${period ? ` (${period})` : ''}`,
        lines,
        session,
        accounts,
      });
    }
  } catch (err) {
    console.error('Error posting journal entry for invoice:', err);
    throw { statusCode: 500, message: 'Failed to post accounting journal entry: ' + err.message };
  }

  return createdInvoice;
};
