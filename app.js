// =========================================================
// ХЕЛПЕРЫ
// =========================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(method, url, body, auth) {
  const headers = {};
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (auth) headers["X-Auth"] = auth;
  const res = await fetch(url, { method, headers, body: payload });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    throw new Error((data && data.detail) || "Ошибка запроса");
  }
  return data;
}

function openModal(id) { $(id).hidden = false; document.body.style.overflow = "hidden"; }
function closeModal(id) { $(id).hidden = true; document.body.style.overflow = ""; }

$$(".modal [data-close]").forEach((btn) => {
  btn.addEventListener("click", () => { btn.closest(".modal").hidden = true; document.body.style.overflow = ""; });
});
$$(".modal").forEach((m) => {
  m.addEventListener("click", (e) => { if (e.target === m) { m.hidden = true; document.body.style.overflow = ""; } });
});

function starsHtml(rating) {
  const full = Math.round(rating);
  return "★".repeat(full) + "☆".repeat(5 - full);
}

// =========================================================
// ГЛАВНАЯ СТРАНИЦА
// =========================================================
let ALL_SERVICES_CACHE = [];

async function loadHome() {
  const data = await api("GET", "/api/public/home");

  $("#salonName").textContent = data.salon_name || "Салон красоты";
  $("#footerName").textContent = data.salon_name || "";
  $("#footerAddress").textContent = data.address || "";
  $("#addressPill").textContent = "📍 " + (data.address || "—");
  $("#hoursPill").textContent = "🕐 " + (data.work_start || "") + "–" + (data.work_end || "");
  document.title = data.salon_name || "Салон красоты";

  const socialsRow = $("#socialsRow");
  socialsRow.innerHTML = "";
  const socialIcons = { instagram: "📷", whatsapp: "💬", tiktok: "🎵" };
  Object.entries(data.socials || {}).forEach(([key, url]) => {
    if (url) {
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = socialIcons[key] || "🔗";
      socialsRow.appendChild(a);
    }
  });

  if (data.rating && data.rating.avg) {
    $("#ratingNum").textContent = data.rating.avg.toFixed(1);
    $("#ratingStars").textContent = starsHtml(data.rating.avg);
    $("#ratingCount").textContent = data.rating.count + " отзывов";
  } else {
    $("#ratingNum").textContent = "—";
    $("#ratingStars").textContent = "";
    $("#ratingCount").textContent = "Пока нет отзывов";
  }

  if (data.featured_review) {
    $("#featuredReview").hidden = false;
    $("#featuredText").textContent = data.featured_review.comment || "";
    $("#featuredAuthor").textContent = "— " + data.featured_review.client_name + ", " + starsHtml(data.featured_review.rating);
  }

  const mastersSection = $("#mastersSection");
  const mastersRow = $("#mastersRow");
  mastersRow.innerHTML = "";
  if (data.masters_of_month && data.masters_of_month.length) {
    mastersSection.hidden = false;
    data.masters_of_month.forEach((m) => {
      const el = document.createElement("div");
      el.className = "master-card";
      const initials = (m.name || "?").trim().charAt(0).toUpperCase();
      el.innerHTML = `
        ${m.photo_base64
          ? `<img class="master-card__photo" src="${m.photo_base64}" alt="${m.name}">`
          : `<div class="master-card__photo">${initials}</div>`}
        <p class="master-card__name">${m.name}</p>
        <p class="master-card__age">${m.age ? m.age + " лет" : ""}</p>`;
      mastersRow.appendChild(el);
    });
  } else {
    mastersSection.hidden = true;
  }

  const preview = $("#servicesPreview");
  preview.innerHTML = "";
  (data.services_preview || []).forEach((s) => preview.appendChild(serviceCard(s)));
  $("#seeAllServicesBtn").textContent = `Смотреть все услуги (${data.total_services})`;

  await loadReviews();
}

function serviceCard(s) {
  const el = document.createElement("div");
  el.className = "service-card";
  el.innerHTML = `
    <p class="service-card__name">${s.name}</p>
    <p class="service-card__desc">${s.description || ""}</p>
    <div class="service-card__foot">
      <span class="service-card__price">${Math.round(s.price)} ₽</span>
      <span class="service-card__dur">${s.duration_min} мин</span>
    </div>`;
  return el;
}

