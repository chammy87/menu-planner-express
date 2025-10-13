// index.js (ESM)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// 追加：ホーム/ショートカットのルーティング
app.get("/", (_req, res) => {
  // public/home.html があればホーム、なければ既存 index.html（献立）へ
  res.sendFile("home.html", { root: "public" }, (err) => {
    if (err) res.sendFile("index.html", { root: "public" });
  });
});
app.get("/menu", (_req, res) => res.sendFile("index.html", { root: "public" }));   // 献立
app.get("/recipe", (_req, res) => res.sendFile("recipe.html", { root: "public" })); // 単品レシピ

if (!process.env.OPENAI_API_KEY) {
  console.error("⚠️ OPENAI_API_KEY is missing.");
}
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ===========================
   食材グループとエイリアス
=========================== */
const ingredientCategories = {
  vegetables: {
    "キャベツ": ["白菜","レタス","小松菜","ほうれん草","チンゲン菜","水菜"],
    "白菜": ["キャベツ","レタス","小松菜","ほうれん草","チンゲン菜"],
    "にんじん": ["大根","かぶ","かぼちゃ","パプリカ"],
    "じゃがいも": ["さつまいも","長芋","かぼちゃ"],
    "玉ねぎ": ["長ねぎ","ニラ","エシャロット"],
    "ブロッコリー": ["カリフラワー","スナップエンドウ","アスパラガス"],
    "ピーマン": ["パプリカ","ズッキーニ","なす"],
  },
  meats: {
    "鶏肉": ["豚肉","牛肉","ひき肉"],
    "豚肉": ["鶏肉","牛肉","ひき肉"],
    "牛肉": ["鶏肉","豚肉","ひき肉"],
    "ひき肉": ["鶏肉","豚肉","牛肉"],
  },
  fish: {
    "鮭": ["鯖","タラ","サワラ"],
    "鯖": ["鮭","タラ","サワラ"],
    "タラ": ["鮭","鯖","サワラ"],
    "サワラ": ["鮭","鯖","タラ"],
  },
  protein: {
    "卵": ["豆腐","厚揚げ","油揚げ"],
    "豆腐": ["厚揚げ","油揚げ","卵"],
    "厚揚げ": ["豆腐","油揚げ","卵"],
  },
};

// 主食は同日重複OK
const stapleFoods = [
  "ご飯","白米","玄米","ライス",
  "パン","食パン","トースト","サンドイッチ","ホットサンド",
  "うどん","そば","そうめん","パスタ","スパゲッティ","ラーメン","中華麺",
  "おにぎり","チャーハン","焼きそば","グラノーラ"
];

// 料理語（1語名詞を避けるための判定に使用）
const cookWordRe = /(焼|炒|煮|蒸|揚|和え|漬|茹|炊|混|とじ|オムレツ|グラタン|カレー|チャーハン|丼|定食|サンド|トースト|パスタ|スパゲ|うどん|そば|ラーメン|粥|雑炊|おにぎり|味噌汁|スープ)/;

// エイリアス → 正規化
const aliases = {
  "鶏": "鶏肉",
  "豚": "豚肉",
  "牛": "牛肉",
  "サーモン": "鮭",
  "さば": "鯖",
  "サバ": "鯖",
  "ツナ": "ツナ",
};
const canon = (t = "") => aliases[t] || t;

/* ===========================
   ユーティリティ
=========================== */
const normalize = (s) =>
  String(s || "").trim().toLowerCase().replace(/\s+/g, "").replace(/[（）()　]/g, "");

