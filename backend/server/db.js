import mysql from 'mysql2/promise';
import { config } from './config.js';

// Lazy pool: connections are opened when a query is executed.
const pool = mysql.createPool(config.database);

// Use ? placeholders for values; never concatenate user input into SQL.
export async function query(sql, parameters = []) {
  const [result] = await pool.execute(sql, parameters);
  return result;
}

export async function closeDatabase() {
  await pool.end();
}

export async function transaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work({ query: async (sql, values = []) => (await connection.execute(sql, values))[0] });
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
