import mongoose from 'mongoose';
import User from '../models/User.js';
import Mark from '../models/Mark.js';
import AppliesTo from '../models/AppliesTo.js';
import PaymentMethod from '../models/PaymentMethod.js';
import connectDB from '../config/db.js';
import { SYSTEM_AUDITOR_EMAIL } from '../utils/auditHelper.js';

/*
 * Startup bootstrap — creates only what the app cannot work without. It never
 * creates demo or sample records: classes, students, fees and everything else
 * are entered by the school through the app and live only in the database.
 *
 *  1. The "All Fees" category sibling-discount rules attach to (there is no
 *     screen to create it, and the Parents page needs it to add a rule).
 *  2. A first admin login, but only when the database has no admin at all,
 *     so a fresh install can be signed into. It comes only from ADMIN_EMAIL
 *     and ADMIN_PASSWORD in .env; no login is written in the code. Existing
 *     accounts are never modified.
 *  3. A "Cash" payment method when there is none, so fees can be collected
 *     on day one (more can be added under Fees & Payments → Setup).
 */

// Indexes left behind by older schemas that now break inserts.
export const dropStaleIndexes = async () => {
  const stale = {
    users: ['user_name_1', 'userId_1', 'username_1'],
    students: ['admission_no_1'],
    guardians: ['p_no_1'],
    subjects: ['code_1'],
    // The old marks model was unique on student + subject + term + year. Today's
    // marks don't have those fields, so every second mark looked like a duplicate.
    marks: ['student_1_subject_1_term_1_academicYear_1'],
  };
  for (const [collection, names] of Object.entries(stale)) {
    for (const name of names) {
      await mongoose.connection.db.collection(collection).dropIndex(name).catch(() => {});
    }
  }
  // Marks must follow exactly the current rules (one mark per exam, student and
  // subject); this also drops any other leftover index on the collection.
  await Mark.syncIndexes().catch((err) => console.error('Could not tidy the marks indexes:', err.message));
};

export const ensureFirstAdmin = async () => {
  // The audit system user is an admin record but can never sign in, so it doesn't count.
  if (await User.exists({ role: 'admin', email: { $ne: SYSTEM_AUDITOR_EMAIL } })) return null;

  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('No admin account exists. Set ADMIN_EMAIL and ADMIN_PASSWORD in server/.env and restart to create one.');
    return null;
  }
  if (password.length < 8) {
    console.error('ADMIN_PASSWORD must be at least 8 characters; no admin was created.');
    return null;
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    console.error(`No admin exists, but ${email} is already used by a ${existing.role} account; set a different ADMIN_EMAIL.`);
    return null;
  }

  await User.create({ firstName: 'System', lastName: 'Admin', email, password, role: 'admin' });
  console.log(`Created the first admin account: ${email} (password from ADMIN_PASSWORD in .env)`);
  return email;
};

export const bootstrap = async () => {
  await dropStaleIndexes();
  await AppliesTo.findOneAndUpdate(
    { applies_to_id: 'AT-ALL' },
    { $setOnInsert: { applies_to_id: 'AT-ALL', applies_to_name: 'All Fees', description: 'Applies to every fee type' } },
    { upsert: true }
  );
  await ensureFirstAdmin();
  if (!(await PaymentMethod.exists({}))) {
    await PaymentMethod.create({ payment_method_no: 'PM-CASH', payment_method_name: 'Cash' }).catch(() => {});
  }
};

// Allow running this script directly:  node src/seed/bootstrap.js
if (process.argv[1] && process.argv[1].endsWith('bootstrap.js')) {
  (async () => {
    const connected = await connectDB();
    if (!connected) process.exit(1);
    try {
      await bootstrap();
    } catch (err) {
      console.error('Bootstrap failed:', err.message);
      process.exitCode = 1;
    }
    await mongoose.connection.close();
    process.exit(process.exitCode ?? 0);
  })();
}
