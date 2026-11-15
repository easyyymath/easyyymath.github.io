
import { firebaseConfig } from "./firebase-config.js";

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

const esc = value => String(value ?? "").replace(
  /[&<>"']/g,
  c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]
);

function safeLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "#";
  } catch {
    return "#";
  }
}

let me = null;
let profile = {};
let goods = [];
let requests = [];
let rankings = [];
let busy = false;

const userRef = () => F.doc(db, "users", me.uid);

function earnedPoints(progress = {}) {
  return Object.keys(progress).reduce((sum, key) => {
    if (!progress[key]) return sum;
    if (/:q\d+$/.test(key)) return sum + 10;
    if (/:p\d+$/.test(key)) return sum + 5;
    return sum;
  }, 0);
}

function balance() {
  return Math.max(
    0,
    earnedPoints(profile.progress) -
      Number(profile.shopSpent || 0)
  );
}

function owned(id) {
  return (profile.inventory || []).includes(id);
}

function product(id) {
  return goods.find(item => item.id === id);
}

function productType(item) {
  return item.type || "material";
}

function frameStyle(item) {
  if (!item) return "3px solid #4565ae";

  const colors = {
    gold: "#ffde59",
    blue: "#58b8ff",
    pink: "#ff8edb",
    green: "#3ddc97",
    purple: "#ae86ff"
  };

  const color = colors[item.frameColor] || colors.gold;
  return `3px solid ${color}`;
}

function avatar(name, photo, frameId, size = 64) {
  const frame = product(frameId);
  const photoUrl = safeLink(photo);

  const content = photoUrl !== "#"
    ? `<img src="${esc(photoUrl)}" alt=""
        style="width:100%;height:100%;
        object-fit:cover;border-radius:50%">`
    : `<span style="font-size:${size / 2}px">👤</span>`;

  return `
    <span style="
      display:inline-flex;
      align-items:center;
      justify-content:center;
      vertical-align:middle;
      width:${size}px;
      height:${size}px;
      flex:none;
      border-radius:50%;
      border:${frameStyle(frame)};
      background:#082567;
      overflow:hidden;
    ">
      ${content}
    </span>
  `;
}

async function load() {
  if (me) {
    const userDoc = await F.getDoc(userRef());
    profile = userDoc.data() || {};

    const q = F.query(
      F.collection(db, "purchaseRequests"),
      F.where("userId", "==", me.uid)
    );

    const snapshot = await F.getDocs(q);

    requests = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } else {
    profile = {};
    requests = [];
  }

  const results = await Promise.allSettled([
    F.getDocs(F.collection(db, "shop")),
    F.getDocs(F.collection(db, "materials")),
    F.getDocs(F.collection(db, "publicProfiles"))
  ]);

  goods = [];

  for (let i = 0; i < 2; i++) {
    if (results[i].status !== "fulfilled") continue;

    results[i].value.docs.forEach(doc => {
      const data = doc.data();

      if (data.published === false) return;

      goods.push({
        id: doc.id,
        ...data,
        type: i === 1
          ? "material"
          : data.type || "material"
      });
    });
  }

  rankings = results[2].status === "fulfilled"
    ? results[2].value.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
    : [];
}

function category(type) {
  return {
    frame: "🖼️ Рамки",
    badge: "🏅 Значки",
    theme: "🎨 Оформлення",
    game: "🎮 Ігри",
    material: "📚 Матеріали"
  }[type] || "✨ Інше";
}

function itemCard(item) {
  const purchased = owned(item.id);

  const pending = requests.some(request =>
    request.productId === item.id &&
    request.status === "pending"
  );

  const type = productType(item);

  const active = profile.equipped?.[type] === item.id;

  let action = "";

  if (!me) {
    action = `
      <button class="b" data-login>
        Увійти
      </button>
    `;
  } else if (!purchased) {
    action = pending
      ? `<button class="b" disabled>
           ⏳ Очікує підтвердження
         </button>`
      : `<button class="b"
           data-buy="${esc(item.id)}">
           Замовити · ⭐ ${Number(item.price) || 0}
         </button>`;
  } else if (["frame", "badge", "theme"].includes(type)) {
    action = `
      <button class="b ${active ? "o" : ""}"
        data-equip="${esc(item.id)}">
        ${active ? "Зняти" : "Встановити"}
      </button>
    `;
  } else if (safeLink(item.url) !== "#") {
    action = `
      <a class="b"
        href="${esc(safeLink(item.url))}"
        target="_blank"
        rel="noopener noreferrer">
        Відкрити
      </a>
    `;
  } else {
    action = `<span class="pill">Придбано ✓</span>`;
  }

  return `
    <div class="card shop-card">
      <div class="shop-icon">
        ${esc(item.emoji || "🎁")}
      </div>

      <h3>${esc(item.title || "Товар")}</h3>

      <p>${esc(item.description || "")}</p>

      <small>${category(type)}</small>

      <div class="shop-price">
        ⭐ ${Number(item.price) || 0}
      </div>

      ${action}
    </div>
  `;
}

