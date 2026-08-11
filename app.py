import base64
import traceback
from datetime import datetime, timedelta, date as date_cls
from typing import Optional

import aiosqlite
from fastapi import FastAPI, Depends, HTTPException, Header, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# =========================================================
# НАСТРОЙКИ — пароли можно поменять здесь
# =========================================================
ADMIN_PASSWORD = "BECAUSE2011"
OWNER_PASSWORD = "Go2022"
DB_PATH = "salon.db"

app = FastAPI()
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# =========================================================
# БАЗА ДАННЫХ
# =========================================================
SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL DEFAULT 0,
    duration_min INTEGER DEFAULT 60,
    is_active INTEGER DEFAULT 1,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS masters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    age INTEGER,
    photo_base64 TEXT,
    is_month INTEGER DEFAULT 0,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT,
    is_featured INTEGER DEFAULT 0,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS breaks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT,
    end_time TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT,
    phone TEXT,
    appt_date TEXT,
    appt_time TEXT,
    total_price REAL DEFAULT 0,
    total_duration INTEGER DEFAULT 0,
    comment TEXT,
    status TEXT DEFAULT 'confirmed',
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS booking_services (
    booking_id INTEGER,
    service_id INTEGER,
    PRIMARY KEY (booking_id, service_id)
);

CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    error_text TEXT,
    tb_text TEXT,
    created_at TEXT
);
"""

DEFAULT_SETTINGS = {
    "salon_name": "Beauty Salon",
    "address": "ул. Примерная, 1",
    "phone": "+7 700 000 00 00",
    "work_start": "10:00",
    "work_end": "21:00",
    "interval": "30",
    "instagram": "",
    "instagram_show": "0",
    "whatsapp": "",
    "whatsapp_show": "0",
    "tiktok": "",
    "tiktok_show": "0",
}


async def db_init():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(SCHEMA)
        for k, v in DEFAULT_SETTINGS.items():
            await db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
        await db.commit()


async def log_error(err_text: str, tb_text: str):
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO error_log (error_text, tb_text, created_at) VALUES (?, ?, ?)",
                (err_text, tb_text, datetime.now().isoformat(timespec="seconds")),
            )
            await db.commit()
    except Exception:
        pass


@app.on_event("startup")
async def on_startup():
    await db_init()


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    await log_error(str(exc), traceback.format_exc())
    return JSONResponse(status_code=500, content={"detail": "Внутренняя ошибка сервера. Попробуйте ещё раз."})


async def get_setting(key: str, default: str = "") -> str:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = await cur.fetchone()
        return row[0] if row else default


async def set_setting(key: str, value: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        await db.commit()


# =========================================================
# АВТОРИЗАЦИЯ ПО ПАРОЛЮ
# =========================================================
def check_role(x_auth: Optional[str]) -> Optional[str]:
    if x_auth == OWNER_PASSWORD:
        return "owner"
    if x_auth == ADMIN_PASSWORD:
        return "admin"
    return None


async def require_admin(x_auth: Optional[str] = Header(None)):
    role = check_role(x_auth)
    if role not in ("admin", "owner"):
        raise HTTPException(status_code=401, detail="Неверный пароль.")
    return role


async def require_owner(x_auth: Optional[str] = Header(None)):
    role = check_role(x_auth)
    if role != "owner":
        raise HTTPException(status_code=401, detail="Неверный пароль владельца.")
    return role


@app.post("/api/auth/check")
async def auth_check(payload: dict):
    role = check_role(payload.get("password"))
    if not role:
        raise HTTPException(status_code=401, detail="Неверный пароль.")
    return {"role": role}


# =========================================================
# СЛОТЫ ВРЕМЕНИ
# =========================================================
def to_minutes(t: str) -> int:
    h, m = map(int, t.split(":"))
    return h * 60 + m


def to_hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


async def compute_free_slots(appt_date: str, total_duration: int, exclude_booking_id: int = None):
    work_start = await get_setting("work_start", "10:00")
    work_end = await get_setting("work_end", "21:00")
    interval = int(await get_setting("interval", "30"))

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT start_time, end_time FROM breaks")
        breaks = [(to_minutes(r["start_time"]), to_minutes(r["end_time"])) for r in await cur.fetchall()]

        query = "SELECT appt_time, total_duration FROM bookings WHERE appt_date = ? AND status = 'confirmed'"
        params = [appt_date]
        if exclude_booking_id:
            query += " AND id != ?"
            params.append(exclude_booking_id)
        cur = await db.execute(query, params)
        busy = [(to_minutes(r["appt_time"]), to_minutes(r["appt_time"]) + r["total_duration"]) for r in await cur.fetchall()]

    start_m, end_m = to_minutes(work_start), to_minutes(work_end)
    now = datetime.now()
    is_today = appt_date == date_cls.today().isoformat()

    slots = []
    t = start_m
    while t + total_duration <= end_m:
        end_t = t + total_duration
        conflict = any(t < be and end_t > bs for bs, be in busy + breaks)
        if is_today and t <= now.hour * 60 + now.minute:
            conflict = True
        if not conflict:
            slots.append(to_hhmm(t))
        t += interval
    return slots


# =========================================================
# ПУБЛИЧНЫЕ ЭНДПОИНТЫ
# =========================================================
@app.get("/api/public/home")
async def public_home():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        settings = {}
        cur = await db.execute("SELECT key, value FROM settings")
        for r in await cur.fetchall():
            settings[r["key"]] = r["value"]

        cur = await db.execute("SELECT AVG(rating) as avg_r, COUNT(*) as cnt FROM reviews")
        rating_row = await cur.fetchone()

        cur = await db.execute(
            "SELECT * FROM reviews WHERE is_featured = 1 ORDER BY id DESC LIMIT 1"
        )
        featured = await cur.fetchone()

        cur = await db.execute("SELECT * FROM masters WHERE is_month = 1")
        masters_of_month = await cur.fetchall()

        cur = await db.execute("SELECT * FROM services WHERE is_active = 1 ORDER BY created_at LIMIT 3")
        preview_services = await cur.fetchall()

        cur = await db.execute("SELECT COUNT(*) as c FROM services WHERE is_active = 1")
        total_services = (await cur.fetchone())["c"]

    return {
        "salon_name": settings.get("salon_name", ""),
        "address": settings.get("address", ""),
        "phone": settings.get("phone", ""),
        "work_start": settings.get("work_start", ""),
        "work_end": settings.get("work_end", ""),
        "socials": {
            "instagram": settings.get("instagram", "") if settings.get("instagram_show") == "1" else "",
            "whatsapp": settings.get("whatsapp", "") if settings.get("whatsapp_show") == "1" else "",
            "tiktok": settings.get("tiktok", "") if settings.get("tiktok_show") == "1" else "",
        },
        "rating": {
            "avg": round(rating_row["avg_r"], 1) if rating_row["avg_r"] else None,
            "count": rating_row["cnt"],
        },
        "featured_review": dict(featured) if featured else None,
        "masters_of_month": [dict(m) for m in masters_of_month],
        "services_preview": [dict(s) for s in preview_services],
        "total_services": total_services,
    }


@app.get("/api/public/services")
async def public_services():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM services WHERE is_active = 1 ORDER BY name")
        return [dict(r) for r in await cur.fetchall()]


@app.get("/api/public/masters")
async def public_masters():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM masters ORDER BY is_month DESC, name")
        return [dict(r) for r in await cur.fetchall()]


@app.get("/api/public/reviews")
async def public_reviews():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM reviews ORDER BY id DESC LIMIT 50")
        return [dict(r) for r in await cur.fetchall()]


class ReviewIn(BaseModel):
    client_name: str
    rating: int
    comment: Optional[str] = ""


@app.post("/api/public/reviews")
async def create_review(review: ReviewIn):
    if not (1 <= review.rating <= 5):
        raise HTTPException(status_code=400, detail="Оценка должна быть от 1 до 5.")
    if not review.client_name.strip():
        raise HTTPException(status_code=400, detail="Укажите имя.")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO reviews (client_name, rating, comment, created_at) VALUES (?, ?, ?, ?)",
            (review.client_name.strip(), review.rating, (review.comment or "").strip(),
             datetime.now().isoformat(timespec="seconds")),
        )
        await db.commit()
    return {"ok": True}


@app.get("/api/public/availability")
async def public_availability(appt_date: str, service_ids: str):
    ids = [int(x) for x in service_ids.split(",") if x.strip().isdigit()]
    if not ids:
        raise HTTPException(status_code=400, detail="Выберите хотя бы одну услугу.")
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        placeholders = ",".join("?" * len(ids))
        cur = await db.execute(f"SELECT SUM(duration_min) as total FROM services WHERE id IN ({placeholders})", ids)
        total_duration = (await cur.fetchone())["total"] or 0
    if total_duration == 0:
        raise HTTPException(status_code=400, detail="Услуги не найдены.")
    slots = await compute_free_slots(appt_date, total_duration)
    return {"slots": slots, "total_duration": total_duration}


class BookingIn(BaseModel):
    client_name: str
    phone: str
    appt_date: str
    appt_time: str
    service_ids: list[int]
    comment: Optional[str] = ""


@app.post("/api/public/bookings")
async def create_booking(booking: BookingIn):
    if not booking.client_name.strip() or not booking.phone.strip():
        raise HTTPException(status_code=400, detail="Укажите имя и телефон.")
    if not booking.service_ids:
        raise HTTPException(status_code=400, detail="Выберите хотя бы одну услугу.")

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        placeholders = ",".join("?" * len(booking.service_ids))
        cur = await db.execute(f"SELECT * FROM services WHERE id IN ({placeholders}) AND is_active = 1", booking.service_ids)
        services = await cur.fetchall()
        if not services:
            raise HTTPException(status_code=400, detail="Выбранные услуги недоступны.")
        total_price = sum(s["price"] for s in services)
        total_duration = sum(s["duration_min"] for s in services)

        free_slots = await compute_free_slots(booking.appt_date, total_duration)
        if booking.appt_time not in free_slots:
            raise HTTPException(status_code=409, detail="Это время уже занято, выберите другое.")

        cur = await db.execute(
            "INSERT INTO bookings (client_name, phone, appt_date, appt_time, total_price, total_duration, "
            "comment, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)",
            (booking.client_name.strip(), booking.phone.strip(), booking.appt_date, booking.appt_time,
             total_price, total_duration, (booking.comment or "").strip(),
             datetime.now().isoformat(timespec="seconds")),
        )
        booking_id = cur.lastrowid
        for s in services:
            await db.execute("INSERT INTO booking_services (booking_id, service_id) VALUES (?, ?)", (booking_id, s["id"]))
        await db.commit()

    return {"ok": True, "booking_id": booking_id, "total_price": total_price, "total_duration": total_duration}


# =========================================================
# АДМИН: ЗАПИСИ + ОТЗЫВЫ
# =========================================================
async def _booking_with_services(row) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT s.name FROM booking_services bs JOIN services s ON s.id = bs.service_id WHERE bs.booking_id = ?",
            (row["id"],),
        )
        services = [r["name"] for r in await cur.fetchall()]
    d = dict(row)
    d["services"] = services
    return d


@app.get("/api/admin/bookings")
async def admin_bookings(role: str = Depends(require_admin)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM bookings WHERE status != 'cancelled' ORDER BY appt_date, appt_time")
        rows = await cur.fetchall()
    return [await _booking_with_services(r) for r in rows]


@app.post("/api/admin/bookings")
async def admin_create_booking(booking: BookingIn, role: str = Depends(require_admin)):
    return await create_booking(booking)


@app.delete("/api/admin/bookings/{booking_id}")
async def admin_delete_booking(booking_id: int, role: str = Depends(require_admin)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE bookings SET status = 'cancelled' WHERE id = ?", (booking_id,))
        await db.commit()
    return {"ok": True}


@app.get("/api/admin/reviews")
async def admin_reviews(role: str = Depends(require_admin)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM reviews ORDER BY id DESC")
        return [dict(r) for r in await cur.fetchall()]


@app.delete("/api/admin/reviews/{review_id}")
async def admin_delete_review(review_id: int, role: str = Depends(require_admin)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM reviews WHERE id = ?", (review_id,))
        await db.commit()
    return {"ok": True}


@app.post("/api/admin/reviews/{review_id}/feature")
async def admin_feature_review(review_id: int, role: str = Depends(require_admin)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE reviews SET is_featured = 0")
        await db.execute("UPDATE reviews SET is_featured = 1 WHERE id = ?", (review_id,))
        await db.commit()
    return {"ok": True}


@app.post("/api/admin/reviews/{review_id}/unfeature")
async def admin_unfeature_review(review_id: int, role: str = Depends(require_admin)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE reviews SET is_featured = 0 WHERE id = ?", (review_id,))
        await db.commit()
    return {"ok": True}


# =========================================================
# ВЛАДЕЛЕЦ: НАСТРОЙКИ / УСЛУГИ / МАСТЕРА / ФИЛИАЛЫ / ПЕРЕРЫВЫ
# =========================================================
class SettingsIn(BaseModel):
    salon_name: str
    address: str
    phone: str
    work_start: str
    work_end: str
    interval: str
    instagram: str = ""
    instagram_show: bool = False
    whatsapp: str = ""
    whatsapp_show: bool = False
    tiktok: str = ""
    tiktok_show: bool = False


@app.get("/api/owner/settings")
async def owner_get_settings(role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT key, value FROM settings")
        return {r["key"]: r["value"] for r in await cur.fetchall()}


@app.put("/api/owner/settings")
async def owner_update_settings(payload: SettingsIn, role: str = Depends(require_owner)):
    values = {
        "salon_name": payload.salon_name, "address": payload.address, "phone": payload.phone,
        "work_start": payload.work_start, "work_end": payload.work_end, "interval": payload.interval,
        "instagram": payload.instagram, "instagram_show": "1" if payload.instagram_show else "0",
        "whatsapp": payload.whatsapp, "whatsapp_show": "1" if payload.whatsapp_show else "0",
        "tiktok": payload.tiktok, "tiktok_show": "1" if payload.tiktok_show else "0",
    }
    for k, v in values.items():
        await set_setting(k, v)
    return {"ok": True}


@app.get("/api/owner/breaks")
async def owner_get_breaks(role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM breaks ORDER BY start_time")
        return [dict(r) for r in await cur.fetchall()]


class BreakIn(BaseModel):
    start_time: str
    end_time: str


@app.post("/api/owner/breaks")
async def owner_add_break(payload: BreakIn, role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("INSERT INTO breaks (start_time, end_time) VALUES (?, ?)", (payload.start_time, payload.end_time))
        await db.commit()
        return {"ok": True, "id": cur.lastrowid}


@app.delete("/api/owner/breaks/{break_id}")
async def owner_delete_break(break_id: int, role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM breaks WHERE id = ?", (break_id,))
        await db.commit()
    return {"ok": True}


class ServiceIn(BaseModel):
    name: str
    description: Optional[str] = ""
    price: float
    duration_min: int


@app.get("/api/owner/services")
async def owner_get_services(role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM services ORDER BY name")
        return [dict(r) for r in await cur.fetchall()]


@app.post("/api/owner/services")
async def owner_add_service(payload: ServiceIn, role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO services (name, description, price, duration_min, is_active, created_at) "
            "VALUES (?, ?, ?, ?, 1, ?)",
            (payload.name, payload.description, payload.price, payload.duration_min,
             datetime.now().isoformat(timespec="seconds")),
        )
        await db.commit()
        return {"ok": True, "id": cur.lastrowid}


@app.put("/api/owner/services/{service_id}")
async def owner_update_service(service_id: int, payload: ServiceIn, role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE services SET name = ?, description = ?, price = ?, duration_min = ? WHERE id = ?",
            (payload.name, payload.description, payload.price, payload.duration_min, service_id),
        )
        await db.commit()
    return {"ok": True}


@app.post("/api/owner/services/{service_id}/toggle")
async def owner_toggle_service(service_id: int, role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT is_active FROM services WHERE id = ?", (service_id,))
        row = await cur.fetchone()
        new_val = 0 if row["is_active"] else 1
        await db.execute("UPDATE services SET is_active = ? WHERE id = ?", (new_val, service_id))
        await db.commit()
    return {"ok": True, "is_active": bool(new_val)}


@app.delete("/api/owner/services/{service_id}")
async def owner_delete_service(service_id: int, role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT COUNT(*) as c FROM booking_services WHERE service_id = ?", (service_id,))
        used = (await cur.fetchone())["c"]
        if used:
            await db.execute("UPDATE services SET is_active = 0 WHERE id = ?", (service_id,))
            await db.commit()
            return {"ok": True, "hidden_instead": True}
        await db.execute("DELETE FROM services WHERE id = ?", (service_id,))
        await db.commit()
    return {"ok": True, "hidden_instead": False}


@app.get("/api/owner/masters")
async def owner_get_masters(role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM masters ORDER BY name")
        return [dict(r) for r in await cur.fetchall()]


@app.post("/api/owner/masters")
async def owner_add_master(
    name: str = Form(...), age: Optional[int] = Form(None), photo: Optional[UploadFile] = File(None),
    role: str = Depends(require_owner),
):
    photo_b64 = None
    if photo is not None:
        content = await photo.read()
        photo_b64 = f"data:{photo.content_type};base64,{base64.b64encode(content).decode()}"
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO masters (name, age, photo_base64, is_month, created_at) VALUES (?, ?, ?, 0, ?)",
            (name, age, photo_b64, datetime.now().isoformat(timespec="seconds")),
        )
        await db.commit()
        return {"ok": True, "id": cur.lastrowid}


@app.post("/api/owner/masters/{master_id}/toggle_month")
async def owner_toggle_master_month(master_id: int, role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT is_month FROM masters WHERE id = ?", (master_id,))
        row = await cur.fetchone()
        new_val = 0 if row["is_month"] else 1
        await db.execute("UPDATE masters SET is_month = ? WHERE id = ?", (new_val, master_id))
        await db.commit()
    return {"ok": True, "is_month": bool(new_val)}


@app.delete("/api/owner/masters/{master_id}")
async def owner_delete_master(master_id: int, role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM masters WHERE id = ?", (master_id,))
        await db.commit()
    return {"ok": True}


class BranchIn(BaseModel):
    name: str
    address: str = ""
    phone: str = ""


@app.get("/api/owner/branches")
async def owner_get_branches(role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM branches ORDER BY name")
        return [dict(r) for r in await cur.fetchall()]


@app.post("/api/owner/branches")
async def owner_add_branch(payload: BranchIn, role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO branches (name, address, phone, created_at) VALUES (?, ?, ?, ?)",
            (payload.name, payload.address, payload.phone, datetime.now().isoformat(timespec="seconds")),
        )
        await db.commit()
        return {"ok": True, "id": cur.lastrowid}


@app.delete("/api/owner/branches/{branch_id}")
async def owner_delete_branch(branch_id: int, role: str = Depends(require_owner)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM branches WHERE id = ?", (branch_id,))
        await db.commit()
    return {"ok": True}


# =========================================================
# СТАТИКА
# =========================================================
@app.get("/")
async def index():
    return FileResponse("index.html")


@app.get("/style.css")
async def style():
    return FileResponse("style.css", media_type="text/css")


@app.get("/app.js")
async def javascript():
    return FileResponse("app.js", media_type="application/javascript")
