// script.js - 献立アプリのフロントエンド（完全版）

// --- グローバル状態 ---
let CURRENT = null;      // 直近の { menu, shoppingList, availableList, ... }
let LAST_PARAMS = null;  // 直近の入力値（サーバに渡したもの）
let inFlight = null;     // 連打時の中断用
let checkedItems = new Set(); // チェック済み買い物リスト項目

// --- 共通fetch（JSON強制 & HTML誤返却を可視化 & 連打中断） ---
async function fetchJSON(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  
  // ★ 修正：直前のリクエストがあれば中断（ただし新しいリクエストは続行）
  const previousFlight = inFlight;
  inFlight = controller;
  
  if (previousFlight && previousFlight !== controller) {
    console.log('⚠️ 前のリクエストを中断します');
    previousFlight.abort();
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const ct = res.headers.get("content-type") || "";
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}\n${body.slice(0, 400)}`);
    }
    if (!/application\/json/i.test(ct)) {
      throw new Error(`Expected JSON but got "${ct}"\n${body.slice(0, 400)}`);
    }
    return JSON.parse(body);
  } catch (error) {
    // ★ AbortErrorは通常のエラーとして処理しない
    if (error.name === 'AbortError') {
      console.log('🚫 リクエストが中断されました');
      throw error;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (inFlight === controller) inFlight = null;
  }
}

// 生成ボタン
document.getElementById("generateBtn").addEventListener("click", () => generateMenu(false));

async function generateMenu(isRegenerate = false) {
  const container = document.getElementById("menuResults");
  container.innerHTML = "<p>🍳 献立考え中…しばらくお待ちください</p>";

  const mode = (document.querySelector('input[name="mode"]:checked') || {}).value || "normal";
  const data = {
    toddlers: parseInt(document.getElementById("toddlers").value) || 0,
    kids: parseInt(document.getElementById("kids").value) || 0,
    adults: parseInt(document.getElementById("adults").value) || 2,
    days: parseInt(document.getElementById("days").value) || 3,
    meals: Array.from(document.querySelectorAll(".meal-selection input:checked")).map(el => el.value),
    avoid: document.getElementById("avoid").value,
    request: document.getElementById("request").value,
    available: document.getElementById("available").value,
    mode
  };

  // ★ 再考案の場合、既存のavailableListを引き継ぐ
  if (isRegenerate && CURRENT?.availableList?.length > 0) {
    data.available = CURRENT.availableList.join('、');
    document.getElementById("available").value = data.available;
    console.log('🔄 再考案: availableListを引き継ぎ', CURRENT.availableList);
  }

  LAST_PARAMS = data;

  try {
    console.log('📝 献立生成リクエスト送信:', data);
    
    const result = await fetchJSON("/generate-menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    console.log('✅ 献立生成成功:', result);

    // ★ 再考案の場合、チェック済みアイテムを除外
    if (isRegenerate && checkedItems.size > 0) {
      result.shoppingList = preserveCheckedState(result.shoppingList, checkedItems);
      console.log('✅ チェック済みアイテムを除外:', checkedItems.size + '個');
    } else {
      // 初回生成時はチェック状態をリセット
      checkedItems.clear();
    }

    CURRENT = result;
    renderAll(result, data);
  } catch (e) {
    // ★ AbortErrorの場合は何もしない（ユーザーが再度ボタンを押した場合）
    if (e.name === "AbortError") {
      console.log('⚠️ リクエストがキャンセルされました');
      return;
    }
    console.error('❌ 献立生成エラー:', e);
    container.innerHTML =
      `<pre style="white-space:pre-wrap;background:#fff3cd;border:1px solid #ffeeba;padding:8px;border-radius:6px;">
⚠️ 献立APIエラー：${e.message}</pre>`;
  }
}

// ★ チェック済みアイテムを除外
function preserveCheckedState(shoppingList, checkedSet) {
  const result = {};
  for (const [category, items] of Object.entries(shoppingList)) {
    result[category] = (items || []).filter(item => {
      const normalized = item.trim().toLowerCase();
      return !checkedSet.has(normalized);
    });
  }
  return result;
}

// すべて描画
function renderAll(result, baseData) {
  const container = document.getElementById("menuResults");
  container.innerHTML = "";

  // 上ツールバー
  const toolbar = document.createElement("div");
  toolbar.className = "menu-toolbar";
  toolbar.innerHTML = `
    <div style="display:flex;gap:8px;margin:0 0 12px;flex-wrap:wrap;">
      <button id="regenMenuBtn" type="button"
        style="padding:6px 12px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-size:14px;line-height:1.3;color:#111;display:inline-flex;align-items:center;gap:6px;">
        <span>🔄</span><span>献立を再考案</span>
      </button>
      <button id="recalcShoppingBtn" type="button"
        style="padding:6px 12px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-size:14px;line-height:1.3;color:#111;display:inline-flex;align-items:center;gap:6px;">
        <span>🛒</span><span>買い物リスト再計算</span>
      </button>
    </div>`;
  container.appendChild(toolbar);

  document.getElementById("regenMenuBtn").addEventListener("click", () => {
    if (confirm('献立を再考案しますか？\n（買い物リストのチェック状態は保持されます）')) {
      generateMenu(true);
    }
  });

  document.getElementById("recalcShoppingBtn").addEventListener("click", recalculateShoppingList);

  // 日カード
  (result.menu || []).forEach(dayData => {
    const card = buildDayCard(dayData, baseData);
    container.appendChild(card);
  });

  // 買い物
  renderShopping(result.shoppingList, result.availableList);
}

// 1日カード
function buildDayCard(dayData, baseData) {
  const card = document.createElement("div");
  card.className = "menu-card";
  card.dataset.day = dayData.day;

  const h3 = document.createElement("h3");
  h3.textContent = `Day ${dayData.day}`;
  card.appendChild(h3);

  const regenBtn = document.createElement("button");
  regenBtn.type = "button";
  regenBtn.className = "day-regen";
  regenBtn.style.cssText = "padding:6px 12px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-size:14px;line-height:1.3;color:#111;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;";
  regenBtn.innerHTML = `<span>🔄</span><span>その日の献立だけ再考案</span>`;
  regenBtn.addEventListener("click", () => regenerateDay(dayData.day));
  card.appendChild(regenBtn);

  if (dayData.nutrition) {
    const n = dayData.nutrition;
    const chips = document.createElement("div");
    chips.className = "nutri-chips";
    chips.innerHTML = `
      <span class="chip chip-kcal">⚡ ${n.kcal ?? 0} kcal</span>
      <span class="chip chip-protein">🥚 たんぱく質 ${n.protein_g ?? 0} g</span>
      <span class="chip chip-veg">🥦 野菜目安 ${n.veg_servings ?? 0} SV</span>
      ${n.balance ? `<span class="chip chip-note">📝 ${n.balance}</span>` : ""}
    `;
    card.appendChild(chips);
  }

  const grid = document.createElement("div");
  grid.className = "meals-grid";
  ["朝食", "昼食", "夕食"].forEach(meal => {
    const name = dayData.meals?.[meal];
    if (!name) return;
    const col = document.createElement("div");
    col.className = "meal-col";
    col.innerHTML = `<h4>${meal}</h4><ul></ul>`;
    const ul = col.querySelector("ul");
    (Array.isArray(name) ? name : [name]).forEach(dish => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dish-btn";
      btn.textContent = dish;
      btn.addEventListener("click", () => openRecipeModal(dish, baseData));
      li.appendChild(btn);
      ul.appendChild(li);
    });
    grid.appendChild(col);
  });
  card.appendChild(grid);
  return card;
}

// その日だけ再考案
async function regenerateDay(day) {
  const card = document.querySelector(`.menu-card[data-day="${day}"]`);
  const btn = card?.querySelector(".day-regen");
  const old = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<span>🔄</span><span>再考案中…</span>`; }
  card.style.opacity = ".6";

  const others = (CURRENT?.menu || []).filter(x => Number(x.day) !== Number(day));
  const avoidNames = [];
  const avoidTokens = [];
  const split = s => String(s || "").split(/[とノの・、,／\s]+/).filter(Boolean);
  others.forEach(d => ["朝食", "昼食", "夕食"].forEach(m => {
    const n = d?.meals?.[m]; if (!n) return;
    avoidNames.push(n); split(n).forEach(t => avoidTokens.push(t));
  }));

  try {
    let newDay = null;
    for (let trial = 0; trial < 2; trial++) {
      const one = await fetchJSON("/generate-menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...LAST_PARAMS,
          days: 1,
          avoidRecent: [...avoidNames, ...avoidTokens],
          available: (CURRENT.availableList || []).join('、') // ★ availableListを引き継ぐ
        })
      });
      newDay = one.menu?.[0];
      if (newDay && isUniqueEnough(newDay, others)) break;
    }
    if (!newDay) throw new Error("no day generated");

    newDay.day = day;
    CURRENT.menu[day - 1] = newDay;
    card.replaceWith(buildDayCard(newDay, LAST_PARAMS));

    // 買い物リストを再計算
    await recalculateShoppingList();

  } catch (e) {
    if (e.name !== "AbortError") {
      console.error(e);
      alert("その日の再考案に失敗しました。");
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = old || `<span>🔄</span><span>その日の献立だけ再考案</span>`; }
    card.style.opacity = "";
  }
}

