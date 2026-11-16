from __future__ import annotations

import os
import sqlite3
import csv
import math
from contextlib import contextmanager
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import duckdb
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import PyMongoError


BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")
DATA_DIR = Path(os.getenv("VIVASAUDE_DATA_DIR", BACKEND_DIR / "data"))
SQLITE_PATH = Path(os.getenv("VIVASAUDE_SQLITE_PATH", DATA_DIR / "vivasaude.sqlite3"))
DUCKDB_PATH = Path(os.getenv("VIVASAUDE_DUCKDB_PATH", DATA_DIR / "vivasaude.duckdb"))
MONGO_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
AIR_QUALITY_API = "https://air-quality-api.open-meteo.com/v1/air-quality"

REGIONS = [
    {"code": "CPS", "name": "Campinas", "state": "SP", "population": 1_139_047, "latitude": -22.9056, "longitude": -47.0608, "base_cases": 742, "pm25": 8.6},
    {"code": "SAO", "name": "São Paulo", "state": "SP", "population": 11_451_245, "latitude": -23.5505, "longitude": -46.6333, "base_cases": 1_186, "pm25": 13.2},
    {"code": "RAO", "name": "Ribeirão Preto", "state": "SP", "population": 698_642, "latitude": -21.1704, "longitude": -47.8103, "base_cases": 486, "pm25": 10.1},
    {"code": "STS", "name": "Santos", "state": "SP", "population": 418_608, "latitude": -23.9608, "longitude": -46.3336, "base_cases": 356, "pm25": 16.4},
]

MONTH_LABELS = ("jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez")
DEMO_NOTICE = (
    "Atenção: atendimentos e população são dados sintéticos para demonstração; "
    "qualidade do ar aparece como demonstrativa até a primeira sincronização."
)

