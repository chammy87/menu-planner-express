// index.js (ESM) - 構造化JSON版
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

/* ===========================
   CORS設定
=========================== */
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : '*',
  methods: ['GET', 'POST'],
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.static("public", { index: false }));

/* ---------- ルート ---------- */
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
  timeout: 60000,
  maxRetries: 2
});

/* ===========================
   食材データベース
=========================== */
const INGREDIENT_DATABASE = {
  // 野菜
  "キャベツ": { category: "野菜・果物", alternatives: ["白菜","レタス","小松菜"] },
  "白菜": { category: "野菜・果物", alternatives: ["キャベツ","レタス"] },
  "にんじん": { category: "野菜・果物", alternatives: ["大根","かぶ"] },
  "玉ねぎ": { category: "野菜・果物", alternatives: ["長ねぎ","ニラ"] },
  "じゃがいも": { category: "野菜・果物", alternatives: ["さつまいも","長芋"] },
  "ほうれん草": { category: "野菜・果物", alternatives: ["小松菜","チンゲン菜"] },
  "ブロッコリー": { category: "野菜・果物", alternatives: ["カリフラワー","アスパラガス"] },
  "ピーマン": { category: "野菜・果物", alternatives: ["パプリカ","なす"] },
  "トマト": { category: "野菜・果物", alternatives: ["ミニトマト"] },
  "なす": { category: "野菜・果物", alternatives: ["ズッキーニ","ピーマン"] },
  "大根": { category: "野菜・果物", alternatives: ["かぶ","にんじん"] },
  "もやし": { category: "野菜・果物", alternatives: ["キャベツ"] },
  "長ねぎ": { category: "野菜・果物", alternatives: ["玉ねぎ","ニラ"] },
  
  // 肉類
  "鶏肉": { category: "肉・魚・卵・乳製品", alternatives: ["豚肉","ひき肉"], protein: true },
  "豚肉": { category: "肉・魚・卵・乳製品", alternatives: ["鶏肉","牛肉"], protein: true },
  "牛肉": { category: "肉・魚・卵・乳製品", alternatives: ["豚肉","鶏肉"], protein: true },
  "ひき肉": { category: "肉・魚・卵・乳製品", alternatives: ["鶏肉","豚肉"], protein: true },
  
  // 魚類
  "鮭": { category: "肉・魚・卵・乳製品", alternatives: ["鯖","タラ"], protein: true },
  "鯖": { category: "肉・魚・卵・乳製品", alternatives: ["鮭","サワラ"], protein: true },
  "タラ": { category: "肉・魚・卵・乳製品", alternatives: ["鮭","鯖"], protein: true },
  "サワラ": { category: "肉・魚・卵・乳製品", alternatives: ["鮭","鯖"], protein: true },
  
  // たんぱく質
  "卵": { category: "肉・魚・卵・乳製品", alternatives: ["豆腐"], protein: true },
  "豆腐": { category: "その他", alternatives: ["厚揚げ","油揚げ"], protein: true },
  "厚揚げ": { category: "その他", alternatives: ["豆腐","油揚げ"], protein: true },
  "油揚げ": { category: "その他", alternatives: ["豆腐","厚揚げ"], protein: true },
  
  // 主食
  "ご飯": { category: "穀物・麺類・パン", staple: true },
  "パン": { category: "穀物・麺類・パン", staple: true },
  "うどん": { category: "穀物・麺類・パン", staple: true },
  "そば": { category: "穀物・麺類・パン", staple: true },
  "パスタ": { category: "穀物・麺類・パン", staple: true },
  "中華麺": { category: "穀物・麺類・パン", staple: true },
};

/* ===========================
   ユーティリティ
=========================== */
function extractFirstJson(text) {
  text = String(text || "").trim();
  text = text.replace(/```(?:json)?\s*/g, "");
  
  let depth = 0, start = -1, end = -1;
  
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
  
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  return (i >= 0 && j > i) ? text.slice(i, j + 1) : text;
}

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
      
      if (error?.status === 429) {
        const waitTime = Math.min(2000 * attempt, 10000);
        console.log(`⏳ Rate limited, waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      if (attempt === maxRetries) throw error;
    }
  }
  
  throw lastError || new Error("OpenAI API call failed");
}

const normalize = (s) =>
  String(s || "").trim().toLowerCase().replace(/\s+/g, "").replace(/[（）()　]/g, "");