$("#seeAllServicesBtn").addEventListener("click", async () => {
  const services = await api("GET", "/api/public/services");
  ALL_SERVICES_CACHE = services;
  const list = $("#allServicesList");
  list.innerHTML = "";
  services.forEach((s) => list.appendChild(serviceCard(s)));
  openModal("#modalServices");
});

async function loadReviews() {
  const reviews = await api("GET", "/api/public/reviews");
  const list = $("#reviewsList");
  list.innerHTML = "";
  if (!reviews.length) {
    list.innerHTML = '<p class="review-item__empty">Отзывов пока нет — будьте первым!</p>';
    return;
  }
  reviews.forEach((r) => {
    const el = document.createElement("div");
    el.className = "review-item";
    el.innerHTML = `
      <div class="review-item__head">
        <span class="review-item__name">${r.client_name}</span>
        <span class="review-item__stars">${starsHtml(r.rating)}</span>
      </div>
      <p class="review-item__comment">${r.comment || ""}</p>`;
    list.appendChild(el);
  });
}

// =========================================================
// ОТЗЫВ (форма)
// =========================================================
$("#leaveReviewBtn").addEventListener("click", () => {
  $("#reviewForm").reset();
  $("#ratingInput").value = 5;
  updateStarPicker(5);
  $("#reviewMsg").textContent = "";
  openModal("#modalReview");
});

function updateStarPicker(rating) {
  $$("#starPicker span").forEach((s) => {
    s.classList.toggle("active", parseInt(s.dataset.star) <= rating);
  });
}
$$("#starPicker span").forEach((s) => {
  s.addEventListener("click", () => {
    const r = parseInt(s.dataset.star);
    $("#ratingInput").value = r;
    updateStarPicker(r);
  });
});
updateStarPicker(5);

$("#reviewForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $("#reviewMsg");
  try {
    await api("POST", "/api/public/reviews", {
      client_name: form.client_name.value,
      rating: parseInt($("#ratingInput").value),
      comment: form.comment.value,
    });
    msg.textContent = "Спасибо за отзыв!";
    msg.className = "form__msg ok";
    await loadReviews();
    setTimeout(() => closeModal("#modalReview"), 900);
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "form__msg err";
  }
});

// =========================================================
// ЗАПИСЬ (модалка)
// =========================================================
let bookingSelectedServices = new Set();

$("#fabBook").addEventListener("click", async () => {
  $("#bookingForm").reset();
  $("#bookingMsg").textContent = "";
  bookingSelectedServices.clear();
  const today = new Date().toISOString().slice(0, 10);
  $("#bookingDate").min = today;
  $("#bookingDate").value = today;
  $("#bookingTimeGrid").innerHTML = '<p class="form__hint">Выберите услуги и дату</p>';
  $("#bookingTimeInput").value = "";

  const services = await api("GET", "/api/public/services");
  const container = $("#bookingServices");
  container.innerHTML = "";
  services.forEach((s) => {
    const row = document.createElement("label");
    row.className = "service-check-row";
    row.innerHTML = `
      <input type="checkbox" value="${s.id}">
      <span class="name">${s.name}</span>
      <span class="meta">${Math.round(s.price)} ₽ · ${s.duration_min} мин</span>`;
    const checkbox = row.querySelector("input");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) bookingSelectedServices.add(s.id);
      else bookingSelectedServices.delete(s.id);
      row.classList.toggle("checked", checkbox.checked);
      updateBookingTotals(services);
      refreshBookingSlots();
    });
    container.appendChild(row);
  });
  updateBookingTotals(services);
  openModal("#modalBooking");
});

function updateBookingTotals(services) {
  const selected = services.filter((s) => bookingSelectedServices.has(s.id));
  const price = selected.reduce((a, s) => a + s.price, 0);
  const duration = selected.reduce((a, s) => a + s.duration_min, 0);
  $("#bookingTotals").textContent = selected.length
    ? `Итого: ${Math.round(price)} ₽, ${duration} мин`
    : "";
}

$("#bookingDate").addEventListener("change", refreshBookingSlots);

