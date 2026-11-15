
import { firebaseConfig, ADMINS } from "./firebase-config.js";

const base = "https://www.gstatic.com/firebasejs/10.12.2/";

const [A, Auth, F] = await Promise.all([
  import(base + "firebase-app.js"),
  import(base + "firebase-auth.js"),
  import(base + "firebase-firestore.js")
]);

const firebaseApp = A.getApps().length
  ? A.getApp()
  : A.initializeApp(firebaseConfig);

const auth = Auth.getAuth(firebaseApp);
const db = F.getFirestore(firebaseApp);

const $ = selector => document.querySelector(selector);

const escapeHTML = value => String(value ?? "")
  .replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);

const money = value => Math.max(0, Number(value) || 0);

let currentUser = null;
let requests = [];
let products = [];
let processing = false;

function isAdmin(user) {
  return !!user &&
    user.emailVerified &&
    ADMINS.includes(user.email);
}

function earned(progress = {}) {
  return Object.entries(progress).reduce((sum, [key, value]) => {
    if (!value) return sum;
    if (/:q\d+$/.test(key)) return sum + 10;
    if (/:p\d+$/.test(key)) return sum + 5;
    return sum;
  }, 0);
}

function productById(id) {
  return products.find(item => item.id === id);
}

function productCollection(id) {
  return productById(id)?.source || "shop";
}

function ensurePanel() {
  let panel = $("#easyyy-store-admin");

  if (panel) return panel;

  panel = document.createElement("section");
  panel.id = "easyyy-store-admin";
  panel.style.cssText = `
    max-width:1100px;
    margin:30px auto;
    padding:18px;
    border:2px solid #ffde59;
    border-radius:18px;
    background:#082567;
    color:white;
    font-family:system-ui,sans-serif;
  `;

  panel.innerHTML = `
    <h2>🛍️ Магазин — заявки учнів</h2>
    <div id="easyyy-store-content">
      Завантаження...
    </div>
  `;

  const main = document.querySelector("main");

  if (main) {
    main.appendChild(panel);
  } else {
    document.body.appendChild(panel);
  }

  return panel;
}

function setContent(html) {
  ensurePanel()
    .querySelector("#easyyy-store-content")
    .innerHTML = html;
}

async function loadProducts() {
  const [shop, materials] = await Promise.all([
    F.getDocs(F.collection(db, "shop")),
    F.getDocs(F.collection(db, "materials"))
  ]);

  products = [
    ...shop.docs.map(doc => ({
      id: doc.id,
      source: "shop",
      ...doc.data()
    })),
    ...materials.docs.map(doc => ({
      id: doc.id,
      source: "materials",
      type: "material",
      ...doc.data()
    }))
  ];
}

async function loadRequests() {
  const snapshot = await F.getDocs(
    F.collection(db, "purchaseRequests")
  );

  requests = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  requests.sort((a, b) => {
    const left = a.createdAt?.seconds || 0;
    const right = b.createdAt?.seconds || 0;
    return right - left;
  });
}

async function refresh() {
  if (!isAdmin(currentUser)) {
    ensurePanel().style.display = "none";
    return;
  }

  ensurePanel().style.display = "";

  try {
    await Promise.all([
      loadProducts(),
      loadRequests()
    ]);

    render();
  } catch (error) {
    setContent(`
      <p style="color:#ff8b8b">
        Помилка завантаження:
        ${escapeHTML(error.message)}
      </p>
    `);
  }
}

