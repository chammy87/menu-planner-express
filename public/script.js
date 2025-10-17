// ===== script.jsに以下のコードを追加 =====

// buildDayCard関数内の「その日の献立だけ再考案」ボタンの下に追加
function buildDayCard(dayData, baseData) {
  const card = document.createElement("div");
  card.className = "menu-card";
  card.dataset.day = dayData.day;

  const h3 = document.createElement("h3");
  h3.textContent = `Day ${dayData.day}`;
  card.appendChild(h3);

  // 既存の再考案ボタン
  const regenBtn = document.createElement("button");
  regenBtn.type = "button";
  regenBtn.className = "day-regen";
  regenBtn.innerHTML = `<span>🔄</span><span>その日の献立だけ再考案</span>`;
  regenBtn.addEventListener("click", () => regenerateDay(dayData.day));
  card.appendChild(regenBtn);

  // ★ 新規追加：全レシピ表示ボタン
  const allRecipesBtn = document.createElement("button");
  allRecipesBtn.type = "button";
  allRecipesBtn.className = "day-regen";
  allRecipesBtn.style.background = "#28a745";
  allRecipesBtn.style.borderColor = "#28a745";
  allRecipesBtn.innerHTML = `<span>📖</span><span>この日の全レシピを表示</span>`;
  allRecipesBtn.addEventListener("click", () => showAllDayRecipes(dayData, baseData));
  card.appendChild(allRecipesBtn);

  // ... 以下は既存のコード
  if (dayData.nutrition) {
    const n = dayData.nutrition;
    const chips = document.createElement("div");
    chips.className = "nutri-chips";
    chips.innerHTML = `
      <span class="chip chip-kcal">⚡ ${n.kcal ?? 0} kcal</span>
      <span class="chip chip-protein">🥚 たんぱく質 ${n.protein_g ?? 0} g</span>
      <span class="chip chip-veg">🥦 野菜目安 ${n.veg_servings ?? 0} SV</span>
      ${n.balance ? `<span class="chip chip-note">📝 ${n.balance}</span>` : ""}`;
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

// ★ 新規関数：その日の全レシピ表示
async function showAllDayRecipes(dayData, baseData) {
  const modal = document.getElementById("recipeModal") || createModal();
  
  modal.innerHTML = `
    <div style="background:#fff;max-width:800px;width:95%;padding:20px;border-radius:12px;max-height:90vh;overflow:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2 style="margin:0;">📖 Day ${dayData.day} の全レシピ</h2>
        <button id="recipeClose" style="padding:8px 16px;border-radius:8px;border:1px solid #ddd;cursor:pointer;background:#f0f0f0;font-size:16px;">× 閉じる</button>
      </div>
      <div id="allRecipesContent" style="text-align:center;padding:40px;">
        <div style="display:inline-block;border:6px solid #eee;border-top:6px solid #28a745;border-radius:50%;width:40px;height:40px;animation:spin 0.8s linear infinite;"></div>
        <p style="margin-top:16px;">レシピを生成中...</p>
      </div>
    </div>`;
  
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
  
  const closeBtn = modal.querySelector("#recipeClose");
  const content = modal.querySelector("#allRecipesContent");
  
  const close = () => {
    modal.style.display = "none";
    document.body.style.overflow = "";
  };
  
  closeBtn.onclick = close;
  modal.addEventListener("click", (ev) => {
    if (ev.target === modal) close();
  }, { once: true });

  try {
    const response = await fetchJSON("/generate-day-recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dayData,
        toddlers: baseData?.toddlers || 0,
        kids: baseData?.kids || 0,
        adults: baseData?.adults || 2,
        mode: baseData?.mode || "standard"
      })
    });

    content.innerHTML = "";
    
    if (!response.recipes || response.recipes.length === 0) {
      content.innerHTML = "<p>レシピが生成できませんでした。</p>";
      return;
    }

    // 食事タイプ別にグループ化
    const mealGroups = { "朝食": [], "昼食": [], "夕食": [] };
    response.recipes.forEach(item => {
      if (mealGroups[item.mealType]) {
        mealGroups[item.mealType].push(item);
      }
    });

    // 各食事タイプごとに表示
    ["朝食", "昼食", "夕食"].forEach(mealType => {
      const items = mealGroups[mealType];
      if (items.length === 0) return;

      const section = document.createElement("div");
      section.style.cssText = "margin-bottom:32px;border-bottom:2px solid #eee;padding-bottom:24px;";
      
      const mealTitle = document.createElement("h3");
      mealTitle.textContent = mealType;
      mealTitle.style.cssText = "color:#2a5fbf;margin-bottom:16px;font-size:20px;";
      section.appendChild(mealTitle);

      items.forEach(item => {
        if (item.error) {
          const errorDiv = document.createElement("div");
          errorDiv.style.cssText = "background:#fff3cd;border:1px solid #ffeeba;padding:12px;border-radius:8px;margin-bottom:16px;";
          errorDiv.innerHTML = `<strong>${item.dish}</strong>: レシピ生成エラー`;
          section.appendChild(errorDiv);
          return;
        }

        const recipe = item.recipe;
        const recipeCard = document.createElement("div");
        recipeCard.style.cssText = "background:#f9fbff;border:1px solid #dbe7ff;border-radius:12px;padding:16px;margin-bottom:16px;";
        
        recipeCard.innerHTML = `
          <h4 style="margin:0 0 8px;color:#333;font-size:18px;">${recipe.title || item.dish}</h4>
          <p style="color:#666;font-size:14px;margin:4px 0 12px;">約${recipe.servings}人前</p>
          
          <div style="margin-bottom:12px;">
            <strong style="color:#2a5fbf;">材料</strong>
            <ul style="margin:8px 0;padding-left:20px;">
              ${(recipe.ingredients || []).map(ing => `<li>${ing}</li>`).join("")}
              ${(recipe.seasonings || []).map(sea => `<li>${sea}</li>`).join("")}
            </ul>
          </div>
          
          <div style="margin-bottom:12px;">
            <strong style="color:#2a5fbf;">作り方</strong>
            <ol style="margin:8px 0;padding-left:20px;">
              ${(recipe.steps || []).map(step => `<li>${step}</li>`).join("")}
            </ol>
          </div>
          
          ${recipe.tips && recipe.tips.length > 0 ? `
            <div style="background:#fff;padding:10px;border-radius:6px;border-left:4px solid #28a745;">
              <strong style="color:#28a745;">💡 ポイント</strong>
              <ul style="margin:8px 0;padding-left:20px;">
                ${recipe.tips.map(tip => `<li>${tip}</li>`).join("")}
              </ul>
            </div>
          ` : ""}
          
          ${recipe.nutrition_per_serving ? `
            <div style="display:flex;gap:8px;margin-top:12px;">
              <span style="background:#ffe9e9;padding:4px 10px;border-radius:999px;font-size:12px;">
                ⚡ ${recipe.nutrition_per_serving.kcal || "-"} kcal
              </span>
              <span style="background:#e9f7ff;padding:4px 10px;border-radius:999px;font-size:12px;">
                🥚 ${recipe.nutrition_per_serving.protein_g || "-"} g
              </span>
            </div>
          ` : ""}
        `;
        
        section.appendChild(recipeCard);
      });

      content.appendChild(section);
    });

  } catch (error) {
    console.error("❌ 全レシピ表示エラー:", error);
    content.innerHTML = `
      <div style="background:#fff3cd;border:1px solid #ffeeba;padding:20px;border-radius:12px;">
        <h4 style="color:#856404;margin-top:0;">⚠️ エラーが発生しました</h4>
        <pre style="white-space:pre-wrap;color:#856404;font-size:14px;">${error.message}</pre>
      </div>`;
  }
}

function createModal() {
  const modal = document.createElement("div");
  modal.id = "recipeModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;z-index:9999;overflow:auto;";
  document.body.appendChild(modal);
  return modal;
}

// ===== ここまで =====