async function refreshBookingSlots() {
  const grid = $("#bookingTimeGrid");
  $("#bookingTimeInput").value = "";
  if (!bookingSelectedServices.size) {
    grid.innerHTML = '<p class="form__hint">Выберите услуги и дату</p>';
    return;
  }
  const date = $("#bookingDate").value;
  if (!date) return;
  grid.innerHTML = '<p class="form__hint">Загрузка...</p>';
  try {
    const ids = Array.from(bookingSelectedServices).join(",");
    const res = await api("GET", `/api/public/availability?appt_date=${date}&service_ids=${ids}`);
    if (!res.slots.length) {
      grid.innerHTML = '<p class="form__hint">На эту дату нет свободного времени.</p>';
      return;
    }
    grid.innerHTML = "";
    res.slots.forEach((t) => {
      const el = document.createElement("div");
      el.className = "time-slot";
      el.textContent = t;
      el.addEventListener("click", () => {
        $$(".time-slot").forEach((s) => s.classList.remove("selected"));
        el.classList.add("selected");
        $("#bookingTimeInput").value = t;
      });
      grid.appendChild(el);
    });
  } catch (err) {
    grid.innerHTML = `<p class="form__hint">${err.message}</p>`;
  }
}

$("#bookingForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $("#bookingMsg");
  if (!bookingSelectedServices.size) {
    msg.textContent = "Выберите хотя бы одну услугу.";
    msg.className = "form__msg err";
    return;
  }
  if (!$("#bookingTimeInput").value) {
    msg.textContent = "Выберите время.";
    msg.className = "form__msg err";
    return;
  }
  try {
    await api("POST", "/api/public/bookings", {
      client_name: form.client_name.value,
      phone: form.phone.value,
      appt_date: form.appt_date.value,
      appt_time: $("#bookingTimeInput").value,
      service_ids: Array.from(bookingSelectedServices),
      comment: form.comment.value,
    });
    msg.textContent = "Вы записаны! Ждём вас 🎉";
    msg.className = "form__msg ok";
    setTimeout(() => closeModal("#modalBooking"), 1200);
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "form__msg err";
  }
});

// =========================================================
// АВТОРИЗАЦИЯ ПЕРСОНАЛА
// =========================================================
$("#adminBtn").addEventListener("click", () => {
  $("#authForm").reset();
  $("#authMsg").textContent = "";
  openModal("#modalAuth");
});

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = e.target.password.value;
  const msg = $("#authMsg");
  try {
    const res = await api("POST", "/api/auth/check", { password });
    sessionStorage.setItem("auth_password", password);
    sessionStorage.setItem("auth_role", res.role);
    closeModal("#modalAuth");
    openAdminPanel(res.role);
  } catch (err) {
    msg.textContent = "Неверный пароль.";
    msg.className = "form__msg err";
  }
});

$("#panelLogout").addEventListener("click", () => {
  sessionStorage.removeItem("auth_password");
  sessionStorage.removeItem("auth_role");
  $("#adminPanel").hidden = true;
});

// =========================================================
// ПАНЕЛЬ АДМИН / ВЛАДЕЛЕЦ
// =========================================================
const TABS_ADMIN = [
  { id: "bookings", label: "Записи" },
  { id: "reviews", label: "Отзывы" },
];
const TABS_OWNER = [
  ...TABS_ADMIN,
  { id: "services", label: "Услуги" },
  { id: "masters", label: "Мастера" },
  { id: "branches", label: "Филиалы" },
  { id: "breaks", label: "Перерывы" },
  { id: "settings", label: "Настройки" },
];

function authHeader() { return sessionStorage.getItem("auth_password"); }

