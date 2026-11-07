import crypto from 'crypto';
import User from '../models/User.js';
import AuditLog from '../models/auditLog.model.js';
import AuditAction from '../models/auditAction.model.js';
import AuditModule from '../models/auditModule.model.js';

/**
 * Log an audit entry.
 * @param {Object} params
 * @param {string|ObjectId} params.userId - ID of the user performing the action
 * @param {string} params.action - Action name (e.g., 'CREATE', 'UPDATE', 'DELETE')
 * @param {string} params.module - Module name (e.g., 'Student')
 * @param {string} params.recordId - ID of the affected record
 * @param {Object} [params.before] - Snapshot before change
 * @param {Object} [params.after] - Snapshot after change
 * @param {string} params.ip - IP address of the request
 */
/**
 * The user that changes made by the system itself (no one signed in) are
 * logged under. It is only a name in the audit log: it is switched off and has
 * a random password nobody knows, so it can never be used to sign in.
 */
export const SYSTEM_AUDITOR_EMAIL = 'system.auditor@school.com';

const systemAuditor = async () => {
  const existing = await User.findOne({ email: SYSTEM_AUDITOR_EMAIL });
  if (existing) {
    // Older versions created it as a working login with a password in the code: lock it.
    if (existing.status !== false) {
      existing.status = false;
      existing.password = crypto.randomBytes(32).toString('hex');
      existing.refreshTokens = [];
      await existing.save();
    }
    return existing;
  }
  return User.create({
    firstName: 'System',
    lastName: 'Auditor',
    email: SYSTEM_AUDITOR_EMAIL,
    password: crypto.randomBytes(32).toString('hex'),
    role: 'admin',
    status: false,
  });
};

export const logAudit = async ({ userId, action, module, recordId, before, after, ip }) => {
  try {
    let finalUserId = userId;
    if (!finalUserId) {
      finalUserId = (await systemAuditor())._id;
    }
    const normalizedAction = action.toUpperCase();

    // 1. Find or create actionDoc
    let actionDoc = await AuditAction.findOne({ action_name: normalizedAction });
    if (!actionDoc) {
      const lastAction = await AuditAction.findOne().sort({ action_no: -1 }).select('action_no');
      const action_no = lastAction && typeof lastAction.action_no === 'number' ? lastAction.action_no + 1 : 1;
      actionDoc = await AuditAction.create({
        action_no,
        action_name: normalizedAction,
      });
    }

    // 2. Find or create moduleDoc
    let moduleDoc = await AuditModule.findOne({ module_name: module });
    if (!moduleDoc) {
      const lastModule = await AuditModule.findOne().sort({ module_no: -1 }).select('module_no');
      const module_no = lastModule && typeof lastModule.module_no === 'number' ? lastModule.module_no + 1 : 1;
      moduleDoc = await AuditModule.create({
        module_no,
        module_name: module,
      });
    }

    // 3. Get next audit_no
    const lastLog = await AuditLog.findOne().sort({ audit_no: -1 }).select('audit_no');
    const audit_no = lastLog && typeof lastLog.audit_no === 'number' ? lastLog.audit_no + 1 : 1;

    // 4. Create Audit Log
    await AuditLog.create({
      audit_no,
      user_id: finalUserId,
      action_no: actionDoc._id,
      module_no: moduleDoc._id,
      record_id: recordId,
      before_changes: before || null,
      after_changes: after || null,
      ip_address: ip || '127.0.0.1',
    });
  } catch (err) {
    // Logging failure should not break the main request flow
    console.error('Audit logging error:', err);
  }
};