// 新メニューが他日と被っていないか
function isUniqueEnough(newDay, others) {
  const majors = /(鶏|豚|牛|鮭|鯖|タラ|サワラ|卵|豆腐|ツナ)/;
  const names = new Set();
  const prots = new Set();
  others.forEach(d => ["朝食", "昼食", "夕食"].forEach(m => {
    const n = d?.meals?.[m]; if (!n) return;
    names.add(n);
    const mprot = n.match(majors)?.[0]; if (mprot) prots.add(mprot);
  }));
  for (const m of ["朝食", "昼食", "夕食"]) {
    const n = newDay?.meals?.[m]; if (!n) continue;
    if (names.has(n)) return false;
    const p = n.match(majors)?.[0]; if (p && prots.has(p)) return false;
  }
  return true;
}

// ★ 買い物リスト再計算
async function recalculateShoppingList() {
  try {
    if (!CURRENT || !CURRENT.menu || CURRENT.menu.length === 0) {
      alert('献立が生成されていません');
      return;
    }

    console.log('🔄 買い物リスト再計算開始');

    const recData = await fetchJSON("/recalc-shopping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        menu: CURRENT.menu,
        available: (CURRENT.availableList || []).join("、")
      })
    });

    // ★ チェック状態を保持したまま更新
    CURRENT.shoppingList = preserveCheckedState(recData.shoppingList, checkedItems);
    CURRENT.availableList = recData.availableList || CURRENT.availableList;

    renderShopping(CURRENT.shoppingList, CURRENT.availableList);

    console.log('✅ 買い物リスト再計算完了');

  } catch (e) {
    if (e.name !== "AbortError") {
      console.error(e);
      alert("買い物リストの再計算に失敗しました。");
    }
  }
}

