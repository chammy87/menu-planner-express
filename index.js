// index.js (ESM)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

/* ===========================
   CORS設定（本番環境用）
=========================== */
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : '*',
  methods: ['GET', 'POST'],
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' })); // JSONサイズ制限

// ✅ static は1回だけ。/ で home.html を返したいので index:false
app.use(express.static("public", { index: false }));

/* ---------- ホーム & ショートカット ---------- */
app.get("/", (_req, res) => {
  res.sendFile("home.html", { root: "public" }, (err) => {
    if (err) res.sendFile("index.html", { root: "public" });
  });
});
app.get("/menu", (_req, res) => res.sendFile("index.html", { root: "public" }));
app.get("/recipe", (_req, res) => res.sendFile("recipe.html", { root: "public" }));

/* ===========================
   OpenAI初期化
=========================== */
if (!process.env.OPENAI_API_KEY) {
  console.error("⚠️ OPENAI_API_KEY is missing.");
  process.exit(1);
}
const client = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60000, // 60秒タイムアウト
  maxRetries: 2
});

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

// 改善版：より堅牢なJSON抽出
function extractFirstJson(text) {
  text = String(text || "").trim();
  
  // コードフェンスを削除
  text = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
  
  // 最初の { から最後の } までを抽出（ネストに対応）
  let depth = 0;
  let start = -1;
  let end = -1;
  
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        end = i;
        break;
      }
    }
  }
  
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  
  // フォールバック：元の方法
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  return (i >= 0 && j > i) ? text.slice(i, j + 1) : text;
}

