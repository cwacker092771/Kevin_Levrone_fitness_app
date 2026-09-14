const { Pool } = require("pg");

// Keep this well under the database's max_connections (RDS db.t4g.micro
// defaults to roughly 100). idleTimeoutMillis lets unused clients disconnect
// instead of holding a server-side slot forever; connectionTimeoutMillis
// fails fast instead of queueing requests when the pool is already maxed out.
const common = {
  max: process.env.PG_POOL_MAX ? parseInt(process.env.PG_POOL_MAX, 10) : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
};

const pool = process.env.DATABASE_URL
  ? new Pool({
      ...common,
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
    })
  : new Pool({
      ...common,
      host: process.env.PGHOST || "localhost",
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      database: process.env.PGDATABASE || "levrone_fitness",
      user: process.env.PGUSER || process.env.USER,
      password: process.env.PGPASSWORD || undefined
    });

// A client sitting idle in the pool can still error out (dropped connection,
// RDS failover/reboot, network blip). Without this listener that error is
// uncaught and crashes the whole process - which, under a process manager
// that auto-restarts, causes a crash loop where each restart opens new
// connections before the last set has been released, and the database's
// max_connections gets exhausted ("too many connections").
pool.on("error", (err) => {
  console.error("Unexpected error on idle database client:", err.message);
});

module.exports = pool;
