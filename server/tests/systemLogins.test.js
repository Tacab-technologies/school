import request from 'supertest';
import app from '../src/server.js';
import User from '../src/models/User.js';
import { logAudit, SYSTEM_AUDITOR_EMAIL } from '../src/utils/auditHelper.js';
import { ensureFirstAdmin } from '../src/seed/bootstrap.js';

// No login is written in the code: the first admin comes only from .env, and
// the audit system user can never be used to sign in.
describe('Built-in logins', () => {
  const saved = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
  const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

  beforeEach(async () => {
    await User.deleteMany({ role: 'admin' });
  });

  afterAll(async () => {
    process.env.ADMIN_EMAIL = saved.email;
    process.env.ADMIN_PASSWORD = saved.password;
    await User.deleteMany({ email: { $in: [SYSTEM_AUDITOR_EMAIL, 'first.admin@env.test', 'admin@gmail.com'] } });
  });

  it('creates no admin when .env has no ADMIN_EMAIL / ADMIN_PASSWORD', async () => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    expect(await ensureFirstAdmin()).toBeNull();
    expect(await User.exists({ role: 'admin' })).toBeNull();
    // The old built-in fallback is gone.
    expect((await login('admin@gmail.com', 'admin')).status).not.toBe(200);
  });

  it('creates the first admin from .env, and refuses a short password', async () => {
    process.env.ADMIN_EMAIL = 'first.admin@env.test';
    process.env.ADMIN_PASSWORD = 'short';
    expect(await ensureFirstAdmin()).toBeNull();

    process.env.ADMIN_PASSWORD = 'a-long-env-password';
    expect(await ensureFirstAdmin()).toBe('first.admin@env.test');
    expect((await login('first.admin@env.test', 'a-long-env-password')).status).toBe(200);
  });

  it('still creates the first admin when only the audit system user exists', async () => {
    await logAudit({ action: 'CREATE', module: 'Test', recordId: 'x' });
    process.env.ADMIN_EMAIL = 'first.admin@env.test';
    process.env.ADMIN_PASSWORD = 'a-long-env-password';
    expect(await ensureFirstAdmin()).toBe('first.admin@env.test');
  });

  it('the audit system user is switched off and its old coded password no longer works', async () => {
    // As older versions created it: an active admin with a password in the code.
    await User.deleteMany({ email: SYSTEM_AUDITOR_EMAIL });
    await User.create({ firstName: 'System', lastName: 'Auditor', email: SYSTEM_AUDITOR_EMAIL, password: 'system_secure_password_12345', role: 'admin', status: true });
    expect((await login(SYSTEM_AUDITOR_EMAIL, 'system_secure_password_12345')).status).toBe(200);

    await logAudit({ action: 'UPDATE', module: 'Test', recordId: 'y' });
    const auditor = await User.findOne({ email: SYSTEM_AUDITOR_EMAIL }).lean();
    expect(auditor.status).toBe(false);
    expect((await login(SYSTEM_AUDITOR_EMAIL, 'system_secure_password_12345')).status).not.toBe(200);
  });
});