function openAdminPanel(role) {
  $("#panelRoleLabel").textContent = role === "owner" ? "Панель владельца" : "Панель администратора";
  const tabs = role === "owner" ? TABS_OWNER : TABS_ADMIN;
  const tabsEl = $("#panelTabs");
  tabsEl.innerHTML = "";
  tabs.forEach((t, i) => {
    const btn = document.createElement("button");
    btn.className = "panel__tab" + (i === 0 ? " active" : "");
    btn.textContent = t.label;
    btn.addEventListener("click", () => {
      $$(".panel__tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderTab(t.id, role);
    });
    tabsEl.appendChild(btn);
  });
  $("#adminPanel").hidden = false;
  renderTab(tabs[0].id, role);
}

// автовосстановление сессии при перезагрузке страницы
window.addEventListener("DOMContentLoaded", () => {
  const role = sessionStorage.getItem("auth_role");
  if (role) openAdminPanel(role);
});

async function renderTab(tabId, role) {
  const body = $("#panelBody");
  body.innerHTML = '<p class="empty-state">Загрузка...</p>';
  try {
    if (tabId === "bookings") await renderBookingsTab(body);
    else if (tabId === "reviews") await renderReviewsTab(body);
    else if (tabId === "services") await renderServicesTab(body);
    else if (tabId === "masters") await renderMastersTab(body);
    else if (tabId === "branches") await renderBranchesTab(body);
    else if (tabId === "breaks") await renderBreaksTab(body);
    else if (tabId === "settings") await renderSettingsTab(body);
  } catch (err) {
    body.innerHTML = `<p class="empty-state">${err.message}</p>`;
  }
}

// ---------- Записи ----------
async function renderBookingsTab(body) {
  const bookings = await api("GET", "/api/admin/bookings", null, authHeader());
  body.innerHTML = "";

  const addBtn = document.createElement("button");
  addBtn.className = "btn btn--ghost btn--sm";
  addBtn.textContent = "➕ Добавить запись вручную";
  addBtn.style.marginBottom = "14px";
  addBtn.addEventListener("click", () => renderManualBookingForm(body));
  body.appendChild(addBtn);

  if (!bookings.length) {
    body.innerHTML += '<p class="empty-state">Записей пока нет.</p>';
    return;
  }
  bookings.forEach((b) => {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.innerHTML = `
      <div class="admin-row__info">
        <b>${b.appt_date} ${b.appt_time} — ${b.client_name}</b>
        ${b.phone} · ${b.services.join(", ")} · ${Math.round(b.total_price)} ₽
        ${b.comment ? "<br>💬 " + b.comment : ""}
      </div>
      <div class="admin-row__actions">
        <button class="btn btn--danger btn--sm">Удалить</button>
      </div>`;
    row.querySelector("button").addEventListener("click", async () => {
      await api("DELETE", `/api/admin/bookings/${b.id}`, null, authHeader());
      renderBookingsTab(body);
    });
    body.appendChild(row);
  });
}

async function renderManualBookingForm(body) {
  const services = await api("GET", "/api/public/services");
  const wrap = document.createElement("div");
  wrap.className = "owner-card";
  wrap.innerHTML = `
    <h3>Новая запись</h3>
    <form class="form" id="manualBookingForm">
      <label>Имя клиента<input type="text" name="client_name" required></label>
      <label>Телефон<input type="tel" name="phone" required></label>
      <p class="form__label">Услуги</p>
      <div class="services-check" id="manualServices"></div>
      <label>Дата<input type="date" name="appt_date" id="manualDate" required></label>
      <p class="form__label">Время</p>
      <div class="time-grid" id="manualTimeGrid"><p class="form__hint">Выберите услуги и дату</p></div>
      <input type="hidden" name="appt_time" id="manualTimeInput">
      <label>Комментарий<textarea name="comment" rows="2"></textarea></label>
      <button class="btn btn--primary" type="submit">Добавить запись</button>
      <p class="form__msg" id="manualMsg"></p>
    </form>`;
  body.prepend(wrap);

  const selected = new Set();
  const container = wrap.querySelector("#manualServices");
  services.forEach((s) => {
    const row = document.createElement("label");
    row.className = "service-check-row";
    row.innerHTML = `<input type="checkbox" value="${s.id}"><span class="name">${s.name}</span><span class="meta">${Math.round(s.price)} ₽ · ${s.duration_min} мин</span>`;
    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) selected.add(s.id); else selected.delete(s.id);
      row.classList.toggle("checked", e.target.checked);
      refreshManualSlots();
    });
    container.appendChild(row);
  });

  const dateInput = wrap.querySelector("#manualDate");
  dateInput.min = new Date().toISOString().slice(0, 10);
  dateInput.value = dateInput.min;
  dateInput.addEventListener("change", refreshManualSlots);

  async function refreshManualSlots() {
    const grid = wrap.querySelector("#manualTimeGrid");
    wrap.querySelector("#manualTimeInput").value = "";
    if (!selected.size || !dateInput.value) {
      grid.innerHTML = '<p class="form__hint">Выберите услуги и дату</p>';
      return;
    }
    const ids = Array.from(selected).join(",");
    const res = await api("GET", `/api/public/availability?appt_date=${dateInput.value}&service_ids=${ids}`);
    grid.innerHTML = "";
    if (!res.slots.length) { grid.innerHTML = '<p class="form__hint">Нет свободного времени.</p>'; return; }
    res.slots.forEach((t) => {
      const el = document.createElement("div");
      el.className = "time-slot";
      el.textContent = t;
      el.addEventListener("click", () => {
        grid.querySelectorAll(".time-slot").forEach((s) => s.classList.remove("selected"));
        el.classList.add("selected");
        wrap.querySelector("#manualTimeInput").value = t;
      });
      grid.appendChild(el);
    });
  }

  wrap.querySelector("#manualBookingForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = wrap.querySelector("#manualMsg");
    if (!selected.size || !wrap.querySelector("#manualTimeInput").value) {
      msg.textContent = "Выберите услуги и время."; msg.className = "form__msg err"; return;
    }
    try {
      await api("POST", "/api/admin/bookings", {
        client_name: form.client_name.value, phone: form.phone.value,
        appt_date: form.appt_date.value, appt_time: wrap.querySelector("#manualTimeInput").value,
        service_ids: Array.from(selected), comment: form.comment.value,
      }, authHeader());
      renderBookingsTab(body);
    } catch (err) {
      msg.textContent = err.message; msg.className = "form__msg err";
    }
  });
}

