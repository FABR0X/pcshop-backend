const { Pool } = require("pg");
const config = require("../config/env");

const pool = new Pool({
    connectionString: config.database.url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});

// Without a listener, an idle client that the server drops emits an
// 'error' event that would take the whole process down.
pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
});

/**
 * Runs a parameterized query. Never interpolate values into the SQL string:
 * the product name and category come straight from the request body.
 */
function query(text, params) {
    return pool.query(text, params);
}

async function close() {
    await pool.end();
}

module.exports = { pool, query, close };