/* ===========================
   構造化プロンプト生成
=========================== */
function buildStructuredPrompt({ toddlers, kids, adults, days, meals = [], avoid, request, available, avoidRecent = [] }) {
  const mealsLine = meals.length ? meals.join("、") : "朝食、昼食、夕食";
  const avoidLine = [avoid, ...(avoidRecent || [])].filter(Boolean).join("、") || "なし";

  const mealFields = [];
  if (meals.includes("朝食")) {
    mealFields.push(`"朝食": {
          "main": "主菜名（例：目玉焼き、焼き魚）",
          "side": "副菜名（例：サラダ、おひたし）",
          "soup": "汁物名（例：味噌汁）",
          "staple": "主食名（例：ご飯、パン）"
        }`);
  }
  if (meals.includes("昼食")) {
    mealFields.push(`"昼食": {
          "main": "主菜名",
          "side": "副菜名",
          "staple": "主食名"
        }`);
  }
  if (meals.includes("夕食")) {
    mealFields.push(`"夕食": {
          "main": "主菜名",
          "side": "副菜名",
          "soup": "汁物名"
        }`);
  }

  return `
あなたは栄養士です。以下の条件で${days}日分の献立を作成してください。

【条件】
- 家族構成: 幼児${toddlers}人、小学生${kids}人、大人${adults}人
- 作成する食事: ${mealsLine}
- 避けたい食材/料理: ${avoidLine}
- リクエスト: ${request || "なし"}
- 家にある食材: ${available || "なし"}

【重要な制約】
1. 料理名はシンプルに（例：「鶏の照り焼き」「野菜炒め」「豆腐の味噌汁」）
2. 同じ日に同じたんぱく質（鶏/豚/牛/魚/卵/豆腐）を使わない
3. 連続する日に同じ食材を使わない
4. 汁物の具は「野菜、きのこ、豆腐、わかめ」のみ
5. 各料理で使う主要食材を必ずingredientsに列挙する

【出力形式】厳密なJSONのみ（説明不要）

{
  "menu": [
    {
      "day": 1,
      "meals": {
        ${mealFields.join(',\n        ')}
      },
      "ingredients": {
        "鶏肉": ["朝食-main"],
        "キャベツ": ["昼食-side"],
        "豆腐": ["夕食-soup"]
      }
    }
  ]
}

ingredients の値は ["食事名-位置"] の配列です。
位置は main/side/soup/staple のいずれかです。
`.trim();
}

/* ===========================
   重複回避処理
=========================== */
function avoidDuplicates(menu) {
  if (!Array.isArray(menu) || menu.length === 0) return menu;
  
  let prevDayIngredients = new Set();
  
  return menu.map((day, dayIndex) => {
    const todayIngredients = new Set();
    const newIngredients = { ...day.ingredients };
    const newMeals = JSON.parse(JSON.stringify(day.meals));
    
    // 各食材をチェック
    for (const [ingredient, usage] of Object.entries(day.ingredients || {})) {
      const ingredientData = INGREDIENT_DATABASE[ingredient];
      
      // 前日と重複している場合
      if (prevDayIngredients.has(ingredient) && ingredientData?.alternatives?.length > 0) {
        const replacement = ingredientData.alternatives[0];
        console.log(`  🔄 ${dayIndex + 1}日目: ${ingredient} → ${replacement} (前日重複回避)`);
        
        // 食材名を置換
        delete newIngredients[ingredient];
        newIngredients[replacement] = usage;
        
        // 料理名も置換
        for (const position of usage) {
          const [mealType, dishType] = position.split('-');
          if (newMeals[mealType]?.[dishType]) {
            newMeals[mealType][dishType] = newMeals[mealType][dishType].replace(
              new RegExp(ingredient, 'g'),
              replacement
            );
          }
        }
        
        todayIngredients.add(replacement);
      } else {
        todayIngredients.add(ingredient);
      }
    }
    
    prevDayIngredients = todayIngredients;
    
    return {
      ...day,
      meals: newMeals,
      ingredients: newIngredients
    };
  });
}