// ---------- Отзывы ----------
async function renderReviewsTab(body) {
  const reviews = await api("GET", "/api/admin/reviews", null, authHeader());
  body.innerHTML = "";
  if (!reviews.length) { body.innerHTML = '<p class="empty-state">Отзывов пока нет.</p>'; return; }
  reviews.forEach((r) => {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.innerHTML = `
      <div class="admin-row__info">
        <b>${r.client_name} ${starsHtml(r.rating)} ${r.is_featured ? "⭐ на главной" : ""}</b>
        ${r.comment || ""}
      </div>
      <div class="admin-row__actions">
        <button class="btn btn--ghost btn--sm" data-act="feature">${r.is_featured ? "Убрать с главной" : "На главную"}</button>
        <button class="btn btn--danger btn--sm" data-act="delete">Удалить</button>
      </div>`;
    row.querySelector('[data-act="feature"]').addEventListener("click", async () => {
      const url = r.is_featured ? `/api/admin/reviews/${r.id}/unfeature` : `/api/admin/reviews/${r.id}/feature`;
      await api("POST", url, null, authHeader());
      renderReviewsTab(body);
    });
    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      await api("DELETE", `/api/admin/reviews/${r.id}`, null, authHeader());
      renderReviewsTab(body);
    });
    body.appendChild(row);
  });
}

// ---------- Услуги (владелец) ----------
async function renderServicesTab(body) {
  const services = await api("GET", "/api/owner/services", null, authHeader());
  body.innerHTML = `
    <div class="owner-card">
      <h3>Новая услуга</h3>
      <form class="form" id="newServiceForm">
        <label>Название<input type="text" name="name" required></label>
        <label>Описание<input type="text" name="description"></label>
        <label>Цена<input type="number" name="price" required min="0" step="1"></label>
        <label>Длительность (мин)<input type="number" name="duration_min" required min="5" step="5"></label>
        <button class="btn btn--primary" type="submit">Добавить</button>
        <p class="form__msg" id="newServiceMsg"></p>
      </form>
    </div>`;
  body.querySelector("#newServiceForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("POST", "/api/owner/services", {
        name: f.name.value, description: f.description.value,
        price: parseFloat(f.price.value), duration_min: parseInt(f.duration_min.value),
      }, authHeader());
      renderServicesTab(body);
    } catch (err) {
      body.querySelector("#newServiceMsg").textContent = err.message;
    }
  });

  services.forEach((s) => {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.innerHTML = `
      <div class="admin-row__info">
        <b>${s.name} ${s.is_active ? "" : "🚫 скрыта"}</b>
        ${Math.round(s.price)} ₽ · ${s.duration_min} мин
      </div>
      <div class="admin-row__actions">
        <button class="btn btn--ghost btn--sm" data-act="toggle">${s.is_active ? "Скрыть" : "Показать"}</button>
        <button class="btn btn--danger btn--sm" data-act="delete">Удалить</button>
      </div>`;
    row.querySelector('[data-act="toggle"]').addEventListener("click", async () => {
      await api("POST", `/api/owner/services/${s.id}/toggle`, null, authHeader());
      renderServicesTab(body);
    });
    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      await api("DELETE", `/api/owner/services/${s.id}`, null, authHeader());
      renderServicesTab(body);
    });
    body.appendChild(row);
  });
}

