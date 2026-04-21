const { Client } = require('pg');
const bcrypt = require('bcrypt');

async function main() {
  const client = new Client({
    user: 'sikdorak_app',
    host: '127.0.0.1',
    database: 'sikdorak',
    password: 'sikdorak_password',
    port: 5432,
  });
  await client.connect();
  const hash = await bcrypt.hash('1234', 12);
  const isValid = await bcrypt.compare('1234', hash);
  console.log('hash:', hash);
  console.log('compare result:', isValid);
  if (!isValid) {
    throw new Error('bcrypt.compare failed for generated hash');
  }
  const res = await client.query(
    'UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING id, username, password_hash',
    [hash, 'deamon']
  );
  console.log(res.rows);
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