app = FastAPI(
    title="VivaSaúde API",
    description="Indicadores agregados para o observatório demonstrativo de saúde territorial.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@contextmanager
def sqlite_connection() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(SQLITE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def month_start(months_ago: int, today: date | None = None) -> date:
    reference = today or date.today()
    month_index = reference.year * 12 + reference.month - 1 - months_ago
    year, month = divmod(month_index, 12)
    return date(year, month + 1, 1)


def initialize_stores() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS regions (
                code TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                state TEXT NOT NULL,
                population INTEGER NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS health_visits (
                month TEXT NOT NULL,
                region_code TEXT NOT NULL REFERENCES regions(code),
                respiratory_visits INTEGER NOT NULL,
                total_visits INTEGER NOT NULL,
                source TEXT NOT NULL,
                PRIMARY KEY (month, region_code)
            );
            CREATE TABLE IF NOT EXISTS air_quality (
                observation_date TEXT NOT NULL,
                region_code TEXT NOT NULL REFERENCES regions(code),
                pm25 REAL NOT NULL,
                pm10 REAL NOT NULL,
                source TEXT NOT NULL,
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (observation_date, region_code)
            );
            """
        )
        for region in REGIONS:
            connection.execute(
                """
                INSERT OR IGNORE INTO regions (code, name, state, population, latitude, longitude)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (region["code"], region["name"], region["state"], region["population"], region["latitude"], region["longitude"]),
            )

        visit_count = connection.execute("SELECT COUNT(*) FROM health_visits").fetchone()[0]
        if visit_count == 0:
            for months_ago in range(6, -1, -1):
                month = month_start(months_ago)
                for index, region in enumerate(REGIONS):
                    seasonal_adjustment = ((month.month * 7 + index * 11) % 17) - 8
                    visits = max(1, region["base_cases"] + seasonal_adjustment * 4)
                    connection.execute(
                        """
                        INSERT INTO health_visits (month, region_code, respiratory_visits, total_visits, source)
                        VALUES (?, ?, ?, ?, 'Dados sintéticos de demonstração')
                        """,
                        (month.isoformat(), region["code"], visits, visits * 5 + 160),
                    )

        air_count = connection.execute("SELECT COUNT(*) FROM air_quality").fetchone()[0]
        if air_count == 0:
            now = datetime.now(timezone.utc).isoformat()
            today = date.today().isoformat()
            for region in REGIONS:
                connection.execute(
                    """
                    INSERT INTO air_quality (observation_date, region_code, pm25, pm10, source, fetched_at)
                    VALUES (?, ?, ?, ?, 'Dados de demonstração', ?)
                    """,
                    (today, region["code"], region["pm25"], region["pm25"] * 1.65, now),
                )

    refresh_analytics_store()


def refresh_analytics_store() -> None:
    DUCKDB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite_connection() as connection:
        visits = [tuple(row) for row in connection.execute(
            "SELECT month, region_code, respiratory_visits, total_visits, source FROM health_visits"
        )]
        air_quality = [tuple(row) for row in connection.execute(
            "SELECT observation_date, region_code, pm25, pm10, source, fetched_at FROM air_quality"
        )]

    with duckdb.connect(str(DUCKDB_PATH)) as analytics:
        analytics.execute(
            """
            CREATE TABLE IF NOT EXISTS health_visits_monthly (
                month DATE, region_code VARCHAR, respiratory_visits BIGINT,
                total_visits BIGINT, source VARCHAR
            )
            """
        )
        analytics.execute(
            """
            CREATE TABLE IF NOT EXISTS air_quality_daily (
                observation_date DATE, region_code VARCHAR, pm25 DOUBLE,
                pm10 DOUBLE, source VARCHAR, fetched_at TIMESTAMP WITH TIME ZONE
            )
            """
        )
        analytics.execute("DELETE FROM health_visits_monthly")
        analytics.execute("DELETE FROM air_quality_daily")
        if visits:
            analytics.executemany("INSERT INTO health_visits_monthly VALUES (?, ?, ?, ?, ?)", visits)
        if air_quality:
            analytics.executemany("INSERT INTO air_quality_daily VALUES (?, ?, ?, ?, ?, ?)", air_quality)


def latest_air_by_region(connection: sqlite3.Connection) -> dict[str, sqlite3.Row]:
    rows = connection.execute(
        """
        SELECT aq.region_code, aq.pm25, aq.pm10, aq.source, aq.fetched_at
        FROM air_quality AS aq
        JOIN (
            SELECT region_code, MAX(observation_date) AS observation_date
            FROM air_quality
            GROUP BY region_code
        ) AS latest
        ON aq.region_code = latest.region_code AND aq.observation_date = latest.observation_date
        """
    ).fetchall()
    return {row["region_code"]: row for row in rows}


def calculate_risk(pm25: float, change_percent: float) -> tuple[int, str]:
    score = round(min(100, max(0, 25 + pm25 * 2.7 + max(change_percent, 0) * 0.45)))
    status = "Alto" if score >= 75 else "Moderado" if score >= 55 else "Baixo"
    return score, status


def build_dashboard_data() -> dict[str, Any]:
    with sqlite_connection() as connection:
        visit_rows = connection.execute(
            """
            SELECT month, region_code, respiratory_visits, total_visits, source
            FROM health_visits ORDER BY month, region_code
            """
        ).fetchall()
        region_rows = connection.execute(
            "SELECT code, name, state, population FROM regions ORDER BY name"
        ).fetchall()
        air_rows = latest_air_by_region(connection)

    visits_by_month: dict[str, int] = defaultdict(int)
    visits_by_region_month: dict[tuple[str, str], int] = {}
    source_months: set[str] = set()
    for row in visit_rows:
        month = row["month"]
        visits_by_month[month] += row["respiratory_visits"]
        visits_by_region_month[(row["region_code"], month)] = row["respiratory_visits"]
        source_months.add(month)

    months = sorted(source_months)[-7:]
    monthly_trend = [
        {
            "label": MONTH_LABELS[int(month[5:7]) - 1],
            "cases": visits_by_month[month],
            "previous": visits_by_month.get(months[index - 1], 0) if index else 0,
        }
        for index, month in enumerate(months)
    ]
    latest_month = months[-1] if months else ""
    previous_month = months[-2] if len(months) > 1 else ""
    total_visits = visits_by_month.get(latest_month, 0)
    previous_total = visits_by_month.get(previous_month, 0)
    change_percent = round(((total_visits - previous_total) / previous_total) * 100, 1) if previous_total else 0.0

    regions: list[dict[str, Any]] = []
    sources: set[str] = set()
    for row in region_rows:
        air = air_rows.get(row["code"])
        pm25 = float(air["pm25"]) if air else 0.0
        source = str(air["source"]) if air else "Sem medições"
        sources.add(source)
        cases = visits_by_region_month.get((row["code"], latest_month), 0)
        previous_cases = visits_by_region_month.get((row["code"], previous_month), 0)
        region_change = round(((cases - previous_cases) / previous_cases) * 100, 1) if previous_cases else 0.0
        risk_score, status = calculate_risk(pm25, region_change)
        regions.append(
            {
                "code": row["code"],
                "name": row["name"],
                "state": row["state"],
                "population": row["population"],
                "cases": cases,
                "risk_score": risk_score,
                "status": status,
                "pm25": round(pm25, 1),
                "change_percent": region_change,
            }
        )

    alerts: list[dict[str, str]] = []
    for region in regions:
        if region["pm25"] > 15:
            alerts.append(
                {
                    "id": f"pm25-{region['code']}",
                    "level": "Alto" if region["pm25"] > 25 else "Atenção",
                    "title": f"PM2.5 acima do limite indicativo em {region['name']}",
                    "description": f"{region['pm25']:.1f} µg/m³ no registro mais recente. Avalie o contexto local.",
                    "region": region["name"],
                }
            )
        if region["change_percent"] >= 15:
            alerts.append(
                {
                    "id": f"visits-{region['code']}",
                    "level": "Atenção",
                    "title": f"Aumento de atendimentos em {region['name']}",
                    "description": f"Variação mensal de {region['change_percent']:.1f}% na série demonstrativa.",
                    "region": region["name"],
                }
            )

    average_pm25 = round(sum(region["pm25"] for region in regions) / max(len(regions), 1), 1)
    storage = get_storage_status()
    air_source = "Open-Meteo" if any("Open-Meteo" in source for source in sources) else "Demonstração"
    synthetic_visits = any("sintéticos" in row["source"] for row in visit_rows)
    if synthetic_visits and air_source == "Demonstração":
        notice = DEMO_NOTICE
    elif synthetic_visits:
        notice = (
            "Atendimentos e população são dados sintéticos; qualidade do ar veio da API Open-Meteo. "
            "Valide indicadores com profissionais de saúde pública."
        )
    else:
        notice = "Indicadores agregados; interpretações devem ser validadas por profissionais de saúde pública."
    sync_row = max((air["fetched_at"] for air in air_rows.values()), default=None)
    last_sync = sync_row if sync_row and air_source == "Open-Meteo" else None

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "last_sync": last_sync,
        "data_notice": notice,
        "air_quality_source": air_source,
        "metrics": {
            "respiratory_visits": total_visits,
            "change_percent": change_percent,
            "average_pm25": average_pm25,
            "alerts": len(alerts),
            "monitored_regions": len(regions),
        },
        "monthly_trend": monthly_trend,
        "regions": regions,
        "alerts": alerts,
        "storage": storage,
    }


def get_storage_status() -> dict[str, str]:
    try:
        with sqlite_connection() as connection:
            connection.execute("SELECT 1")
        sqlite_status = "connected"
    except sqlite3.Error:
        sqlite_status = "disconnected"

    try:
        with duckdb.connect(str(DUCKDB_PATH), read_only=True) as analytics:
            analytics.execute("SELECT 1")
        duckdb_status = "connected"
    except duckdb.Error:
        duckdb_status = "disconnected"

    mongo_status = "disconnected"
    client: MongoClient | None = None
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=900, connectTimeoutMS=900)
        client.admin.command("ping")
        mongo_status = "connected"
    except PyMongoError:
        mongo_status = "disconnected"
    finally:
        if client is not None:
            client.close()

    return {"sqlite": sqlite_status, "duckdb": duckdb_status, "mongodb": mongo_status}