function render() {
  const pending = requests.filter(
    request => request.status === "pending"
  );

  const history = requests.filter(
    request => request.status !== "pending"
  );

  const requestCard = (request, historyMode = false) => {
    const item = productById(request.productId);

    const title = item?.title || "Товар не знайдено";
    const price = money(item?.price);

    const date = request.createdAt?.toDate
      ? request.createdAt.toDate().toLocaleString("uk-UA")
      : "Дата невідома";

    const status = {
      pending: "⏳ Очікує",
      approved: "✅ Підтверджено",
      rejected: "❌ Відхилено"
    }[request.status] || request.status;

    return `
      <div style="
        padding:16px;
        margin:12px 0;
        border:1px solid #4565ae;
        border-radius:14px;
        background:#0e2f86;
      ">
        <h3 style="margin:0 0 8px">
          ${escapeHTML(item?.emoji || "🎁")}
          ${escapeHTML(title)}
        </h3>

        <p>⭐ Вартість: <b>${price}</b></p>

        <p>
          👤 ID учня:
          <code style="overflow-wrap:anywhere">
            ${escapeHTML(request.userId)}
          </code>
        </p>

        <p>📅 ${escapeHTML(date)}</p>
        <p>${escapeHTML(status)}</p>

        ${!historyMode ? `
          <div style="
            display:flex;
            flex-wrap:wrap;
            gap:10px;
          ">
            <button
              data-approve="${escapeHTML(request.id)}"
              style="
                background:#3ddc97;
                color:#052b20;
                border:0;
                border-radius:10px;
                padding:10px 15px;
                font-weight:700;
                cursor:pointer;
              ">
              ✅ Підтвердити
            </button>

            <button
              data-reject="${escapeHTML(request.id)}"
              style="
                background:#ff6b70;
                color:#350508;
                border:0;
                border-radius:10px;
                padding:10px 15px;
                font-weight:700;
                cursor:pointer;
              ">
              ❌ Відхилити
            </button>
          </div>
        ` : ""}
      </div>
    `;
  };

  setContent(`
    <div style="
      display:flex;
      gap:12px;
      flex-wrap:wrap;
      align-items:center;
      justify-content:space-between;
    ">
      <p>
        Нових заявок:
        <b>${pending.length}</b>
      </p>

      <button id="easyyy-refresh"
        style="
          background:#ffde59;
          border:0;
          border-radius:10px;
          padding:10px 14px;
          font-weight:700;
          cursor:pointer;
        ">
        🔄 Оновити
      </button>
    </div>

    <h3>📨 Очікують підтвердження</h3>

    ${pending.length
      ? pending.map(r => requestCard(r)).join("")
      : "<p>Нових заявок немає 💙</p>"
    }

    <details style="margin-top:25px">
      <summary style="cursor:pointer;font-weight:700">
        📜 Історія покупок (${history.length})
      </summary>

      ${history.map(r => requestCard(r, true)).join("") ||
        "<p>Історія порожня.</p>"
      }
    </details>
  `);

  $("#easyyy-refresh").onclick = refresh;

  document.querySelectorAll("[data-approve]").forEach(button => {
    button.onclick = () => approve(button.dataset.approve);
  });

  document.querySelectorAll("[data-reject]").forEach(button => {
    button.onclick = () => reject(button.dataset.reject);
  });
}

async function approve(requestId) {
  if (processing || !isAdmin(currentUser)) return;

  const confirmed = confirm(
    "Підтвердити покупку? Зірочки будуть списані, а товар з'явиться в інвентарі учня."
  );

  if (!confirmed) return;

  processing = true;

  try {
    const requestRef = F.doc(db, "purchaseRequests", requestId);

    await F.runTransaction(db, async transaction => {
      const requestDoc = await transaction.get(requestRef);

      if (!requestDoc.exists()) {
        throw new Error("Заявку не знайдено.");
      }

      const request = requestDoc.data();

      if (request.status !== "pending") {
        throw new Error("Цю заявку вже оброблено.");
      }

      const userRef = F.doc(db, "users", request.userId);

      const itemSource = productCollection(request.productId);

      const itemRef = F.doc(
        db,
        itemSource,
        request.productId
      );

      const userDoc = await transaction.get(userRef);
      const itemDoc = await transaction.get(itemRef);

      if (!userDoc.exists()) {
        throw new Error("Профіль учня не знайдено.");
      }

      if (!itemDoc.exists()) {
        throw new Error("Товар більше не існує.");
      }

      const student = userDoc.data();
      const item = itemDoc.data();

      if (item.published === false) {
        throw new Error("Товар прихований.");
      }

      const inventory = Array.isArray(student.inventory)
        ? student.inventory
        : [];

      if (inventory.includes(request.productId)) {
        throw new Error("Учень уже має цей товар.");
      }

      const price = money(item.price);
      const totalEarned = earned(student.progress);
      const spent = money(student.shopSpent);

      if (totalEarned - spent < price) {
        throw new Error("Недостатньо зірочок.");
      }

      transaction.update(userRef, {
        inventory: [...inventory, request.productId],
        shopSpent: spent + price
      });

      transaction.update(requestRef, {
        status: "approved",
        approvedAt: F.serverTimestamp(),
        approvedPrice: price,
        approvedBy: currentUser.uid
      });
    });

    alert("Покупку підтверджено! 🎉");
    await refresh();

  } catch (error) {
    alert("Не вдалося підтвердити: " + error.message);
  } finally {
    processing = false;
  }
}

async function reject(requestId) {
  if (processing || !isAdmin(currentUser)) return;

  if (!confirm("Відхилити цю заявку?")) return;

  processing = true;

  try {
    const ref = F.doc(db, "purchaseRequests", requestId);

    await F.runTransaction(db, async transaction => {
      const doc = await transaction.get(ref);

      if (!doc.exists()) {
        throw new Error("Заявку не знайдено.");
      }

      if (doc.data().status !== "pending") {
        throw new Error("Заявку вже оброблено.");
      }

      transaction.update(ref, {
        status: "rejected",
        rejectedAt: F.serverTimestamp(),
        rejectedBy: currentUser.uid
      });
    });

    await refresh();
  } catch (error) {
    alert("Помилка: " + error.message);
  } finally {
    processing = false;
  }
}

Auth.onAuthStateChanged(auth, async user => {
  currentUser = user;

  if (isAdmin(user)) {
    await refresh();
  } else {
    const panel = $("#easyyy-store-admin");
    if (panel) panel.style.display = "none";
  }
});
