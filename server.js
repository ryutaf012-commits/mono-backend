console.log("再起動実行");

const express = require("express");
const cors = require("cors");


//SQlite関連
const sqlite3 = require("sqlite3").verbose();
// DBファイル作成（なければ自動作成）
const db = new sqlite3.Database("./monos.db");

db.serialize(() => {

  //項目のDB
  db.run(`
    CREATE TABLE IF NOT EXISTS monos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT,
      category TEXT,
      sort INTEGER,
      detail TEXT
    )
  `);

  //カテゴリーのDB
  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      sort INTEGER
    )
  `);

});
//デフォルトのカテゴリー
const defaultCategories = ["未分類", "日用品", "調味料", "野菜"];

defaultCategories.forEach((name, index) => {
  db.get(
    "SELECT COUNT(*) as count FROM categories WHERE name = ?",
    [name],
    (err, row) => {
      if (row.count === 0) {
        db.run(
          "INSERT INTO categories (name, sort) VALUES (?, ?)",
          [name, index] // 順番もここで決める
        );
      }
    }
  );
});
const app = express();

app.use(cors());
app.use(express.json());


// ① POST（追加）
app.post("/api/monos", (req, res) => {
  const { text, category,detail } = req.body;

  db.get("SELECT MAX(sort) as max FROM monos", (err, row) => {
    const nextSort = (row.max || 0) + 1;

    db.run(
      "INSERT INTO monos (text, category, sort, detail) VALUES (?, ?, ?, ?)",
  [text, category, nextSort, detail || ""],
      function (err) {
        if (err) return res.status(500).send(err);

        res.json({
          id: this.lastID,
          text,
          category,
          sort: nextSort
        });
      }
    );
  });
});

// ② GET（取得） 
app.get("/api/monos", (req, res) => {
  db.all("SELECT * FROM monos ORDER BY sort ASC", [], (err, rows) => {
    if (err) return res.status(500).send(err);

    res.json(rows);
  });
});

//削除
app.delete("/api/monos/:id", (req, res) => {
  const id = req.params.id;
  db.run("DELETE FROM monos WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).send(err);
    res.json({ message: "削除OK" });
  });
});


//順番変更
app.put("/api/monos/reorder", (req, res) => {
  const { items } = req.body;

  const stmt = db.prepare("UPDATE monos SET sort = ? WHERE id = ?");

  items.forEach((item) => {
    stmt.run(item.sort, item.id);
  });

  stmt.finalize();

  res.json({ message: "Mono順番更新OK" });
});

//完了
app.put("/api/monos/:id", (req, res) => {
  console.log("受信データ:", req.body);

  const id = req.params.id;
  const { text, category, detail } = req.body;

  db.run(
    "UPDATE monos SET text=?, category=?, detail=? WHERE id=?",
    [text, category, detail, id],
    (err) => {
      if (err) return res.status(500).send(err);
      res.json({ message: "更新OK" });
    }
  );
});


//順番整理
db.all("SELECT id FROM monos ORDER BY sort ASC", (err, rows) => {
  const stmt = db.prepare("UPDATE monos SET sort = ? WHERE id = ?");

  rows.forEach((row, index) => {
    stmt.run(index, row.id);
  });

  stmt.finalize();
});

// カテゴリーの取得
//カテゴリーの順番の取得
app.get("/api/categories", (req, res) => {
  db.all("SELECT * FROM categories ORDER BY sort ASC", [], (err, rows) => {
    res.json(rows);
  });
});

//カテゴリーの順番を記録
app.put("/api/categories/reorder", (req, res) => {
  const { items } = req.body; // [{id, sort}]

  const stmt = db.prepare("UPDATE categories SET sort = ? WHERE id = ?");

  items.forEach((item) => {
    stmt.run(item.sort, item.id);
  });

  stmt.finalize();

  res.json({ message: "並び順更新OK" });
});


//カテゴリー編集
app.put("/api/categories/:id", (req, res) => {
  const id = req.params.id;
  const { name: newName } = req.body;

  // まず元の名前を取得
  db.get("SELECT name FROM categories WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).send(err);

    const oldName = row.name;

    //categories更新
    db.run(
      "UPDATE categories SET name = ? WHERE id = ?",
      [newName, id],
      (err) => {
        if (err) return res.status(500).send(err);

        db.run(
          "UPDATE monos SET category = ? WHERE category = ?",
          [newName, oldName],
          (err) => {
            if (err) return res.status(500).send(err);

            res.json({ message: "更新OK" });
          }
        );
      }
    );
  });
});

// カテゴリーの追加
app.post("/api/categories", (req, res) => {
  const { name } = req.body;

  db.get("SELECT MAX(sort) as max FROM categories", (err, row) => {
    if (err) return res.status(500).send(err);

    const nextSort = (row.max || 0) + 1;

    db.run(
      "INSERT INTO categories (name, sort) VALUES (?, ?)",
      [name, nextSort],
      function (err) {
        if (err) return res.status(500).send(err);

        res.json({
          id: this.lastID,
          name,
          sort: nextSort
        });
      }
    );
  });
});

// カテゴリー削除
app.delete("/api/categories/:id", (req, res) => {
  const id = req.params.id;

  db.get("SELECT name FROM categories WHERE id = ?", [id], (err, row) => {
    if (row.name === "未分類") {
      return res.status(400).json({ message: "未分類は削除できません" });
    }

    const categoryName = row.name;

    db.run("DELETE FROM categories WHERE id = ?", [id]);
    db.run(
      "UPDATE monos SET category = '未分類' WHERE category = ?",
      [categoryName]
    );

    res.json({ message: "削除OK" });
  });
});


// 最後に起動
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