def fetch_air_quality() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    fetched_at = datetime.now(timezone.utc).isoformat()
    measurements: list[dict[str, Any]] = []
    raw_documents: list[dict[str, Any]] = []

    for region in REGIONS:
        try:
            response = requests.get(
                AIR_QUALITY_API,
                params={
                    "latitude": region["latitude"],
                    "longitude": region["longitude"],
                    "hourly": "pm2_5,pm10",
                    "forecast_days": 1,
                    "timezone": "auto",
                },
                timeout=15,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as error:
            raise RuntimeError(f"Falha ao consultar a qualidade do ar para {region['name']}: {error}") from error

        if not isinstance(payload, dict):
            raise RuntimeError(f"A API de qualidade do ar retornou um formato inesperado para {region['name']}.")
        hourly = payload.get("hourly")
        if not isinstance(hourly, dict):
            raise RuntimeError(f"A API de qualidade do ar não retornou medições horárias para {region['name']}.")
        times = hourly.get("time", [])
        pm25_values = hourly.get("pm2_5", [])
        pm10_values = hourly.get("pm10", [])
        if not all(isinstance(values, list) for values in (times, pm25_values, pm10_values)):
            raise RuntimeError(f"A API retornou séries horárias inválidas para {region['name']}.")
        valid_rows = [
            (timestamp, pm25, pm10)
            for timestamp, pm25, pm10 in zip(times, pm25_values, pm10_values)
            if pm25 is not None and pm10 is not None
        ]
        if not valid_rows:
            raise RuntimeError(f"A API não retornou valores de PM2.5 e PM10 para {region['name']}.")

        daily_values: dict[str, list[tuple[float, float]]] = defaultdict(list)
        for timestamp, pm25, pm10 in valid_rows:
            try:
                pm25_value = float(pm25)
                pm10_value = float(pm10)
            except (TypeError, ValueError) as error:
                raise RuntimeError(f"A API retornou uma medição inválida para {region['name']}.") from error
            if not math.isfinite(pm25_value) or not math.isfinite(pm10_value) or pm25_value < 0 or pm10_value < 0:
                raise RuntimeError(f"A API retornou uma medição fora do intervalo esperado para {region['name']}.")
            daily_values[str(timestamp)[:10]].append((pm25_value, pm10_value))
        for observation_date, values in daily_values.items():
            measurements.append(
                {
                    "observation_date": observation_date,
                    "region_code": region["code"],
                    "pm25": round(sum(value[0] for value in values) / len(values), 2),
                    "pm10": round(sum(value[1] for value in values) / len(values), 2),
                    "source": "Open-Meteo Air Quality API",
                    "fetched_at": fetched_at,
                }
            )
        raw_documents.append(
            {
                "region_code": region["code"],
                "region_name": region["name"],
                "source": "Open-Meteo Air Quality API",
                "fetched_at": fetched_at,
                "payload": payload,
            }
        )

    return measurements, raw_documents


def persist_measurements(measurements: list[dict[str, Any]]) -> None:
    with sqlite_connection() as connection:
        connection.executemany(
            """
            INSERT INTO air_quality (observation_date, region_code, pm25, pm10, source, fetched_at)
            VALUES (:observation_date, :region_code, :pm25, :pm10, :source, :fetched_at)
            ON CONFLICT (observation_date, region_code) DO UPDATE SET
                pm25 = excluded.pm25,
                pm10 = excluded.pm10,
                source = excluded.source,
                fetched_at = excluded.fetched_at
            """,
            measurements,
        )
    refresh_analytics_store()


def archive_raw_documents(documents: list[dict[str, Any]]) -> None:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=1500, connectTimeoutMS=1500)
    try:
        client.admin.command("ping")
        collection = client["vivasaude"]["air_quality_raw"]
        collection.insert_many(documents, ordered=True)
    finally:
        client.close()


