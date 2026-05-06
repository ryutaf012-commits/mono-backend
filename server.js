console.log("再起動実行");

const express = require("express");
const cors = require("cors");


//DB関連
const { Pool } = require("pg")
// 環境変数接続
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});
// DBファイル作成（なければ自動作成）
// const db = new sqlite3.Database("./monos.db");

// db.serialize(() => {

//   //項目のDB
//   db.run(`
//     CREATE TABLE IF NOT EXISTS monos (
//       id INTEGER PRIMARY KEY AUTOINCREMENT,
//       text TEXT,
//       category TEXT,
//       sort INTEGER,
//       detail TEXT
//     )
//   `);

//   //カテゴリーのDB
//   db.run(`
//     CREATE TABLE IF NOT EXISTS categories (
//       id INTEGER PRIMARY KEY AUTOINCREMENT,
//       name TEXT,
//       sort INTEGER
//     )
//   `);

// });


async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monos (
      id SERIAL PRIMARY KEY,
      text TEXT,
      category TEXT,
      sort INTEGER,
      detail TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT,
      sort INTEGER
    )
  `);
}

initDB();



//デフォルトのカテゴリー
const defaultCategories = ["未分類", "日用品", "調味料", "野菜"];

async function insertDefaultCategories() {
  for (const [index, name] of defaultCategories.entries()) {

    // 既に存在するか確認
    const exists = await pool.query(
      "SELECT * FROM categories WHERE name = $1",
      [name]
    );

    // 無ければ追加
    if (exists.rows.length === 0) {
      await pool.query(
        "INSERT INTO categories (name, sort) VALUES ($1, $2)",
        [name, index]
      );
    }
  }
}

insertDefaultCategories();

const app = express();

app.use(cors());
app.use(express.json());


// ① POST（追加）
app.post("/api/monos", async (req, res) => {
  try {
    const { text, category, detail } = req.body;

    // 現在の最大sort取得
    const maxResult = await pool.query(
      "SELECT MAX(sort) as max FROM monos"
    );

    const nextSort = (maxResult.rows[0].max || 0) + 1;

    // INSERT
    const result = await pool.query(
      `
      INSERT INTO monos (text, category, sort, detail)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [text, category, nextSort, detail || ""]
    );

    // 追加したデータ返却
    res.json(result.rows[0]);

  } catch (err) {
    res.status(500).send(err);
  }
});

// ② GET（取得） 
app.get("/api/monos", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM monos ORDER BY sort ASC"
    );

    res.json(result.rows);

  } catch (err) {
    res.status(500).send(err);
  }
});

//削除
app.delete("/api/monos/:id", async (req, res) => {
  try {
    const id = req.params.id;

    await pool.query(
      "DELETE FROM monos WHERE id = $1",
      [id]
    );

    res.json({ message: "削除OK" });

  } catch (err) {
    res.status(500).send(err);
  }
});


//順番変更
app.put("/api/monos/reorder", async (req, res) => {
  try {
    const { items } = req.body;

    for (const item of items) {
      await pool.query(
        "UPDATE monos SET sort = $1 WHERE id = $2",
        [item.sort, item.id]
      );
    }

    res.json({ message: "Mono順番更新OK" });

  } catch (err) {
    res.status(500).send(err);
  }
});

//完了
app.put("/api/monos/:id", async (req, res) => {
  try {
    console.log("受信データ:", req.body);

    const id = req.params.id;
    const { text, category, detail } = req.body;

    await pool.query(
      `
      UPDATE monos
      SET text = $1,
          category = $2,
          detail = $3
      WHERE id = $4
      `,
      [text, category, detail, id]
    );

    res.json({ message: "更新OK" });

  } catch (err) {
    res.status(500).send(err);
  }
});


//順番整理
async function normalizeMonoSort() {
  try {
    const result = await pool.query(
      "SELECT id FROM monos ORDER BY sort ASC"
    );

    for (const [index, row] of result.rows.entries()) {
      await pool.query(
        "UPDATE monos SET sort = $1 WHERE id = $2",
        [index, row.id]
      );
    }

  } catch (err) {
    console.error(err);
  }
}

normalizeMonoSort();

// カテゴリーの取得
//カテゴリーの順番の取得
app.get("/api/categories", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM categories ORDER BY sort ASC"
    );

    res.json(result.rows);

  } catch (err) {
    res.status(500).send(err);
  }
});

//カテゴリーの順番を記録
app.put("/api/categories/reorder", async (req, res) => {
  try {
    const { items } = req.body;

    for (const item of items) {
      await pool.query(
        "UPDATE categories SET sort = $1 WHERE id = $2",
        [item.sort, item.id]
      );
    }

    res.json({ message: "並び順更新OK" });

  } catch (err) {
    res.status(500).send(err);
  }
});


//カテゴリー編集
app.put("/api/categories/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { name: newName } = req.body;

    // 元のカテゴリー名取得
    const result = await pool.query(
      "SELECT name FROM categories WHERE id = $1",
      [id]
    );

    const oldName = result.rows[0].name;

    // categories更新
    await pool.query(
      "UPDATE categories SET name = $1 WHERE id = $2",
      [newName, id]
    );

    // monos側も更新
    await pool.query(
      "UPDATE monos SET category = $1 WHERE category = $2",
      [newName, oldName]
    );

    res.json({ message: "更新OK" });

  } catch (err) {
    res.status(500).send(err);
  }
});

// カテゴリーの追加
app.post("/api/categories", async (req, res) => {
  try {
    const { name } = req.body;

    // 現在の最大sort取得
    const maxResult = await pool.query(
      "SELECT MAX(sort) as max FROM categories"
    );

    const nextSort = (maxResult.rows[0].max || 0) + 1;

    // INSERT
    const result = await pool.query(
      `
      INSERT INTO categories (name, sort)
      VALUES ($1, $2)
      RETURNING *
      `,
      [name, nextSort]
    );

    res.json(result.rows[0]);

  } catch (err) {
    res.status(500).send(err);
  }
});

// カテゴリー削除
app.delete("/api/categories/:id", async (req, res) => {
  try {
    const id = req.params.id;

    // カテゴリー取得
    const result = await pool.query(
      "SELECT name FROM categories WHERE id = $1",
      [id]
    );

    const categoryName = result.rows[0].name;

    // 未分類は削除禁止
    if (categoryName === "未分類") {
      return res.status(400).json({
        message: "未分類は削除できません"
      });
    }

    // カテゴリー削除
    await pool.query(
      "DELETE FROM categories WHERE id = $1",
      [id]
    );

    // monos側を未分類へ
    await pool.query(
      "UPDATE monos SET category = '未分類' WHERE category = $1",
      [categoryName]
    );

    res.json({ message: "削除OK" });

  } catch (err) {
    res.status(500).send(err);
  }
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  await initDB();
  await insertDefaultCategories();
  await normalizeMonoSort();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
