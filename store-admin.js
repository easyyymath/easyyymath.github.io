import { firebaseConfig, ADMINS } from "./firebase-config.js";

const base = "https://www.gstatic.com/firebasejs/10.12.2/";
const [A, Auth, F] = await Promise.all([
  import(base + "firebase-app.js"),
  import(base + "firebase-auth.js"),
  import(base + "firebase-firestore.js")
]);

const firebaseApp = A.getApps().length ? A.getApp() : A.initializeApp(firebaseConfig);
const auth = Auth.getAuth(firebaseApp);
const db = F.getFirestore(firebaseApp);

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);
const money = v => Math.max(0, Number(v) || 0);

let currentUser = null;
let products = [];
let students = [];
let legacy = [];
let processing = false;

const isAdmin = u => !!u && u.emailVerified && ADMINS.includes(u.email);

function legacyEarned(progress = {}) {
  return Object.entries(progress).reduce((sum, [k, v]) => {
    if (!v) return sum;
    if (/:q\d+$/.test(k)) return sum + 10;
    if (/:p\d+$/.test(k)) return sum + 5;
    return sum;
  }, 0);
}
const earnedOf = s => s.earned !== undefined ? Number(s.earned) || 0 : legacyEarned(s.progress);

function panel() {
  let p = $("#easyyy-store-admin");
  if (p) return p;
  p = document.createElement("section");
  p.id = "easyyy-store-admin";
  p.className = "card";
  p.innerHTML = `<h2>Історія покупок</h2><div id="easyyy-store-content">Завантаження...</div>`;
  ($("#shopPage") || $("main") || document.body).appendChild(p);
  return p;
}
const setContent = html => { panel().querySelector("#easyyy-store-content").innerHTML = html; };

async function load() {
  const [shop, mats, users, reqs] = await Promise.all([
    F.getDocs(F.collection(db, "shop")),
    F.getDocs(F.collection(db, "materials")),
    F.getDocs(F.collection(db, "users")),
    F.getDocs(F.collection(db, "purchaseRequests")).catch(() => ({ docs: [] }))
  ]);
  products = [
    ...shop.docs.map(d => ({ id: d.id, source: "shop", ...d.data() })),
    ...mats.docs.map(d => ({ id: d.id, source: "materials", type: "material", ...d.data() }))
  ];
  students = users.docs.map(d => ({ uid: d.id, ...d.data() }));
  legacy = reqs.docs.map(d => ({ id: d.id, ...d.data() }));
}

const productById = id => products.find(p => p.id === id);
const studentName = uid => {
  const s = students.find(x => x.uid === uid);
  return s ? (s.name || s.email || uid) : uid;
};

