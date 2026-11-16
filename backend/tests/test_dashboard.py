import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import Mock, patch

import duckdb
from app import main


class DashboardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        self.sqlite_path = root / "test.sqlite3"
        self.duckdb_path = root / "test.duckdb"
        self.path_patches = [
            patch.object(main, "DATA_DIR", root),
            patch.object(main, "SQLITE_PATH", self.sqlite_path),
            patch.object(main, "DUCKDB_PATH", self.duckdb_path),
            patch.object(main, "get_storage_status", return_value={"sqlite": "connected", "duckdb": "connected", "mongodb": "disconnected"}),
        ]
        for patcher in self.path_patches:
            patcher.start()
        main.initialize_stores()

    def tearDown(self) -> None:
        for patcher in reversed(self.path_patches):
            patcher.stop()
        self.temporary_directory.cleanup()

    def test_seeded_dashboard_has_monthly_series_and_all_regions(self) -> None:
        dashboard = main.build_dashboard_data()

        self.assertEqual(len(dashboard["regions"]), 4)
        self.assertEqual(len(dashboard["monthly_trend"]), 7)
        self.assertEqual(dashboard["metrics"]["monitored_regions"], 4)
        self.assertTrue(any("sintéticos" in row["source"] for row in self._visit_rows()))

    def test_external_measurements_are_upserted_and_copied_to_duckdb(self) -> None:
        now = "2026-11-15T12:00:00+00:00"
        observation_date = date.today().isoformat()
        measurement = {
            "observation_date": observation_date,
            "region_code": "CPS",
            "pm25": 7.5,
            "pm10": 12.0,
            "source": "Open-Meteo Air Quality API",
            "fetched_at": now,
        }

        main.persist_measurements([measurement])
        main.persist_measurements([measurement | {"pm25": 8.5}])
        with main.sqlite_connection() as connection:
            stored = connection.execute(
                "SELECT pm25 FROM air_quality WHERE observation_date = ? AND region_code = ?",
                (observation_date, "CPS"),
            ).fetchone()
        with duckdb.connect(str(self.duckdb_path), read_only=True) as analytics:
            analytic_row = analytics.execute(
                "SELECT pm25 FROM air_quality_daily WHERE observation_date = ? AND region_code = ?",
                (observation_date, "CPS"),
            ).fetchone()

        self.assertEqual(stored["pm25"], 8.5)
        self.assertEqual(analytic_row[0], 8.5)
        dashboard = main.build_dashboard_data()
        self.assertEqual(dashboard["air_quality_source"], "Open-Meteo")
        self.assertIn("veio da API Open-Meteo", dashboard["data_notice"])
        self.assertNotIn("qualidade do ar aparece como demonstrativa", dashboard["data_notice"])

    def test_risk_scores_are_bounded_and_explainable(self) -> None:
        score, status = main.calculate_risk(10, 5)

        self.assertEqual(score, 54)
        self.assertEqual(status, "Baixo")
        self.assertEqual(main.calculate_risk(30, 30)[0], 100)

    def test_external_hourly_values_are_consolidated_by_date(self) -> None:
        payload = {
            "hourly": {
                "time": ["2026-11-15T00:00", "2026-11-15T01:00", "2026-11-16T00:00"],
                "pm2_5": [6.0, 10.0, 8.0],
                "pm10": [12.0, 16.0, 14.0],
            }
        }
        response = Mock()
        response.json.return_value = payload
        response.raise_for_status.return_value = None

        with patch("app.main.requests.get", return_value=response):
            measurements, raw_documents = main.fetch_air_quality()

        self.assertEqual(len(measurements), len(main.REGIONS) * 2)
        self.assertEqual(measurements[0]["pm25"], 8.0)
        self.assertEqual(measurements[0]["pm10"], 14.0)
        self.assertEqual(len(raw_documents), len(main.REGIONS))

    def test_apache_hop_csv_is_imported_into_operational_and_analytic_stores(self) -> None:
        export_path = Path(self.temporary_directory.name) / "air_quality.csv"
        observation_date = date.today().isoformat()
        export_path.write_text(
            f"observation_time,pm25,pm10\n{observation_date}T00:00,7.25,12.5\n",
            encoding="utf-8",
        )

        with patch.dict("os.environ", {"VIVASAUDE_HOP_EXPORT": str(export_path)}):
            with patch.object(main, "archive_raw_documents"):
                dashboard = main.import_hop_export()

        with main.sqlite_connection() as connection:
            row = connection.execute(
                "SELECT pm25, source FROM air_quality WHERE observation_date = ? AND region_code = ?",
                (observation_date, "CPS"),
            ).fetchone()
        self.assertEqual(row["pm25"], 7.25)
        self.assertEqual(row["source"], "Apache Hop / Open-Meteo")
        self.assertEqual(dashboard["air_quality_source"], "Open-Meteo")
        with duckdb.connect(str(self.duckdb_path), read_only=True) as analytics:
            self.assertEqual(
                analytics.execute(
                    "SELECT pm10 FROM air_quality_daily WHERE observation_date = ? AND region_code = ?",
                    (observation_date, "CPS"),
                ).fetchone()[0],
                12.5,
            )

    def _visit_rows(self) -> list:
        with main.sqlite_connection() as connection:
            return connection.execute("SELECT source FROM health_visits").fetchall()


if __name__ == "__main__":
    unittest.main()