function storePage() {
  const target = $("#app");
  if (!target) return;

  const inventory = goods.filter(item => owned(item.id));

  const sections = [...new Set(goods.map(productType))]
    .map(type => `
      <section class="shop-section">
        <h2>${category(type)}</h2>

        <div class="shop-grid">
          ${goods
            .filter(item => productType(item) === type)
            .map(itemCard)
            .join("")}
        </div>
      </section>
    `)
    .join("");

  target.innerHTML = `
    <h1>⭐ Магазин Easyyy_Math</h1>

    <div class="card shop-balance">
      <div>
        <h3>Твій баланс</h3>
        <small>
          Покупки підтверджує адміністратор
        </small>
      </div>

      <strong>
        ${me ? balance() + " ⭐" : "Увійди через Google"}
      </strong>
    </div>

    <div class="card">
      <h2>🎒 Мій інвентар</h2>

      ${
        !me
          ? "<p>Увійди, щоб побачити покупки.</p>"
          : inventory.length
            ? `<div class="shop-grid">
                ${inventory.map(itemCard).join("")}
               </div>`
            : "<p>Поки немає придбаних товарів.</p>"
      }
    </div>

    ${
      sections ||
      '<div class="card">Товари скоро з’являться.</div>'
    }

    <div class="card">
      <h3>📨 Мої заявки</h3>

      ${
        requests.length
          ? requests.map(request => {
              const name = product(request.productId)?.title || "Товар";

              const status = {
                pending: "⏳ Очікує",
                approved: "✅ Підтверджено",
                rejected: "❌ Відхилено"
              }[request.status] || "Невідомо";

              return `<p>${esc(name)} — ${status}</p>`;
            }).join("")
          : "<p>Заявок поки немає.</p>"
      }
    </div>

    <div class="card">
      <small>
        За правильну відповідь у квізі — 10 ⭐.
        За виконане практичне завдання — 5 ⭐.
        Заявки перевіряє адміністратор.
      </small>
    </div>
  `;

  bindButtons();
}

function bindButtons() {
  document.querySelectorAll("[data-login]").forEach(button => {
    button.onclick = () => $("#au")?.click();
  });

  document.querySelectorAll("[data-buy]").forEach(button => {
    button.onclick = () => buy(button.dataset.buy);
  });

  document.querySelectorAll("[data-equip]").forEach(button => {
    button.onclick = () => equip(button.dataset.equip);
  });
}

async function buy(id) {
  if (busy || !me) return;

  const item = product(id);

  if (!item || owned(id)) return;

  if (requests.some(request =>
    request.productId === id &&
    request.status === "pending"
  )) {
    alert("Заявку вже надіслано.");
    return;
  }

  if (balance() < Number(item.price || 0)) {
    alert("Недостатньо зірочок.");
    return;
  }

  const confirmed = confirm(
    `Замовити «${item.title}» за ${item.price || 0} ⭐?`
  );

  if (!confirmed) return;

  busy = true;

  try {
    await F.addDoc(
      F.collection(db, "purchaseRequests"),
      {
        userId: me.uid,
        productId: id,
        status: "pending",
        createdAt: F.serverTimestamp()
      }
    );

    await refresh();

    alert("Заявку надіслано! 💙");
  } catch (error) {
    alert("Помилка: " + error.message);
  } finally {
    busy = false;
  }
}

