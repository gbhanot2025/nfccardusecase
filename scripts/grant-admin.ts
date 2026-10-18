// Usage: npm run admin:grant -- someone@example.com
// Gives an existing, verified user the admin role. Run on the server; there is no web UI for this on purpose.
import "dotenv/config";
import { Client } from "pg";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: npm run admin:grant -- <email>");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE "user" SET role = 'admin' WHERE lower(email) = $1 AND email_verified = true RETURNING id`,
      [email],
    );
    if (result.rowCount === 0) throw new Error("No verified user with that email");
    await client.query(
      `INSERT INTO audit_log (action, target_type, target_id, metadata) VALUES ('admin.granted', 'user', $1, '{"via":"cli"}')`,
      [result.rows[0].id],
    );
    console.log("Admin role granted.");
  } finally {
    await client.end();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