function extractFirstJson(text) {
  text = String(text || "").replace(/```json/g, "```").trim();
  const fence = text.match(/```([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const i = text.indexOf("{"); const j = text.lastIndexOf("}");
  return (i >= 0 && j > i) ? text.slice(i, j + 1) : text;
}

async function callModel(prompt, { temperature = 0.7 } = {}) {
  const r = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature, top_p: 0.95, presence_penalty: 0.2, frequency_penalty: 0.2
  });
  return r.choices?.[0]?.message?.content ?? "";
}

// 名詞1語か？
const isGenericName = (name = "") => {
  const n = String(name).trim();
  return !!n && /^[^\s]+$/.test(n) && !cookWordRe.test(n);
};

// 朝食名詞1語 → 料理化
const upgradeBreakfast = (name = "") => (isGenericName(name) ? `${name}の卵とじ` : name);

// 正規表現エスケープ
const escapeReg = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 変な組み合わせ矯正
function sanitizeMeal(name = "", mealType = "") {
  let n = String(name || "").replace(/\s+/g, " ").trim();

  const badSoup = /(オムレツ|パンケーキ|ヨーグルト|ケーキ|プリン|パフェ|サンド|丼|定食)/;
  if (/(味噌汁|スープ)/.test(n) && badSoup.test(n)) n = "豆腐とわかめの味噌汁";
  if (/卵とじ/.test(n) && /(ヨーグルト|フルーツ|パンケーキ)/.test(n)) n = "ほうれん草の卵とじ";

  if (
    mealType === "昼食" &&
    !/(ご飯|ライス|丼|パン|サンド|トースト|うどん|そば|そうめん|パスタ|スパゲッティ|スパゲティ|ラーメン|焼きそば|チャーハン|麺)/.test(n)
  ) n = `${n}とご飯`;

  if (mealType === "夕食" && !/(鶏|豚|牛|鮭|鯖|タラ|サワラ|魚|卵|豆腐|厚揚げ|ツナ)/.test(n))
    n = `${n}／鶏の照り焼き`;

  if (mealType === "朝食" && /^[^\s]+$/.test(n) && !/(汁|スープ|丼|サンド|トースト|粥|雑炊)/.test(n))
    n = `${n}の卵とじ`;

  n = n.replace(/(鮭|鯖|タラ|サワラ)の油揚げ/g, "$1の塩焼き");
  n = n.replace(/(スパゲ(?:ッティ|ティ)?|パスタ)[^、。]*?とご飯/g, "$1");
  n = n.replace(/(サンド[イィ]ッチ|トースト)[^、。]*?とご飯/g, "$1");
  return n;
}

const splitTokens = (s) =>
  String(s || "")
    .replace(/[（(）)［\]｛｝【】]/g, " ")
    .replace(/[：:／/]/g, " ")
    .split(/(?:と|の|・|、|,|\s+)/)
    .filter(Boolean);

/* ===========================
   重複回避（同日・前日） + 近縁置換
=========================== */
function getReplacement(tok) {
  const pool = { ...ingredientCategories.meats, ...ingredientCategories.fish, ...ingredientCategories.vegetables, ...ingredientCategories.protein };
  const base = pool[canon(tok)];
  if (base?.length) return base[Math.floor(Math.random() * base.length)];
  const fallbacks = ["ほうれん草", "小松菜", "白菜", "鶏肉", "豚肉", "鮭", "豆腐"];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

function filterMenu(menu) {
  let prevDaySet = new Set();

  return (menu || []).map(day => {
    const usedToday = new Set();
    const mealsOut = {};

    for (const [meal, raw] of Object.entries(day.meals || {})) {
      let dish = String(raw || "");
      dish = sanitizeMeal(dish, meal);

      for (const t0 of splitTokens(dish)) {
        const t = canon(t0);
        if (stapleFoods.some(k => t.includes(k))) continue;
        if (usedToday.has(t) || prevDaySet.has(t)) {
          const rep = getReplacement(t);
          if (rep && rep !== t) dish = dish.replace(new RegExp(escapeReg(t0), "g"), rep);
          usedToday.add(canon(rep));
        } else {
          usedToday.add(t);
        }
      }
      mealsOut[meal] = dish;
    }

    prevDaySet = new Set(
      [...usedToday].filter(t => !stapleFoods.some(k => t.includes(k)))
    );

    return { ...day, meals: mealsOut };
  });
}

/* ===========================
   食材カテゴリマップ（買い物用）
=========================== */
const ingredientToCategory = (() => {
  const map = {};
  Object.keys(ingredientCategories.vegetables).forEach(k => (map[k] = "野菜・果物"));
  ["鶏肉","豚肉","牛肉","ひき肉","卵","豆腐","厚揚げ","油揚げ","鮭","鯖","タラ","サワラ","ツナ"]
    .forEach(k => (map[k] = "肉・魚・卵・乳製品"));
  stapleFoods.forEach(k => (map[k] = "穀物・麺類・パン"));
  map["鶏"] = "肉・魚・卵・乳製品";
  map["豚"] = "肉・魚・卵・乳製品";
  map["牛"] = "肉・魚・卵・乳製品";
  map["サーモン"] = "肉・魚・卵・乳製品";
  map["サバ"] = "肉・魚・卵・乳製品";
  map["さば"] = "肉・魚・卵・乳製品";
  return map;
})();

/* ===========================
   料理名から既知食材を検出
=========================== */
const BOUNDARY = "[^\\u4E00-\\u9FFF\\u3040-\\u309F\\u30A0-\\u30FFA-Za-z0-9]";
function detectCoreIngredients(name = "") {
  const src = String(name || "");
  const found = new Set();

  const keys = new Set([
    ...Object.keys(ingredientToCategory),
    ...stapleFoods,
    ...Object.keys(aliases),
    "鶏","豚","牛","卵","豆腐","厚揚げ","油揚げ","鮭","鯖","タラ","サワラ","ツナ",
  ]);

  keys.forEach(k => {
    if (!k) return;
    if (k.length === 1) {
      const rx = new RegExp(`(?:^|${BOUNDARY})${escapeReg(k)}(?:$|${BOUNDARY})`, "u");
      if (rx.test(src)) found.add(canon(k));
    } else {
      if (src.includes(k)) found.add(canon(k));
    }
  });

  // 誤検出の後処理
  if (src.includes("牛乳")) found.delete("牛肉");
  if (src.includes("鶏ガラ")) found.delete("鶏肉");
  if (src.includes("豚骨")) found.delete("豚肉");

  return [...found];
}

/* ===========================
   買い物リストユーティリティ
=========================== */
function stripAvailableFromShoppingList(shoppingList, availableList) {
  if (!shoppingList) return {};
  const avail = new Set(
    (availableList || [])
      .map(x => normalize(x))
      .filter(Boolean)
      .filter(x => x.length >= 2)
  );
  const out = {};
  for (const [cat, items] of Object.entries(shoppingList)) {
    out[cat] = (items || []).filter(x => {
      const n = normalize(x);
      for (const a of avail) if (a && n.includes(a)) return false;
      return true;
    });
  }
  return out;
}

// 主食トークン抽出
function pickStapleFrom(token = "") {
  return stapleFoods.find(k => token.includes(k)) || null;
}

// 主たんぱく質の正規化
function normalizeProteinToken(token = "") {
  if (/鶏|チキン/.test(token)) return "鶏肉";
  if (/豚/.test(token)) return "豚肉";
  if (/牛(?!乳)/.test(token)) return "牛肉";
  if (/鮭|サーモン/.test(token)) return "鮭";
  if (/鯖|サバ|さば/.test(token)) return "鯖";
  if (/タラ/.test(token)) return "タラ";
  if (/サワラ/.test(token)) return "サワラ";
  if (/ツナ/.test(token)) return "ツナ";
  if (/卵|玉子/.test(token)) return "卵";
  if (/豆腐/.test(token)) return "豆腐";
  if (/厚揚げ/.test(token)) return "厚揚げ";
  if (/油揚げ/.test(token)) return "油揚げ";
  return null;
}

// メニューから買い物リスト復元
function ensureShoppingFromMenu(menu = [], shopping = {}) {
  const cats = ["野菜・果物","肉・魚・卵・乳製品","穀物・麺類・パン","調味料・油","その他"];
  cats.forEach(c => (shopping[c] = Array.isArray(shopping[c]) ? shopping[c] : []));
  const seen = {};
  cats.forEach(c => (seen[c] = new Set((shopping[c] || []).map(x => x.trim().toLowerCase()))));

  for (const day of (menu || [])) {
    for (const meal of ["朝食","昼食","夕食"]) {
      const name = String(day?.meals?.[meal] || "");
      const toks = new Set(splitTokens(name));
      detectCoreIngredients(name).forEach(t => toks.add(t));

      for (let t0 of toks) {
        let t = canon(t0);
        let cat = ingredientToCategory[t];

        if (!cat) {
          const staple = pickStapleFrom(t);
          if (staple) { t = staple; cat = "穀物・麺類・パン"; }
          else {
            const prot = normalizeProteinToken(t);
            if (prot) { t = prot; cat = "肉・魚・卵・乳製品"; }
          }
        }

        if (cat && !seen[cat].has(t.toLowerCase())) {
          shopping[cat].push(t);
          seen[cat].add(t.toLowerCase());
        }
      }
    }
  }
  return shopping;
}

/* ===========================
   プロンプト（簡潔＆強制条件）
=========================== */
function buildPrompt({ toddlers, kids, adults, days, meals = [], avoid, request, available, avoidRecent = [] }) {
  const mealsLine = meals.length ? meals.join("、") : "朝食、昼食、夕食";
  const avoidLine = [avoid, ...(avoidRecent || [])].filter(Boolean).join("、") || "なし";

  const fields = [];
  if (meals.includes("朝食")) fields.push(`"朝食": "料理名"`);
  if (meals.includes("昼食")) fields.push(`"昼食": "料理名"`);
  if (meals.includes("夕食")) fields.push(`"夕食": "料理名"`);

  return `
厳密JSONのみを返してください（説明・コードフェンス禁止）。必ず "menu" の要素数は ${days} 件、"day" は 1..${days} の連番。

家族: 幼児${toddlers} / 小学生${kids} / 大人${adults}
日数: ${days}
出力する食事: ${mealsLine}（未選択の食事は出力しない）
避けたい語や料理: ${avoidLine}
リクエスト: ${request || "なし"}
家にある食材: ${available || "なし"}

制約:
- 料理名は名詞1語のみ禁止（必ず調理法/スタイルを含む）
- 昼食は主食（ご飯/パン/麺）を必ず含む
- 夕食は主菜（肉/魚/卵/豆腐等）を必ず含む、サラダ単品禁止
- 同じ主要たんぱく質（鶏/豚/牛/鮭/鯖/タラ/卵/豆腐/ツナ）を同じ日に重複させない
- 味噌汁/スープの具は野菜・きのこ・豆腐・わかめ等のみ

{
  "menu":[
    ${Array.from({ length: Number(days) || 1 }, (_, i) => `{"day":${i + 1},"meals":{ ${fields.join(", ")} },"nutrition":{"kcal":0,"protein_g":0,"veg_servings":0,"balance":""}}`).join(",")}
  ],
  "shoppingList":{"野菜・果物":[],"肉・魚・卵・乳製品":[],"穀物・麺類・パン":[],"調味料・油":[],"その他":[]},
  "availableList":[]
}`.trim();
}

/* ===========================
   API: 献立生成
=========================== */
app.post("/generate-menu", async (req, res, next) => {
  try {
    const { toddlers, kids, adults, days, meals = [], avoid, request, available, avoidRecent = [] } = req.body;

    const prompt = buildPrompt({ toddlers, kids, adults, days, meals, avoid, request, available, avoidRecent });

    let content = await callModel(prompt, { temperature: 0.7 });
    let raw = extractFirstJson(content);
    let json;
    try { json = JSON.parse(raw); }
    catch {
      const retry = prompt + "\n\n【重要】JSON以外は出力しない。";
      content = await callModel(retry, { temperature: 0.4 });
      raw = extractFirstJson(content);
      json = JSON.parse(raw);
    }

    // 栄養の穴埋め
    json.menu = (json.menu || []).map(d => {
      const n = d.nutrition || {};
      return {
        ...d,
        nutrition: {
          kcal: Number.isFinite(n.kcal) ? n.kcal : 0,
          protein_g: Number.isFinite(n.protein_g) ? n.protein_g : 0,
          veg_servings: Number.isFinite(n.veg_servings) ? n.veg_servings : 0,
          balance: typeof n.balance === "string" ? n.balance : ""
        }
      };
    });

    // 料理名の矯正
    json.menu = (json.menu || []).map(d => {
      const out = { ...d, meals: { ...(d.meals || {}) } };
      ["朝食","昼食","夕食"].forEach(m => {
        if (out.meals[m] == null) return;
        out.meals[m] = sanitizeMeal(String(out.meals[m] || ""), m);
      });
      return out;
    });

    // 最終フィルタ（同日/前日重複）
    json.menu = filterMenu(json.menu);

    // availableList
    const availableList = String(available || "").split(/[、,]/).map(s => s.trim()).filter(Boolean);
    json.availableList = availableList;

    // 買い物リスト整備
    json.shoppingList = stripAvailableFromShoppingList(json.shoppingList || {}, availableList);
    json.shoppingList = ensureShoppingFromMenu(json.menu, json.shoppingList);
    json.shoppingList = stripAvailableFromShoppingList(json.shoppingList, availableList);

    const cats = ["野菜・果物","肉・魚・卵・乳製品","穀物・麺類・パン","調味料・油","その他"];
    for (const c of cats) {
      const arr = Array.isArray(json.shoppingList[c]) ? json.shoppingList[c] : [];
      json.shoppingList[c] = [...new Set(arr.map(s => s.trim()).filter(Boolean))];
    }

    res.json(json);
  } catch (e) {
    console.error("献立生成エラー:", e);
    next(e);
  }
});

/* ===========================
   API: レシピ生成
=========================== */
app.post("/generate-recipe", async (req, res, next) => {
  try {
    const { dish, toddlers = 0, kids = 0, adults = 2, mode = "standard" } = req.body;
    const portions = Number(adults) + Number(kids) * 0.7 + Number(toddlers) * 0.5;
    const servings = Math.max(2, Math.round(portions));

    const cleanDish = (name = "") =>
      String(name).replace(/[•●・\-]/g, "").replace(/\s+/g, " ").replace(/^\s*・?\s*/, "").trim();
    const normalizeDish = (name = "") => {
      let n = cleanDish(name) || "鶏の照り焼き";
      if (/^(豆腐)$/i.test(n)) n = "豆腐ステーキ";
      if (/^(サラダ)$/i.test(n)) n = "チキンサラダ";
      if (/^(卵|納豆)$/i.test(n)) n = `${n}チャーハン`;
      if (/サラダ$/.test(n) && !/(サンド|丼|定食|パスタ|うどん|そば|ラーメン|ご飯|ライス)/.test(n)) n = n.replace(/サラダ$/, "サラダサンド");
      return n;
    };
    const safeDish = normalizeDish(dish);

    const prompt = `
日本の家庭料理のレシピを厳密JSONで返してください。説明禁止。

【料理名】${safeDish}
【分量】約${servings}人前
【モード】${mode === "economy" ? "節約" : mode === "quick" ? "時短" : "標準"}

{
  "title": "料理名",
  "servings": ${servings},
  "ingredients": ["具体食材 量", "..."],
  "seasonings": ["調味料 量", "..."],
  "steps": ["手順1", "..."],
  "tips": ["コツ1", "..."],
  "nutrition_per_serving": { "kcal": 0, "protein_g": 0 }
}`.trim();

    let content = await callModel(prompt, { temperature: 0.6 });
    let raw = extractFirstJson(content);
    let json;
    try { json = JSON.parse(raw); }
    catch {
      const retry = prompt + "\n\n【重要】JSONのみを厳密に出力。";
      content = await callModel(retry, { temperature: 0.3 });
      raw = extractFirstJson(content);
      json = JSON.parse(raw);
    }

    res.json(json);
  } catch (e) {
    console.error("レシピ生成エラー:", e);
    next(e);
  }
});

/* ===========================
   API: 買い物リスト再計算
=========================== */
app.post("/recalc-shopping", async (req, res, next) => {
  try {
    const { menu = [], available = "" } = req.body;
    const availableList = String(available).split(/[、,]/).map(s => s.trim()).filter(Boolean);

    let shopping = ensureShoppingFromMenu(menu, {});
    shopping = stripAvailableFromShoppingList(shopping, availableList);

    const cats = ["野菜・果物","肉・魚・卵・乳製品","穀物・麺類・パン","調味料・油","その他"];
    for (const c of cats) {
      const arr = Array.isArray(shopping[c]) ? shopping[c] : [];
      shopping[c] = [...new Set(arr.map(s => s.trim()).filter(Boolean))];
    }
    res.json({ shoppingList: shopping, availableList });
  } catch (e) {
    console.error("recalc-shopping error:", e);
    next(e);
  }
});

/* ===========================
   エラーハンドラ
=========================== */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "internal_error", detail: String(err?.message || err) });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