/* ===========================
   買い物リスト生成
=========================== */
function generateShoppingList(menu, availableList = []) {
  const shopping = {
    "野菜・果物": new Set(),
    "肉・魚・卵・乳製品": new Set(),
    "穀物・麺類・パン": new Set(),
    "調味料・油": new Set(),
    "その他": new Set()
  };
  
  // 正規化した利用可能食材リスト
  const availableNormalized = new Set(
    availableList.map(x => normalize(x)).filter(x => x.length >= 2)
  );
  
  console.log("🔍 除外する食材:", [...availableNormalized]);
  
  // 各日の食材を収集
  for (const day of menu) {
    for (const [ingredient, usage] of Object.entries(day.ingredients || {})) {
      const ingredientData = INGREDIENT_DATABASE[ingredient];
      
      if (!ingredientData) {
        console.log(`  ⚠️ 未登録食材: ${ingredient}`);
        continue;
      }
      
      // 利用可能食材リストにある場合はスキップ
      const normalized = normalize(ingredient);
      let shouldSkip = false;
      
      for (const avail of availableNormalized) {
        if (normalized === avail || normalized.includes(avail) || avail.includes(normalized)) {
          console.log(`  ❌ 除外: ${ingredient} (家にある)`);
          shouldSkip = true;
          break;
        }
      }
      
      if (shouldSkip) continue;
      
      // カテゴリに追加
      const category = ingredientData.category;
      if (category && shopping[category]) {
        shopping[category].add(ingredient);
        console.log(`  ✅ 追加: ${ingredient} → ${category}`);
      }
    }
  }
  
  // SetをArrayに変換してソート
  const result = {};
  for (const [category, items] of Object.entries(shopping)) {
    result[category] = [...items].sort((a, b) => a.localeCompare(b, 'ja'));
  }
  
  console.log("📊 買い物リスト生成完了:", 
    Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.length]))
  );
  
  return result;
}

/* ===========================
   レガシー形式への変換
=========================== */
function convertToLegacyFormat(structuredMenu) {
  return structuredMenu.map(day => {
    const legacyMeals = {};
    
    for (const [mealType, dishes] of Object.entries(day.meals || {})) {
      const parts = [];
      
      if (dishes.main) parts.push(dishes.main);
      if (dishes.side) parts.push(dishes.side);
      if (dishes.soup) parts.push(dishes.soup);
      if (dishes.staple && !dishes.main?.includes(dishes.staple)) {
        parts.push(dishes.staple);
      }
      
      legacyMeals[mealType] = parts.join('、');
    }
    
    return {
      day: day.day,
      meals: legacyMeals,
      nutrition: {
        kcal: 0,
        protein_g: 0,
        veg_servings: 0,
        balance: ""
      }
    };
  });
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
    
    const validationErrors = validateMenuRequest(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: "validation_error",
        details: validationErrors
      });
    }
    
    const {
      toddlers, kids, adults, days, meals = [],
      avoid, request, available, avoidRecent = []
    } = req.body;

    const availableList = String(available || "")
      .split(/[、,]/)
      .map(s => s.trim())
      .filter(Boolean);
    
    console.log("📦 家にある食材:", availableList);

    const prompt = buildStructuredPrompt({
      toddlers, kids, adults, days, meals,
      avoid, request,
      available: availableList.join('、'),
      avoidRecent
    });

    let content = await callModel(prompt, { temperature: 0.7 });
    let raw = extractFirstJson(content);
    let json;
    
    try {
      json = JSON.parse(raw);
    } catch (parseError) {
      console.warn("⚠️ 初回JSONパース失敗、リトライします");
      const retry = prompt + "\n\n【最重要】有効なJSONのみを出力してください。";
      content = await callModel(retry, { temperature: 0.5 });
      raw = extractFirstJson(content);
      json = JSON.parse(raw);
    }

    // 構造化メニューを処理
    let structuredMenu = json.menu || [];
    
    // 重複回避処理
    structuredMenu = avoidDuplicates(structuredMenu);
    
    // 買い物リスト生成
    const shoppingList = generateShoppingList(structuredMenu, availableList);
    
    // レガシー形式に変換（フロントエンド互換性のため）
    const legacyMenu = convertToLegacyFormat(structuredMenu);

    res.json({
      menu: legacyMenu,
      shoppingList,
      availableList
    });
    
  } catch (e) {
    console.error("❌ 献立生成エラー:", e);
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

    const prompt = `
日本の家庭料理のレシピを厳密JSONで返してください。

【料理名】${dish || "鶏の照り焼き"}
【分量】約${servings}人前
【モード】${mode === "economy" ? "節約" : mode === "quick" ? "時短" : "標準"}

{
  "title": "料理名",
  "servings": ${servings},
  "ingredients": ["食材 分量", "..."],
  "seasonings": ["調味料 分量", "..."],
  "steps": ["手順1", "手順2", "..."],
  "tips": ["コツ1", "..."],
  "nutrition_per_serving": { "kcal": 0, "protein_g": 0 }
}`.trim();

    let content = await callModel(prompt, { temperature: 0.6 });
    let raw = extractFirstJson(content);
    let json;
    
    try {
      json = JSON.parse(raw);
    } catch {
      const retry = prompt + "\n\n【重要】有効なJSONのみ。";
      content = await callModel(retry, { temperature: 0.4 });
      raw = extractFirstJson(content);
      json = JSON.parse(raw);
    }

    res.json(json);
  } catch (e) {
    console.error("❌ レシピ生成エラー:", e);
    next(e);
  }
});

