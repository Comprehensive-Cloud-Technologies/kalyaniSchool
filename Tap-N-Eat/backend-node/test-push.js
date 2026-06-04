const http = require('http');

// 1. Test the push-tokens endpoint
const body = JSON.stringify({
  email: 'test@test.com',
  push_token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'
});

const req = http.request({
  host: 'localhost',
  port: 5000,
  path: '/api/push-tokens',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);

    // 2. Check DB for the inserted row
    const { execSync } = require('child_process');
    try {
      const result = execSync(
        "mysql -utapneat -pTapNeat2026! qsr_system -e \"SELECT id,parent_email,push_token,is_active FROM parent_push_tokens;\""
      ).toString();
      console.log('\nDB rows:');
      console.log(result || '(empty)');
    } catch (e) {
      console.error('DB check error:', e.message);
    }
  });
});

req.on('error', (e) => console.error('Request error:', e.message));
req.write(body);
req.end();
