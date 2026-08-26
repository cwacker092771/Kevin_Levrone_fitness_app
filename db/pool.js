const { Pool } = require("pg");

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
    })
  : new Pool({
      host: process.env.PGHOST || "localhost",
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      database: process.env.PGDATABASE || "levrone_fitness",
      user: process.env.PGUSER || process.env.USER,
      password: process.env.PGPASSWORD || undefined
    });

module.exports = pool;