async function equip(id) {
  if (busy || !me || !owned(id)) return;

  const item = product(id);

  if (!item) return;

  const type = productType(item);

  if (!["frame", "badge", "theme"].includes(type)) return;

  busy = true;

  const value = profile.equipped?.[type] === id
    ? ""
    : id;

  try {
    const equipped = {
      ...(profile.equipped || {}),
      [type]: value
    };

    await F.updateDoc(userRef(), { equipped });

    profile.equipped = equipped;

    await publishProfile();
    await refresh();
  } catch (error) {
    alert("Не вдалося встановити: " + error.message);
  } finally {
    busy = false;
  }
}

async function publishProfile() {
  if (!me) return;

  const data = {
    displayName: me.displayName || "Учень",
    photoURL: safeLink(me.photoURL) !== "#"
      ? me.photoURL
      : "",
    frame: profile.equipped?.frame || "",
    badge: profile.equipped?.badge || "",
    score: earnedPoints(profile.progress)
  };

  await F.setDoc(
    F.doc(db, "publicProfiles", me.uid),
    data
  );
}

function decorateAccount() {
  const target = $("#app");

  if (!target || !me) return;

  const card = target.querySelector(".card");
  if (!card) return;

  const badge = product(profile.equipped?.badge);

  card.insertAdjacentHTML("afterbegin", `
    <div style="
      display:flex;
      align-items:center;
      gap:12px;
      margin-bottom:12px;
    ">
      ${avatar(
        me.displayName,
        me.photoURL,
        profile.equipped?.frame,
        76
      )}

      <div>
        <b>${esc(me.displayName || "Учень")}</b>

        ${
          badge
            ? `<span title="${esc(badge.title)}">
                ${esc(badge.emoji || "🏅")}
               </span>`
            : ""
        }

        <p>
          <a href="#shop">
            🎒 Мій інвентар та оформлення
          </a>
        </p>
      </div>
    </div>
  `);

  const heading = [...target.querySelectorAll("h3")]
    .find(el => el.textContent.includes("Мої зірочки"));

  if (heading) {
    heading.textContent =
      "⭐ Доступно зірочок: " + balance();
  }
}

function leaderboard() {
  const sorted = [...rankings].sort(
    (a, b) => (Number(b.score) || 0) -
              (Number(a.score) || 0)
  );

  $("#app").innerHTML = `
    <h1>🏆 Рейтинг Easyyy_Math</h1>

    <p>
      Рейтинг за заробленими зірочками.
      Показано навчальні досягнення, а не залишок.
    </p>

    ${
      sorted.map((entry, index) => {
        const badge = product(entry.badge);

        return `
          <div class="card" style="
            display:flex;
            gap:12px;
            align-items:center;
          ">
            <strong>${index + 1}.</strong>

            ${avatar(
              entry.displayName,
              entry.photoURL,
              entry.frame,
              54
            )}

            <div>
              <b>${esc(entry.displayName || "Учень")}</b>

              ${badge ? esc(badge.emoji || "🏅") : ""}

              <br>

              <small>
                ⭐ ${Number(entry.score) || 0}
              </small>
            </div>
          </div>
        `;
      }).join("") ||
      '<div class="card">У рейтингу поки немає учнів.</div>'
    }
  `;
}

function addNavigation() {
  const nav = $("#nv");

  if (
    nav &&
    !nav.querySelector('[href="#leaderboard"]')
  ) {
    nav.insertAdjacentHTML(
      "beforeend",
      '<a href="#leaderboard">🏆 Рейтинг</a>'
    );
  }
}

async function refresh() {
  await load();
  render();
}

function render() {
  addNavigation();

  const page = location.hash.split("/")[0];

  if (page === "#shop") {
    storePage();
  } else if (page === "#leaderboard") {
    leaderboard();
  } else if (page === "#account") {
    decorateAccount();
  }

  if (me) {
    const points = $("#pt");

    if (points) {
      points.textContent = "⭐ " + balance();
    }
  }
}

window.addEventListener("hashchange", () => {
  const page = location.hash.split("/")[0];

  if ([
    "#shop",
    "#leaderboard",
    "#account"
  ].includes(page)) {
    setTimeout(render, 0);
  }
});

Auth.onAuthStateChanged(auth, async user => {
  me = user;

  try {
    await refresh();
  } catch (error) {
    console.error("Помилка магазину:", error);
  }
});
