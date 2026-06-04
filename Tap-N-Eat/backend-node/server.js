// Load .env: prefer a file in the same directory (tapneat/.env), fallback to parent
const path = require('path');
const fs   = require('fs');
const localEnv  = path.join(__dirname, '.env');
const parentEnv = path.join(__dirname, '../.env');
require('dotenv').config({ path: fs.existsSync(localEnv) ? localEnv : parentEnv });

const express = require('express');
const cors    = require('cors');
const app     = express();

app.use(cors());
// Raised limit so base64 logo uploads (up to a few MB) fit in JSON bodies
app.use(express.json({ limit: '10mb' }));

// Simple request logger — logs METHOD + path to stdout (visible in pm2 logs)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Serve uploaded files (school logos etc.)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// ── Routes ───────────────────────────────────────────────
app.use('/api/employees',           require('./routes/employees'));
app.use('/api/masters',             require('./routes/masters'));
app.use('/api/meal-categories',     require('./routes/meal-categories'));
app.use('/api/meal-plan-subscriptions', require('./routes/meal-plan-subscriptions'));
app.use('/api/meal-slots',          require('./routes/meal-slots'));
app.use('/api/monthly-meal-plans',  require('./routes/monthly-meal-plans'));
app.use('/api/parent-portal',       require('./routes/parent-portal'));
app.use('/api/print-queue',         require('./routes/print-queue'));
app.use('/api/print-receipt',       require('./routes/print-receipt'));
app.use('/api/print-thermal',       require('./routes/print-thermal'));
app.use('/api/print-thermal-debug', require('./routes/print-thermal-debug'));
app.use('/api/printer-diagnostic',  require('./routes/printer-diagnostic'));
app.use('/api/printer-test',        require('./routes/printer-test'));
app.use('/api/razorpay-create-order', require('./routes/razorpay-create-order'));
app.use('/api/razorpay-verify',     require('./routes/razorpay-verify'));
app.use('/api/reports',             require('./routes/reports'));
app.use('/api/rfid-scan',           require('./routes/rfid-scan'));
app.use('/api/school-auth',         require('./routes/school-auth'));
app.use('/api/schools',             require('./routes/schools'));
app.use('/api/transactions',        require('./routes/transactions'));
app.use('/api/tuckshop',            require('./routes/tuckshop'));
app.use('/api/wallet-recharge-verify', require('./routes/wallet-recharge-verify'));
app.use('/api/wallet-recharge',     require('./routes/wallet-recharge'));
app.use('/api/permissions',         require('./routes/permissions'));
app.use('/api/school-roles',        require('./routes/school-roles'));
app.use('/api/push-tokens',         require('./routes/push-tokens'));

// ── Health check ─────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Razorpay public key (key_id only — never expose key_secret) ───────────
app.get('/api/razorpay-config', (_req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) return res.status(500).json({ error: 'Razorpay not configured on server' });
  res.json({ key_id: keyId });
});

// ── Deploy webhook (GitHub Actions calls this to self-update) ─────────────
app.post('/api/deploy', (req, res) => {
  const secret = process.env.DEPLOY_SECRET;
  if (!secret || req.headers['x-deploy-secret'] !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { exec } = require('child_process');
  const homeDir = process.env.HOME || '/home/ec2-user';
  const srcDir  = `${homeDir}/tapneat_src`;
  const appDir  = `${homeDir}/tapneat`;
  const wwwDir  = '/var/www/tapneat';

  // Respond immediately so the HTTP connection closes before PM2 restarts this process
  res.json({ status: 'deploying', message: 'Deploy started — check pm2 logs for progress' });

  const razorpayKeyId     = process.env.RAZORPAY_KEY_ID     || 'rzp_test_SV4dT3pK23zxSP';
  const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || 'qrwjRbq2k7fLO8ovePl2yxju';

  const cmd = [
    // 1. Pull latest code
    `git -C ${srcDir} pull origin main`,

    // 2. Sync backend; preserve .env and the uploads/ directory on server
    //    (uploads/ holds runtime-generated school logos — must survive redeploys)
    `rsync -a --delete --exclude=node_modules --exclude=.env --exclude=uploads ${srcDir}/backend-node/ ${appDir}/`,
    `cd ${appDir} && npm install --omit=dev`,

    // 3. Patch Razorpay keys in the server-side .env
    `grep -q '^RAZORPAY_KEY_ID=' ${appDir}/.env && sed -i 's|^RAZORPAY_KEY_ID=.*|RAZORPAY_KEY_ID=${razorpayKeyId}|' ${appDir}/.env || echo 'RAZORPAY_KEY_ID=${razorpayKeyId}' >> ${appDir}/.env`,
    `grep -q '^RAZORPAY_KEY_SECRET=' ${appDir}/.env && sed -i 's|^RAZORPAY_KEY_SECRET=.*|RAZORPAY_KEY_SECRET=${razorpayKeySecret}|' ${appDir}/.env || echo 'RAZORPAY_KEY_SECRET=${razorpayKeySecret}' >> ${appDir}/.env`,

    // 4. Build frontend on EC2 with the Razorpay public key baked in
    `cd ${srcDir} && npm install --legacy-peer-deps --prefer-offline 2>/dev/null || npm install --legacy-peer-deps`,
    `cd ${srcDir} && VITE_RAZORPAY_KEY_ID=${razorpayKeyId} npm run build`,

    // 5. Deploy built frontend
    `sudo rsync -a --delete ${srcDir}/dist/ ${wwwDir}/`,

    // 6. Restart backend (--update-env loads new .env values)
    `pm2 restart tapneat-api --update-env`,
  ].join(' && ');

  exec(cmd, { timeout: 300000 }, (err, stdout, stderr) => {
    const ts = new Date().toISOString();
    if (err) console.error(`[deploy ${ts}] error:`, err.message);
    if (stdout) console.log(`[deploy ${ts}] stdout:`, stdout.slice(0, 500));
    if (stderr) console.log(`[deploy ${ts}] stderr:`, stderr.slice(0, 200));
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));

// ── Prevent unhandled promise rejections from crashing PM2 ───────────────
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] Caught — process kept alive:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] Caught — process kept alive:', err.message);
});
