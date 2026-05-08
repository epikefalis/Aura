require("dotenv").config();

const { pool } = require("./db");
const { createToken, verifyPassword } = require("./auth");

pool.query(
  "select id,email,display_name,password_hash,role,is_active from app_users where email=$1",
  ["admin@oneonly.local"]
).then(result => {
  const user = result.rows[0];
  console.log(JSON.stringify({
    found: Boolean(user),
    active: user && user.is_active,
    passwordOk: user && verifyPassword("admin123", user.password_hash),
    tokenCreated: user ? Boolean(createToken(user)) : false
  }));
}).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
