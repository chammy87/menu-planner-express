  // --- グローバル状態 ---
  let CURRENT = null;      // 直近の { menu, shoppingList, availableList, ... }
  let LAST_PARAMS = null;  // 直近の入力値（サーバに渡したもの）
  let inFlight = null;     // 連打時の中断用

  // --- 共通fetch（JSON強制 & HTML誤返却を可視化 & 連打中断） ---
  async function fetchJSON(url, options = {}, timeoutMs = 60000) {
    const controller = new AbortController();
    // 直前のリクエストを中断（再生成/再考案ボタン連打対策）
    if (inFlight) inFlight.abort();
    inFlight = controller;

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
    } finally {
      clearTimeout(timer);
      if (inFlight === controller) inFlight = null;
    }
  }

  // 生成ボタン
  document.getElementById("generateBtn").addEventListener("click", generateMenu);

  async function generateMenu() {
    const container = document.getElementById("menuResults");
    container.innerHTML = "<p>🍳 献立考え中…しばらくお待ちください</p>";

    const mode = (document.querySelector('input[name="mode"]:checked') || {}).value || "normal";
    const data = {
      toddlers: document.getElementById("toddlers").value,
      kids: document.getElementById("kids").value,
      adults: document.getElementById("adults").value,
      days: document.getElementById("days").value,
      meals: Array.from(document.querySelectorAll(".meal-selection input:checked")).map(el => el.value),
      avoid: document.getElementById("avoid").value,
      request: document.getElementById("request").value,
      available: document.getElementById("available").value,
      mode
    };
    LAST_PARAMS = data;

    try {
      const result = await fetchJSON("/generate-menu", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      CURRENT = result;
      renderAll(result, data);
    } catch (e) {
      if (e.name === "AbortError") return;
      console.error(e);
      container.innerHTML =
        `<pre style="white-space:pre-wrap;background:#fff3cd;border:1px solid #ffeeba;padding:8px;border-radius:6px;">
  ⚠️ 献立APIエラー：${e.message}</pre>`;
    }
  }

  // すべて描画
  function renderAll(result, baseData) {
    const container = document.getElementById("menuResults");
    container.innerHTML = "";

    // 上ツールバー
    const toolbar = document.createElement("div");
    toolbar.className = "menu-toolbar";
    toolbar.innerHTML = `
      <div style="display:flex;gap:8px;margin:0 0 12px;">
        <button id="regenMenuBtn" type="button"
          style="padding:6px 12px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-size:14px;line-height:1.3;color:#111;display:inline-flex;align-items:center;gap:6px;">
          <span>🔄</span><span>献立を再考案</span>
        </button>
      </div>`;
    container.appendChild(toolbar);
    document.getElementById("regenMenuBtn").addEventListener("click", () => {
      document.getElementById("generateBtn").click();
    });

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
    ["朝食","昼食","夕食"].forEach(meal => {
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

  // その日だけ再考案（重複避けトークン付与 → UI差替え → 買い物リスト再計算）
  async function regenerateDay(day) {
    const card = document.querySelector(`.menu-card[data-day="${day}"]`);
    const btn  = card?.querySelector(".day-regen");
    const old  = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span>🔄</span><span>再考案中…</span>`; }
    card.style.opacity = ".6";

    // 他日の料理名と構成トークンを避け語に
    const others = (CURRENT?.menu || []).filter(x => Number(x.day)!==Number(day));
    const avoidNames = [];
    const avoidTokens = [];
    const split = s => String(s||"").split(/[とノの・、,／\s]+/).filter(Boolean);
    others.forEach(d => ["朝食","昼食","夕食"].forEach(m => {
      const n = d?.meals?.[m]; if (!n) return;
      avoidNames.push(n); split(n).forEach(t => avoidTokens.push(t));
    }));

    try {
      let newDay = null;
      for (let trial=0; trial<2; trial++) { // 最大2回までリトライ
        const one = await fetchJSON("/generate-menu", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ ...LAST_PARAMS, days: 1, avoidRecent: [...avoidNames, ...avoidTokens] })
        });
        newDay = one.menu?.[0];
        if (newDay && isUniqueEnough(newDay, others)) break;
      }
      if (!newDay) throw new Error("no day generated");

      // 置き換え & 再描画
      newDay.day = day;
      CURRENT.menu[day - 1] = newDay;
      card.replaceWith(buildDayCard(newDay, LAST_PARAMS));

      // 買い物リストを再計算（全置換）
      const recData = await fetchJSON("/recalc-shopping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menu: CURRENT.menu, available: (CURRENT.availableList||[]).join("、") })
      });
      CURRENT.shoppingList = recData.shoppingList;
      renderShopping(CURRENT.shoppingList, CURRENT.availableList);
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

  // 新メニューが他日と被っていないか（料理名/主要タンパク）
  function isUniqueEnough(newDay, others) {
    const majors = /(鶏|豚|牛|鮭|鯖|タラ|サワラ|卵|豆腐|ツナ)/;
    const names = new Set();
    const prots = new Set();
    others.forEach(d => ["朝食","昼食","夕食"].forEach(m => {
      const n = d?.meals?.[m]; if (!n) return;
      names.add(n);
      const mprot = n.match(majors)?.[0]; if (mprot) prots.add(mprot);
    }));
    for (const m of ["朝食","昼食","夕食"]) {
      const n = newDay?.meals?.[m]; if (!n) continue;
      if (names.has(n)) return false;
      const p = n.match(majors)?.[0]; if (p && prots.has(p)) return false;
    }
    return true;
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
    const cats = ["野菜・果物","肉・魚・卵・乳製品","穀物・麺類・パン","調味料・油","その他"];

    const shoppingCard = document.createElement("div");
    shoppingCard.className = "menu-card shopping-card";
    shoppingCard.innerHTML = `<h3>🛒 買い物リスト</h3>`;

    const createShoppingList = (title, list = [], color = "#bbb") => {
      const categoryDiv = document.createElement("div");
      categoryDiv.className = "shopping-category";
      categoryDiv.style.borderLeft = `6px solid ${color}`;

      const header = document.createElement("h4");
      header.textContent = title;
      header.style.cssText = `cursor:pointer;background:${color};color:#fff;padding:8px 10px;margin:0;border-top-left-radius:6px;border-top-right-radius:6px;`;

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
          const cb = document.createElement("input"); cb.type = "checkbox";
          const sp = document.createElement("span"); sp.textContent = item;
          cb.addEventListener("change", () => { li.classList.toggle("checked", cb.checked); toggleCategory(ul); });
          li.appendChild(cb); li.appendChild(sp); ul.appendChild(li);
        });
      }
      header.addEventListener("click", () => ul.classList.toggle("collapsed"));
      categoryDiv.appendChild(header); categoryDiv.appendChild(ul);
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

  /* =========================================================
     レシピモーダル（スクロール可）
  ========================================================= */
  async function openRecipeModal(dish, baseData) {
    const template = `
      <div style="background:#fff;max-width:620px;width:92%;padding:16px;border-radius:12px;box-sizing:border-box;max-height:85vh;overflow:auto;">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="recipeClose" style="padding:6px 10px;border-radius:8px;border:1px solid #ddd;">× 閉じる</button>
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
    const meta  = modal.querySelector("#recipeMeta");
    const ing   = modal.querySelector("#recipeIngredients");
    const steps = modal.querySelector("#recipeSteps");
    const rnut  = modal.querySelector("#recipeNutrition");

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
        method: "POST", headers: { "Content-Type": "application/json" },
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