// OpenAI呼び出し（エラーハンドリング強化）
async function callModel(prompt, { temperature = 0.7, maxRetries = 3 } = {}) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 OpenAI API call (attempt ${attempt}/${maxRetries})`);
      
      const r = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature,
        top_p: 0.95,
        presence_penalty: 0.2,
        frequency_penalty: 0.2
      });
      
      const content = r.choices?.[0]?.message?.content ?? "";
      
      if (!content) {
        throw new Error("Empty response from OpenAI");
      }
      
      console.log(`✅ OpenAI API success (${content.length} chars)`);
      return content;
      
    } catch (error) {
      lastError = error;
      console.error(`❌ OpenAI API error (attempt ${attempt}):`, error.message);
      
      // レート制限エラーの場合は待機
      if (error?.status === 429) {
        const waitTime = Math.min(2000 * attempt, 10000);
        console.log(`⏳ Rate limited, waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // タイムアウトやネットワークエラーの場合は再試行
      if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET') {
        console.log(`⏳ Network error, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      // その他のエラーは即座に失敗
      if (attempt === maxRetries) {
        throw error;
      }
    }
  }
  
  throw lastError || new Error("OpenAI API call failed after retries");
}

// 名詞1語か？
const isGenericName = (name = "") => {
  const n = String(name).trim();
  return !!n && /^[^\s]+$/.test(n) && !cookWordRe.test(n);
};

// 正規表現エスケープ
const escapeReg = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 変な組み合わせ矯正（改善版）
function sanitizeMeal(name = "", mealType = "") {
  let n = String(name || "").replace(/\s+/g, " ").trim();
  
  if (!n) return "";

  const badSoup = /(オムレツ|パンケーキ|ヨーグルト|ケーキ|プリン|パフェ|サンド|丼|定食)/;
  if (/(味噌汁|スープ)/.test(n) && badSoup.test(n)) {
    n = "豆腐とわかめの味噌汁";
  }
  
  if (/卵とじ/.test(n) && /(ヨーグルト|フルーツ|パンケーキ)/.test(n)) {
    n = "ほうれん草の卵とじ";
  }

  // 昼食の主食チェック
  if (mealType === "昼食") {
    const hasStaple = /(ご飯|ライス|丼|パン|サンド|トースト|うどん|そば|そうめん|パスタ|スパゲッティ|スパゲティ|ラーメン|焼きそば|チャーハン|麺)/.test(n);
    if (!hasStaple) {
      n = `${n}とご飯`;
    }
  }

  // 夕食の主菜チェック
  if (mealType === "夕食") {
    const hasProtein = /(鶏|豚|牛|鮭|鯖|タラ|サワラ|魚|卵|豆腐|厚揚げ|ツナ)/.test(n);
    if (!hasProtein) {
      n = `${n}と鶏の照り焼き`;
    }
  }

  // 朝食の1語対策
  if (mealType === "朝食") {
    if (/^[^\s]+$/.test(n) && !/(汁|スープ|丼|サンド|トースト|粥|雑炊)/.test(n)) {
      n = `${n}の卵とじ`;
    }
  }

  // 矛盾した組み合わせの修正
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
  const pool = {
    ...ingredientCategories.meats,
    ...ingredientCategories.fish,
    ...ingredientCategories.vegetables,
    ...ingredientCategories.protein
  };
  const base = pool[canon(tok)];
  if (base?.length) {
    return base[Math.floor(Math.random() * base.length)];
  }
  const fallbacks = ["ほうれん草", "小松菜", "白菜", "鶏肉", "豚肉", "鮭", "豆腐"];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

function filterMenu(menu) {
  if (!Array.isArray(menu) || menu.length === 0) return menu;
  
  let prevDaySet = new Set();

  return menu.map(day => {
    const usedToday = new Set();
    const mealsOut = {};

    for (const [meal, raw] of Object.entries(day.meals || {})) {
      let dish = String(raw || "");
      dish = sanitizeMeal(dish, meal);

      for (const t0 of splitTokens(dish)) {
        const t = canon(t0);
        
        // 主食はスキップ
        if (stapleFoods.some(k => t.includes(k))) continue;
        
        // 重複チェックと置換
        if (usedToday.has(t) || prevDaySet.has(t)) {
          const rep = getReplacement(t);
          if (rep && rep !== t) {
            dish = dish.replace(new RegExp(escapeReg(t0), "g"), rep);
            usedToday.add(canon(rep));
          }
        } else {
          usedToday.add(t);
        }
      }
      mealsOut[meal] = dish;
    }

    // 前日のセットを更新（主食は除外）
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
  
  // エイリアス
  map["鶏"] = "肉・魚・卵・乳製品";
  map["豚"] = "肉・魚・卵・乳製品";
  map["牛"] = "肉・魚・卵・乳製品";
  map["サーモン"] = "肉・魚・卵・乳製品";
  map["サバ"] = "肉・魚・卵・乳製品";
  map["さば"] = "肉・魚・卵・乳製品";
  
  return map;
})();

/* ===========================
   料理名から既知食材を検出（改善版）
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

  // 長い単語から優先的にマッチ（誤検出防止）
  const sortedKeys = [...keys].sort((a, b) => b.length - a.length);

  for (const k of sortedKeys) {
    if (!k) continue;
    
    if (k.length === 1) {
      const rx = new RegExp(`(?:^|${BOUNDARY})${escapeReg(k)}(?:$|${BOUNDARY})`, "u");
      if (rx.test(src)) found.add(canon(k));
    } else {
      if (src.includes(k)) found.add(canon(k));
    }
  }

  // 誤検出の後処理
  if (src.includes("牛乳")) found.delete("牛肉");
  if (src.includes("鶏ガラ")) found.delete("鶏肉");
  if (src.includes("豚骨")) found.delete("豚肉");
  if (src.includes("卵白") || src.includes("卵黄")) {
    // 「卵白」「卵黄」は卵として扱う
  }

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
      // 部分一致でフィルタ
      for (const a of avail) {
        if (a && n.includes(a)) return false;
      }
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
  if (/豚(?!骨)/.test(token)) return "豚肉"; // 豚骨を除外
  if (/牛(?!乳)/.test(token)) return "牛肉"; // 牛乳を除外
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
          if (staple) {
            t = staple;
            cat = "穀物・麺類・パン";
          } else {
            const prot = normalizeProteinToken(t);
            if (prot) {
              t = prot;
              cat = "肉・魚・卵・乳製品";
            }
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
   バリデーション
=========================== */
function validateMenuRequest(body) {
  const { toddlers, kids, adults, days, meals } = body;
  
  const errors = [];
  
  if (!Number.isInteger(toddlers) || toddlers < 0 || toddlers > 10) {
    errors.push("幼児の人数は0〜10の整数で指定してください");
  }
  if (!Number.isInteger(kids) || kids < 0 || kids > 10) {
    errors.push("小学生の人数は0〜10の整数で指定してください");
  }
  if (!Number.isInteger(adults) || adults < 0 || adults > 10) {
    errors.push("大人の人数は0〜10の整数で指定してください");
  }
  if (!Number.isInteger(days) || days < 1 || days > 14) {
    errors.push("日数は1〜14の整数で指定してください");
  }
  if (!Array.isArray(meals) || meals.length === 0) {
    errors.push("少なくとも1つの食事を選択してください");
  }
  
  return errors;
}

/* ===========================
   API: 献立生成
=========================== */
app.post("/generate-menu", async (req, res, next) => {
  try {
    console.log("📝 献立生成リクエスト受信");
    
    // バリデーション
    const validationErrors = validateMenuRequest(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: "validation_error",
        details: validationErrors
      });
    }
    
    const {
      toddlers,
      kids,
      adults,
      days,
      meals = [],
      avoid,
      request,
      available,
      avoidRecent = []
    } = req.body;

    const prompt = buildPrompt({
      toddlers,
      kids,
      adults,
      days,
      meals,
      avoid,
      request,
      available,
      avoidRecent
    });

    let content = await callModel(prompt, { temperature: 0.7 });
    let raw = extractFirstJson(content);
    let json;
    
    try {
      json = JSON.parse(raw);
    } catch (parseError) {
      console.warn("⚠️ 初回JSONパース失敗、リトライします");
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
        if (out.meals[m] != null) {
          out.meals[m] = sanitizeMeal(String(out.meals[m] || ""), m);
        }
      });
      return out;
    });

    // 最終フィルタ（同日/前日重複）
    json.menu = filterMenu(json.menu);

    // availableList
    const availableList = String(available || "
