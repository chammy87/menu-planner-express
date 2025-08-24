    // ローディングや再提案用の要素
    const loading = document.getElementById("loading");
    const result = document.getElementById("result");
    const retryBtn = document.getElementById("retryBtn");
    const showHistoryBtn = document.getElementById("showHistoryBtn");
    const historyContainer = document.getElementById("historyContainer");

    // 履歴保存関数
    function saveRecipeToHistory(recipe) {
      const history = JSON.parse(localStorage.getItem("recipeHistory")) || [];
      const timestamp = new Date().toLocaleString();
      history.unshift({ timestamp, recipe });
      localStorage.setItem("recipeHistory", JSON.stringify(history));
      showHistoryBtn.style.display = "block";
    }

    // 履歴表示関数
    function displayHistory() {
      const history = JSON.parse(localStorage.getItem("recipeHistory")) || [];
      if (history.length === 0) return;

      historyContainer.innerHTML = "<h3>過去のレシピ</h3>";
      history.forEach((item) => {
        const entry = document.createElement("div");
        entry.className = "history-entry";
        entry.innerHTML = `
          <div class="history-time">${item.timestamp}</div>
          <div class="history-recipe">${item.recipe}</div>
        `;
        entry.onclick = () => {
          result.innerHTML = `
            <div class="recipe-card">
              <h3>🍽️ 今日のレシピ</h3>
              <pre>${item.recipe}</pre>
            </div>
          `;
          window.scrollTo({ top: result.offsetTop, behavior: 'smooth' });
        };
        historyContainer.appendChild(entry);
      });

      historyContainer.style.display = "block";
    }
// お気に入り保存
function saveFavorite(recipe) {
  const favorites = JSON.parse(localStorage.getItem("favorites")) || [];
  favorites.unshift({ recipe, timestamp: new Date().toLocaleString() });
  localStorage.setItem("favorites", JSON.stringify(favorites));
  alert("お気に入りに追加しました！");
}

// お気に入り表示
function displayFavorites() {
  const favorites = JSON.parse(localStorage.getItem("favorites")) || [];
  const container = document.getElementById("favoriteList");

  if (favorites.length === 0) {
    container.innerHTML = "<p>お気に入りはまだありません。</p>";
  } else {
    container.innerHTML = "<h3>📚 お気に入り一覧</h3>";
    favorites.forEach((item, index) => {
      const div = document.createElement("div");
      div.className = "history-entry";
      div.innerHTML = `
        <div class="history-time">${item.timestamp}</div>
        <div class="history-recipe">${item.recipe}</div>
        <button onclick="removeFavorite(${index})">❌ 削除</button>
      `;
      container.appendChild(div);
    });
  }

  container.style.display = "block";
}

// お気に入り削除
function removeFavorite(index) {
  const favorites = JSON.parse(localStorage.getItem("favorites")) || [];
  favorites.splice(index, 1);
  localStorage.setItem("favorites", JSON.stringify(favorites));
  displayFavorites();
}

// イベントリスナー
document.getElementById("addFavoriteBtn").addEventListener("click", () => {
  const recipe = document.querySelector("#result .recipe-card pre")?.innerText;
  if (recipe) {
    saveFavorite(recipe);
  } else {
    alert("保存するレシピが見つかりません。");
  }
});

document.getElementById("showFavoritesBtn").addEventListener("click", displayFavorites);

    // 入力バリデーション関数
    function validateForm() {
      const ingredients = document.getElementById("ingredients").value.trim();
      const toddlers = Number(document.getElementById("toddlers").value);
      const kids = Number(document.getElementById("kids").value);
      const adults = Number(document.getElementById("adults").value);

      if (!ingredients) {
        alert("食材を入力してください。");
        return false;
      }

      if (toddlers < 0 || kids < 0 || adults < 0) {
        alert("人数は0以上を入力してください。");
        return false;
      }

      if (toddlers + kids + adults === 0) {
        alert("合計人数が0人です。人数を入力してください。");
        return false;
      }

      return true;
    }

    // レシピ取得関数
    async function getRecipe() {
      if (!validateForm()) return;

      const ingredients = document.getElementById("ingredients").value;
      const useIn = Array.from(document.querySelectorAll('input[name="useIn"]:checked')).map(cb => cb.value);
      const toddlers = Number(document.getElementById("toddlers").value);
      const kids = Number(document.getElementById("kids").value);
      const adults = Number(document.getElementById("adults").value);
      const wantKidsMenu = document.getElementById("wantKidsMenu").value;
      const genre = document.getElementById("genre").value;
      const request = document.getElementById("request").value;
      const avoid = document.getElementById("avoid").value;
      const menuType = document.getElementById("menuType").value;

      // 上部チェックボックスの値を取得
      let mainDish = false;
      let sideDish = false;
      let soup = false;

      if (menuType === "recipe") {
        const selected = useIn; // useInはすでに上部チェックボックスから取得済み
        mainDish = selected.includes("main");
        sideDish = selected.includes("side");
        soup = selected.includes("soup");
      }

      result.innerHTML = "";
      loading.style.display = "block";
      retryBtn.style.display = "none";
      historyContainer.style.display = "none";

      try {
        const payload = {
          ingredients,
          useIn,
          toddlers,
          kids,
          adults,
          wantKidsMenu,
          genre,
          request,
          avoid,
          menuType,
        };

        // 単品レシピ用の条件付き追加
        if (menuType === "recipe") {
          payload.mainDish = mainDish;
          payload.sideDish = sideDish;
          payload.soup = soup;
        }

        const response = await fetch("/recipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await response.json();
        console.log("APIレスポンス", data);

        result.innerHTML = `
          <div class="recipe-card">
            <h3>🍽️ 今日のレシピ</h3>
            <pre>${data.recipe || "レシピが見つかりませんでした。"}</pre>
          </div>
        `;

        retryBtn.style.display = "block";
        showHistoryBtn.style.display = "block";
        saveRecipeToHistory(data.recipe);

      } catch (error) {
        console.error(error);
        result.innerText = "エラーが発生しました。";
      } finally {
        loading.style.display = "none";
      }
    }

    // 📌 イベントリスナー（関数の外に配置）
    retryBtn.addEventListener("click", getRecipe);
    showHistoryBtn.addEventListener("click", displayHistory);
    document.getElementById("recipeForm").addEventListener("submit", function(e) {
      e.preventDefault();
      getRecipe();
    });