function render() {
  // нові автоматичні покупки + старі підтверджені заявки
  const log = [];
  students.forEach(s => (s.purchaseLog || []).forEach(p => log.push({
    at: p.at || 0, student: s.name || s.email || s.uid, email: s.email || "",
    title: p.title || productById(p.id)?.title || "Товар", price: money(p.price), auto: true
  })));
  legacy.filter(r => r.status === "approved").forEach(r => log.push({
    at: (r.approvedAt?.seconds || r.createdAt?.seconds || 0) * 1000,
    student: studentName(r.userId), email: "",
    title: productById(r.productId)?.title || "Товар",
    price: money(r.approvedPrice ?? productById(r.productId)?.price), auto: false
  }));
  log.sort((a, b) => b.at - a.at);

  const pending = legacy.filter(r => r.status === "pending");
  const total = log.reduce((n, x) => n + x.price, 0);

  setContent(`
    <p class="muted">Покупки проходять автоматично: перевірка балансу, списання та видача товару. Тут — лише перегляд.</p>
    <div class="row between">
      <span>Покупок: <b>${log.length}</b> · Витрачено зірочок: <b>${total}</b></span>
      <button class="alt sm" id="easyyy-refresh">Оновити</button>
    </div>
    ${log.length ? log.slice(0, 200).map(x => `
      <div class="item" style="margin-top:8px">
        <strong>${esc(x.title)}</strong> · ${x.price}<br>
        <small>${esc(x.student)}${x.email ? " · " + esc(x.email) : ""} · ${x.at ? new Date(x.at).toLocaleString("uk-UA") : "дата невідома"}</small>
      </div>`).join("") : "<p>Покупок поки немає.</p>"}
    ${pending.length ? `
      <h3 style="margin-top:20px">Старі заявки, що залишились (${pending.length})</h3>
      <p class="muted">Нові покупки більше не створюють заявок. Ці заявки поставлені до автоматизації — підтверди або відхили їх один раз.</p>
      ${pending.map(r => `
        <div class="item" style="margin-top:8px">
          <strong>${esc(productById(r.productId)?.title || "Товар")}</strong> · ${money(productById(r.productId)?.price)}<br>
          <small>${esc(studentName(r.userId))}</small>
          <div class="row" style="margin-top:6px">
            <button class="sm" data-approve="${esc(r.id)}">Підтвердити</button>
            <button class="alt sm" data-reject="${esc(r.id)}">Відхилити</button>
          </div>
        </div>`).join("")}` : ""}
  `);

  $("#easyyy-refresh").onclick = refresh;
  document.querySelectorAll("[data-approve]").forEach(b => b.onclick = () => approve(b.dataset.approve));
  document.querySelectorAll("[data-reject]").forEach(b => b.onclick = () => reject(b.dataset.reject));
}

async function refresh() {
  if (!isAdmin(currentUser)) { panel().style.display = "none"; return; }
  panel().style.display = "";
  try { await load(); render(); }
  catch (e) { setContent(`<p>Помилка завантаження: ${esc(e.message)}</p>`); }
}

async function approve(requestId) {
  if (processing || !isAdmin(currentUser)) return;
  processing = true;
  try {
    const requestRef = F.doc(db, "purchaseRequests", requestId);
    await F.runTransaction(db, async tx => {
      const rd = await tx.get(requestRef);
      if (!rd.exists()) throw new Error("Заявку не знайдено.");
      const r = rd.data();
      if (r.status !== "pending") throw new Error("Цю заявку вже оброблено.");
      const userRef = F.doc(db, "users", r.userId);
      const src = productById(r.productId)?.source || "shop";
      const itemRef = F.doc(db, src, r.productId);
      const [ud, id] = await Promise.all([tx.get(userRef), tx.get(itemRef)]);
      if (!ud.exists()) throw new Error("Профіль учня не знайдено.");
      if (!id.exists()) throw new Error("Товар більше не існує.");
      const st = ud.data(), item = id.data();
      const inv = Array.isArray(st.inventory) ? st.inventory : [];
      if (inv.includes(r.productId)) throw new Error("Учень уже має цей товар.");
      const price = money(item.price), earned = earnedOf(st), spent = money(st.shopSpent);
      if (earned - spent < price) throw new Error("Недостатньо зірочок.");
      tx.update(userRef, {
        earned, inventory: [...inv, r.productId], shopSpent: spent + price,
        purchaseLog: [...(st.purchaseLog || []), { id: r.productId, title: item.title || "", price, at: Date.now() }]
      });
      tx.update(requestRef, { status: "approved", approvedAt: F.serverTimestamp(), approvedPrice: price, approvedBy: currentUser.uid });
    });
    await refresh();
  } catch (e) { alert("Не вдалося: " + e.message); }
  finally { processing = false; }
}

async function reject(requestId) {
  if (processing || !isAdmin(currentUser)) return;
  processing = true;
  try {
    await F.updateDoc(F.doc(db, "purchaseRequests", requestId), {
      status: "rejected", rejectedAt: F.serverTimestamp(), rejectedBy: currentUser.uid
    });
    await refresh();
  } catch (e) { alert("Помилка: " + e.message); }
  finally { processing = false; }
}

Auth.onAuthStateChanged(auth, async u => {
  currentUser = u;
  if (isAdmin(u)) await refresh();
  else { const p = $("#easyyy-store-admin"); if (p) p.style.display = "none"; }
});