// ---------- Мастера (владелец) ----------
async function renderMastersTab(body) {
  const masters = await api("GET", "/api/owner/masters", null, authHeader());
  body.innerHTML = `
    <div class="owner-card">
      <h3>Новый мастер</h3>
      <form class="form" id="newMasterForm">
        <label>Имя<input type="text" name="name" required></label>
        <label>Возраст<input type="number" name="age" min="14" max="99"></label>
        <label>Фото<input type="file" name="photo" accept="image/*"></label>
        <button class="btn btn--primary" type="submit">Добавить</button>
        <p class="form__msg" id="newMasterMsg"></p>
      </form>
    </div>`;
  body.querySelector("#newMasterForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("POST", "/api/owner/masters", fd, authHeader());
      renderMastersTab(body);
    } catch (err) {
      body.querySelector("#newMasterMsg").textContent = err.message;
    }
  });

  masters.forEach((m) => {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.innerHTML = `
      <div class="admin-row__info">
        <b>${m.name} ${m.is_month ? "⭐ мастер месяца" : ""}</b>
        ${m.age ? m.age + " лет" : ""}
      </div>
      <div class="admin-row__actions">
        <button class="btn btn--ghost btn--sm" data-act="month">${m.is_month ? "Убрать из месяца" : "Сделать мастером месяца"}</button>
        <button class="btn btn--danger btn--sm" data-act="delete">Удалить</button>
      </div>`;
    row.querySelector('[data-act="month"]').addEventListener("click", async () => {
      await api("POST", `/api/owner/masters/${m.id}/toggle_month`, null, authHeader());
      renderMastersTab(body);
    });
    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      await api("DELETE", `/api/owner/masters/${m.id}`, null, authHeader());
      renderMastersTab(body);
    });
    body.appendChild(row);
  });
}

// ---------- Филиалы (владелец) ----------
async function renderBranchesTab(body) {
  const branches = await api("GET", "/api/owner/branches", null, authHeader());
  body.innerHTML = `
    <div class="owner-card">
      <h3>Новый филиал</h3>
      <form class="form" id="newBranchForm">
        <label>Название<input type="text" name="name" required></label>
        <label>Адрес<input type="text" name="address"></label>
        <label>Телефон<input type="text" name="phone"></label>
        <button class="btn btn--primary" type="submit">Добавить</button>
        <p class="form__msg" id="newBranchMsg"></p>
      </form>
    </div>`;
  body.querySelector("#newBranchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("POST", "/api/owner/branches", { name: f.name.value, address: f.address.value, phone: f.phone.value }, authHeader());
      renderBranchesTab(body);
    } catch (err) {
      body.querySelector("#newBranchMsg").textContent = err.message;
    }
  });

  branches.forEach((b) => {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.innerHTML = `
      <div class="admin-row__info"><b>${b.name}</b>${b.address ? " · " + b.address : ""}${b.phone ? " · " + b.phone : ""}</div>
      <div class="admin-row__actions"><button class="btn btn--danger btn--sm">Удалить</button></div>`;
    row.querySelector("button").addEventListener("click", async () => {
      await api("DELETE", `/api/owner/branches/${b.id}`, null, authHeader());
      renderBranchesTab(body);
    });
    body.appendChild(row);
  });
}