def synchronize_data() -> dict[str, Any]:
    measurements, raw_documents = fetch_air_quality()
    persist_measurements(measurements)
    warnings: list[str] = []
    try:
        archive_raw_documents(raw_documents)
    except PyMongoError as error:
        warnings.append(f"MongoDB não recebeu o arquivo bruto: {error}")
    dashboard = build_dashboard_data()
    dashboard["sync_warnings"] = warnings
    dashboard["synced_measurements"] = len(measurements)
    return dashboard


def import_hop_export() -> dict[str, Any]:
    export_path = Path(
        os.getenv(
            "VIVASAUDE_HOP_EXPORT",
            BACKEND_DIR.parent / "integrations" / "apache-hop" / "output" / "air_quality.csv",
        )
    )
    if not export_path.is_file():
        raise FileNotFoundError(
            f"Saída do Apache Hop não encontrada em {export_path}. Execute o pipeline e tente novamente."
        )

    fetched_at = datetime.now(timezone.utc).isoformat()
    measurements: list[dict[str, Any]] = []
    try:
        with export_path.open(newline="", encoding="utf-8-sig") as file:
            for row in csv.DictReader(file):
                timestamp = (row.get("observation_time") or "").strip()
                pm25 = float(row.get("pm25") or "nan")
                pm10 = float(row.get("pm10") or "nan")
                if not timestamp or not math.isfinite(pm25) or not math.isfinite(pm10) or pm25 < 0 or pm10 < 0:
                    raise ValueError("O CSV deve conter observation_time e valores não negativos de pm25 e pm10.")
                measurements.append(
                    {
                        "observation_date": date.fromisoformat(timestamp[:10]).isoformat(),
                        "region_code": "CPS",
                        "pm25": round(pm25, 2),
                        "pm10": round(pm10, 2),
                        "source": "Apache Hop / Open-Meteo",
                        "fetched_at": fetched_at,
                    }
                )
    except (OSError, ValueError, csv.Error) as error:
        raise ValueError(f"Não foi possível ler a saída do Apache Hop: {error}") from error
    if not measurements:
        raise ValueError("O CSV do Apache Hop não contém medições para importar.")

    persist_measurements(measurements)
    warnings: list[str] = []
    try:
        archive_raw_documents(
            [
                {
                    "region_code": "CPS",
                    "region_name": "Campinas",
                    "source": "Apache Hop / Open-Meteo",
                    "fetched_at": fetched_at,
                    "measurements": measurements,
                }
            ]
        )
    except PyMongoError as error:
        warnings.append(f"MongoDB não recebeu o arquivo bruto do Hop: {error}")
    dashboard = build_dashboard_data()
    dashboard["sync_warnings"] = warnings
    dashboard["synced_measurements"] = len(measurements)
    return dashboard


@app.on_event("startup")
def startup() -> None:
    initialize_stores()


@app.get("/api/health")
def health() -> dict[str, Any]:
    status = get_storage_status()
    return {"status": "ok", "storage": status}


@app.get("/api/dashboard")
def dashboard() -> dict[str, Any]:
    return build_dashboard_data()


@app.post("/api/sync")
def sync() -> dict[str, Any]:
    try:
        return synchronize_data()
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except sqlite3.Error as error:
        raise HTTPException(status_code=500, detail=f"Falha ao persistir a integração no SQLite: {error}") from error
    except duckdb.Error as error:
        raise HTTPException(status_code=500, detail=f"Falha ao atualizar o banco analítico DuckDB: {error}") from error


@app.post("/api/import-hop")
def import_hop() -> dict[str, Any]:
    try:
        return import_hop_export()
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except sqlite3.Error as error:
        raise HTTPException(status_code=500, detail=f"Falha ao importar o CSV para o SQLite: {error}") from error
    except duckdb.Error as error:
        raise HTTPException(status_code=500, detail=f"Falha ao atualizar o banco analítico DuckDB: {error}") from error


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "VivaSaúde API", "docs": "/docs", "dashboard": "/api/dashboard"}
