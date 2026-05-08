require("dotenv").config();

const { pool } = require("./db");

pool.query("delete from events where name like $1 returning public_id", ["DELETE SMOKE %"])
  .then(result => console.log(JSON.stringify({ deleted: result.rowCount })))
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