// ---------- Перерывы (владелец) ----------
async function renderBreaksTab(body) {
  const breaks = await api("GET", "/api/owner/breaks", null, authHeader());
  body.innerHTML = `
    <div class="owner-card">
      <h3>Новый перерыв</h3>
      <p class="form__hint" style="margin-bottom:10px">Действует ежедневно, например обед 13:00–14:00.</p>
      <form class="form" id="newBreakForm">
        <label>Начало<input type="time" name="start_time" required></label>
        <label>Конец<input type="time" name="end_time" required></label>
        <button class="btn btn--primary" type="submit">Добавить</button>
        <p class="form__msg" id="newBreakMsg"></p>
      </form>
    </div>`;
  body.querySelector("#newBreakForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("POST", "/api/owner/breaks", { start_time: f.start_time.value, end_time: f.end_time.value }, authHeader());
      renderBreaksTab(body);
    } catch (err) {
      body.querySelector("#newBreakMsg").textContent = err.message;
    }
  });

  breaks.forEach((b) => {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.innerHTML = `
      <div class="admin-row__info"><b>${b.start_time} – ${b.end_time}</b></div>
      <div class="admin-row__actions"><button class="btn btn--danger btn--sm">Удалить</button></div>`;
    row.querySelector("button").addEventListener("click", async () => {
      await api("DELETE", `/api/owner/breaks/${b.id}`, null, authHeader());
      renderBreaksTab(body);
    });
    body.appendChild(row);
  });
}

// ---------- Настройки (владелец) ----------
async function renderSettingsTab(body) {
  const s = await api("GET", "/api/owner/settings", null, authHeader());
  body.innerHTML = `
    <div class="owner-card">
      <h3>Основные данные</h3>
      <form class="form" id="settingsForm">
        <label>Название салона<input type="text" name="salon_name" value="${s.salon_name || ""}" required></label>
        <label>Адрес<input type="text" name="address" value="${s.address || ""}" required></label>
        <label>Телефон<input type="text" name="phone" value="${s.phone || ""}" required></label>
        <label>Начало работы<input type="time" name="work_start" value="${s.work_start || "10:00"}" required></label>
        <label>Конец работы<input type="time" name="work_end" value="${s.work_end || "21:00"}" required></label>
        <label>Интервал записи (мин)
          <select name="interval">
            <option value="15" ${s.interval === "15" ? "selected" : ""}>15 минут</option>
            <option value="30" ${s.interval === "30" ? "selected" : ""}>30 минут</option>
            <option value="60" ${s.interval === "60" ? "selected" : ""}>60 минут</option>
          </select>
        </label>

        <label>Instagram<input type="text" name="instagram" value="${s.instagram || ""}" placeholder="https://instagram.com/..."></label>
        <div class="switch-row"><input type="checkbox" id="instagram_show" ${s.instagram_show === "1" ? "checked" : ""}><label for="instagram_show" style="margin:0">Показывать на сайте</label></div>

        <label>WhatsApp<input type="text" name="whatsapp" value="${s.whatsapp || ""}" placeholder="https://wa.me/..."></label>
        <div class="switch-row"><input type="checkbox" id="whatsapp_show" ${s.whatsapp_show === "1" ? "checked" : ""}><label for="whatsapp_show" style="margin:0">Показывать на сайте</label></div>

        <label>TikTok<input type="text" name="tiktok" value="${s.tiktok || ""}" placeholder="https://tiktok.com/@..."></label>
        <div class="switch-row"><input type="checkbox" id="tiktok_show" ${s.tiktok_show === "1" ? "checked" : ""}><label for="tiktok_show" style="margin:0">Показывать на сайте</label></div>

        <button class="btn btn--primary" type="submit">Сохранить</button>
        <p class="form__msg" id="settingsMsg"></p>
      </form>
    </div>`;

  body.querySelector("#settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const msg = body.querySelector("#settingsMsg");
    try {
      await api("PUT", "/api/owner/settings", {
        salon_name: f.salon_name.value, address: f.address.value, phone: f.phone.value,
        work_start: f.work_start.value, work_end: f.work_end.value, interval: f.interval.value,
        instagram: f.instagram.value, instagram_show: body.querySelector("#instagram_show").checked,
        whatsapp: f.whatsapp.value, whatsapp_show: body.querySelector("#whatsapp_show").checked,
        tiktok: f.tiktok.value, tiktok_show: body.querySelector("#tiktok_show").checked,
      }, authHeader());
      msg.textContent = "Сохранено ✅"; msg.className = "form__msg ok";
      loadHome();
    } catch (err) {
      msg.textContent = err.message; msg.className = "form__msg err";
    }
  });
}

// =========================================================
// СТАРТ
// =========================================================
loadHome();
