const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'dialer',
      password: process.env.DB_PASS || 'changeme',
      database: process.env.DB_NAME || 'dialer',
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      timezone: 'Z',
      charset: 'utf8mb4'
    });
    console.log('[DB] Connection pool created');
  }
  return pool;
}

async function query(sql, params = []) {
  const db = getPool();
  // Use query() (text protocol) rather than execute() (prepared statements):
  // mysql2's prepared statements reject `LIMIT ?/OFFSET ?` placeholders on
  // MySQL 8 ("Incorrect arguments to mysqld_stmt_execute"), which broke every
  // paginated list endpoint (leads, calls, dnc, appointments, reports). query()
  // uses the same `?` placeholders with client-side escaping and handles LIMIT.
  const [rows] = await db.query(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function transaction(fn) {
  const db = getPool();
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { getPool, query, queryOne, transaction };
