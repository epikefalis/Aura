require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

async function main() {
  const databaseDir = path.join(__dirname, "..", "database");
  const files = fs.readdirSync(databaseDir)
    .filter(file => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(databaseDir, file), "utf8");
    process.stdout.write(`Running ${file}... `);
    await pool.query(sql);
    process.stdout.write("done\n");
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