// 買い物リスト（丸ごと再描画）
function renderShopping(shoppingList = {}, availableList = []) {
  document.querySelector(".shopping-card")?.remove();

  const categoryColors = {
    "野菜・果物": "#4CAF50",
    "肉・魚・卵・乳製品": "#E57373",
    "穀物・麺類・パン": "#FFB74D",
    "調味料・油": "#64B5F6",
    "その他": "#BA68C8",
    "🏠 家にある食材": "#9E9E9E"
  };
  const cats = ["野菜・果物", "肉・魚・卵・乳製品", "穀物・麺類・パン", "調味料・油", "その他"];

  const shoppingCard = document.createElement("div");
  shoppingCard.className = "menu-card shopping-card";
  shoppingCard.innerHTML = `
    <h3>🛒 買い物リスト</h3>
    <p style="color:#666;font-size:14px;margin:8px 0;">
      チェックした項目は「家にある食材」に追加され、再考案時に除外されます。
    </p>
  `;

  const createShoppingList = (title, list = [], color = "#bbb") => {
    const categoryDiv = document.createElement("div");
    categoryDiv.className = "shopping-category";
    categoryDiv.style.borderLeft = `6px solid ${color}`;

    const header = document.createElement("h4");
    header.textContent = title;
    header.style.cssText = `cursor:pointer;background:${color};color:#fff;padding:8px 10px;margin:0;border-top-left-radius:6px;border-top-right-radius:6px;user-select:none;`;

    const ul = document.createElement("ul");
    if (!list.length) {
      const li = document.createElement("li");
      li.style.opacity = ".7";
      li.textContent = "（項目はありません）";
      ul.appendChild(li);
    } else {
      list.forEach(item => {
        const li = document.createElement("li");
        li.className = "shopping-item";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.dataset.item = item;

        // ★ チェック状態を復元
        const normalized = item.trim().toLowerCase();
        if (checkedItems.has(normalized)) {
          cb.checked = true;
          li.classList.add("checked");
        }

        const sp = document.createElement("span");
        sp.textContent = item;

        // ★ チェックイベント
        cb.addEventListener("change", () => {
          handleItemCheck(cb, item, li);
          toggleCategory(ul);
        });

        li.appendChild(cb);
        li.appendChild(sp);
        ul.appendChild(li);
      });
    }

    header.addEventListener("click", () => ul.classList.toggle("collapsed"));
    categoryDiv.appendChild(header);
    categoryDiv.appendChild(ul);
    return categoryDiv;
  };

  cats.forEach(cat => {
    const items = Array.isArray(shoppingList[cat]) ? shoppingList[cat] : [];
    shoppingCard.appendChild(createShoppingList(cat, items, categoryColors[cat]));
  });

  if (availableList?.length) {
    shoppingCard.appendChild(createShoppingList("🏠 家にある食材", availableList, categoryColors["🏠 家にある食材"]));
  }

  document.getElementById("menuResults").appendChild(shoppingCard);

  function toggleCategory(ul) {
    const allChecked = [...ul.querySelectorAll("input")].every(cb => cb.checked);
    ul.classList.toggle("collapsed", allChecked);
  }
}

