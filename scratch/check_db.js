require("dotenv").config({ path: ".env" })
const mysql = require("mysql2/promise")

async function run() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    charset: "utf8mb4",
  })
  try {
    const [rows] = await pool.query("SELECT * FROM forum_categories")
    console.log("Categories:", rows)
  } catch (err) {
    console.error("DB Error:", err)
  }
  process.exit(0)
}

run()