/* ===========================
   API: 単品レシピ提案
=========================== */
app.post("/recipe", async (req, res, next) => {
  try {
    console.log("🍳 レシピ提案リクエスト受信");
    
    const {
      ingredients, useIn = [], toddlers = 0, kids = 0, adults = 2,
      wantKidsMenu = "いいえ", genre = "", request = "", avoid = "",
      menuType = "recipe"
    } = req.body;

    const portions = Number(adults) + Number(kids) * 0.7 + Number(toddlers) * 0.5;
    const servings = Math.max(2, Math.round(portions));

    let prompt = "";

    if (menuType === "menu") {
      prompt = `
【1食分の献立提案】
食材: ${ingredients}
人数: 幼児${toddlers}人、小学生${kids}人、大人${adults}人
子ども向け: ${wantKidsMenu}
ジャンル: ${genre || "指定なし"}
要望: ${request || "なし"}
避けたい: ${avoid || "なし"}

主菜・副菜・汁物のバランスの取れた1食分の献立を提案してください。

【出力形式】
■ 主菜: 料理名
材料: ...
作り方: ...

■ 副菜: 料理名
材料: ...
作り方: ...

■ 汁物: 料理名
材料: ...
作り方: ...
`.trim();
    } else {
      const useInText = useIn.length > 0 
        ? `（${useIn.map(x => x === 'main' ? '主菜' : x === 'side' ? '副菜' : '汁物').join('・')}）` 
        : '';
      
      prompt = `
【レシピ提案】
食材: ${ingredients} ${useInText}
人数: 約${servings}人前
子ども向け: ${wantKidsMenu}
ジャンル: ${genre || "指定なし"}
要望: ${request || "なし"}
避けたい: ${avoid || "なし"}

上記の食材を使った${servings}人前のレシピを1つ提案してください。

【出力形式】
■ 料理名: ○○○○

■ 材料（${servings}人前）
- 食材名: 分量

■ 作り方
1. 手順1
2. 手順2

■ ポイント
- コツやアレンジ案
`.trim();
    }

    const content = await callModel(prompt, { temperature: 0.7 });
    
    console.log("✅ レシピ提案生成完了");
    res.json({ recipe: content });
    
  } catch (e) {
    console.error("❌ レシピ提案エラー:", e);
    next(e);
  }
});

/* ===========================
   API: 買い物リスト再計算
=========================== */
app.post("/recalc-shopping", async (req, res, next) => {
  try {
    console.log("🔄 買い物リスト再計算リクエスト");
    
    const { menu = [], available = "" } = req.body;
    
    const availableList = String(available)
      .split(/[、,]/)
      .map(s => s.trim())
      .filter(Boolean);
    
    console.log("📦 家にある食材:", availableList);

    // レガシー形式から食材を抽出（簡易版）
    const extractedMenu = menu.map(day => ({
      day: day.day,
      meals: day.meals,
      ingredients: extractIngredientsFromMeals(day.meals)
    }));
    
    const shopping = generateShoppingList(extractedMenu, availableList);
    
    console.log("✅ 買い物リスト再計算完了");
    
    res.json({ 
      shoppingList: shopping, 
      availableList: availableList 
    });
    
  } catch (e) {
    console.error("❌ 買い物リスト再計算エラー:", e);
    next(e);
  }
});

// 料理名から食材を抽出（簡易版）
function extractIngredientsFromMeals(meals) {
  const ingredients = {};
  
  for (const [mealType, dishText] of Object.entries(meals || {})) {
    const text = String(dishText || "");
    
    for (const [ingredient, data] of Object.entries(INGREDIENT_DATABASE)) {
      if (text.includes(ingredient)) {
        if (!ingredients[ingredient]) {
          ingredients[ingredient] = [];
        }
        ingredients[ingredient].push(`${mealType}-main`);
      }
    }
  }
  
  return ingredients;
}

/* ===========================
   エラーハンドラ
=========================== */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error("💥 Unhandled error:", err);
  res.status(500).json({ 
    error: "internal_error", 
    detail: String(err?.message || err) 
  });
});

/* ===========================
   サーバー起動
=========================== */
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   OpenAI API: ${process.env.OPENAI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
});