// ★ チェックボックスのイベントハンドラ
function handleItemCheck(checkbox, itemName, liElement) {
  const normalized = itemName.trim().toLowerCase();

  if (checkbox.checked) {
    // チェックされた → 家にある食材に追加
    checkedItems.add(normalized);
    liElement.classList.add("checked");

    if (!CURRENT.availableList) CURRENT.availableList = [];
    if (!CURRENT.availableList.includes(itemName)) {
      CURRENT.availableList.push(itemName);
    }

  } else {
    // チェック解除 → 家にある食材から削除
    checkedItems.delete(normalized);
    liElement.classList.remove("checked");

    if (CURRENT.availableList) {
      CURRENT.availableList = CURRENT.availableList.filter(x => x !== itemName);
    }
  }

  // フォームの「家にある食材」欄を更新
  updateAvailableInput();

  console.log('✅ チェック状態更新:', {
    item: itemName,
    checked: checkbox.checked,
    availableList: CURRENT.availableList
  });
}

// ★ 「家にある食材」入力欄を更新
function updateAvailableInput() {
  if (CURRENT?.availableList) {
    document.getElementById("available").value = CURRENT.availableList.join('、');
  }
}

/* =========================================================
   レシピモーダル（スクロール可）
========================================================= */
async function openRecipeModal(dish, baseData) {
  const template = `
    <div style="background:#fff;max-width:620px;width:92%;padding:16px;border-radius:12px;box-sizing:border-box;max-height:85vh;overflow:auto;">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="recipeClose" style="padding:6px 10px;border-radius:8px;border:1px solid #ddd;cursor:pointer;">× 閉じる</button>
      </div>
      <h3 id="recipeTitle" style="margin:8px 0;"></h3>
      <div id="recipeMeta" style="margin:4px 0 10px;opacity:.8;"></div>
      <h4>材料</h4><ul id="recipeIngredients"></ul>
      <h4>作り方</h4><ol id="recipeSteps"></ol>
      <div id="recipeNutrition" style="margin-top:8px;"></div>
    </div>`;

  let modal = document.getElementById("recipeModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "recipeModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;z-index:9999;overflow:auto;";
    document.body.appendChild(modal);
  }
  modal.innerHTML = template;

  const closeBtn = modal.querySelector("#recipeClose");
  const title = modal.querySelector("#recipeTitle");
  const meta = modal.querySelector("#recipeMeta");
  const ing = modal.querySelector("#recipeIngredients");
  const steps = modal.querySelector("#recipeSteps");
  const rnut = modal.querySelector("#recipeNutrition");

  modal.style.display = "flex";
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const close = () => { modal.style.display = "none"; document.body.style.overflow = prevOverflow || ""; };
  closeBtn.onclick = close;
  modal.addEventListener("click", ev => { if (ev.target === modal) close(); }, { once: true });

  title.textContent = dish;
  meta.textContent = "レシピ生成中…";

  try {
    const r = await fetchJSON("/generate-recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dish,
        toddlers: LAST_PARAMS.toddlers,
        kids: LAST_PARAMS.kids,
        adults: LAST_PARAMS.adults,
        mode: LAST_PARAMS.mode
      })
    });

    if (r.title) title.textContent = r.title;
    meta.textContent = `約${r.servings ?? "-"}人前`;

    (r.ingredients || []).forEach(it => {
      const li = document.createElement("li");
      li.textContent = typeof it === "string" ? it : `${it.name}：${it.amount}`;
      ing.appendChild(li);
    });

    (r.seasonings || []).forEach(it => {
      const li = document.createElement("li");
      li.textContent = typeof it === "string" ? it : `${it.name}：${it.amount}`;
      ing.appendChild(li);
    });

    (r.steps || []).forEach(st => {
      const li = document.createElement("li");
      li.textContent = st;
      steps.appendChild(li);
    });

    if (r.nutrition_per_serving) {
      rnut.innerHTML = `
        <span class="chip">kcal: ${r.nutrition_per_serving.kcal ?? "-"}</span>
        <span class="chip">P: ${r.nutrition_per_serving.protein_g ?? "-"}g</span>`;
    } else {
      rnut.textContent = "";
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      meta.textContent = "レシピ生成に失敗しました。";
      console.error(e);
    }
  }
}
