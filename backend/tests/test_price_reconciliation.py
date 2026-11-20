"""Pricing regressions. No live database, credentials, or external API calls."""
import asyncio
import copy
import importlib
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "poriadok_test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
server = importlib.import_module("server")
ensure_service_price = server._ensure_altegio_service_price_matches


def event(**updates):
    return {"id": "price-test", "title": "Ігри розуму", "price": 650.0,
            "base_price": 750.0, "price_tiers": [{"price": 650, "until": "2020-01-01"}],
            "altegio_service_id": 123, "archived": False, "cancelled": False, **updates}


def matches(row, query):
    for key, wanted in query.items():
        if key == "$or":
            if not any(matches(row, q) for q in wanted):
                return False
        elif key == "price_tiers.0":
            if bool(row.get("price_tiers")) != wanted["$exists"]:
                return False
        elif isinstance(wanted, dict) and "$ne" in wanted:
            if row.get(key) == wanted["$ne"]:
                return False
        elif row.get(key) != wanted:
            return False
    return True


class Events:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query, projection):
        async def to_list(limit):
            return copy.deepcopy([row for row in self.rows if matches(row, query)][:limit])
        return SimpleNamespace(to_list=to_list)

    async def update_one(self, query, update):
        for row in self.rows:
            if matches(row, query):
                row.update(copy.deepcopy(update["$set"]))
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def find_one(self, query, projection=None):
        return next((copy.deepcopy(row) for row in self.rows if matches(row, query)), None)


@pytest.fixture
def pricing(monkeypatch):
    rows = [event()]
    remote = {123: 650}
    writes = []
    monkeypatch.setattr(server, "db", SimpleNamespace(events=Events(rows)))
    monkeypatch.setattr(server, "ALTEGIO_PARTNER_TOKEN", "isolated-test")

    async def detail(sid):
        return {"ok": True, "data": {"price_min": remote[sid], "price_max": remote[sid]}}

    async def ensure(sid, price, *args, **kwargs):
        writes.append((sid, price))
        remote[sid] = price
        return {"price_min": price, "price_max": price}

    monkeypatch.setattr(server.altegio_client, "get_service_detail_result", detail)
    monkeypatch.setattr(server, "_ensure_altegio_service_price_matches", ensure)
    return SimpleNamespace(rows=rows, remote=remote, writes=writes, ensure=ensure)


def tick():
    asyncio.run(server._advance_early_bird_prices())


def test_failed_update_retries_after_restart_when_local_price_already_current(pricing, monkeypatch):
    async def unavailable(*args, **kwargs):
        raise server.HTTPException(status_code=503, detail="тимчасова помилка")
    monkeypatch.setattr(server, "_ensure_altegio_service_price_matches", unavailable)
    tick()
    row = pricing.rows[0]
    assert row["price"] == 750 and pricing.remote[123] == 650
    assert row["altegio_price_sync_pending"] is True
    assert row["altegio_price_sync_error"] == "тимчасова помилка"
    # Recreate the database wrapper: retry relies only on persisted state.
    monkeypatch.setattr(server, "db", SimpleNamespace(events=Events(pricing.rows)))
    monkeypatch.setattr(server, "_ensure_altegio_service_price_matches", pricing.ensure)
    tick()
    assert row["price"] == pricing.remote[123] == row["altegio_price_synced"] == 750
    assert row["altegio_price_sync_pending"] is False
    assert row["altegio_price_sync_error"] is None
    assert row["altegio_price_synced_at"]


def test_remote_drift_is_repaired_even_without_a_local_price_change(pricing):
    pricing.rows[0]["price"] = 750
    pricing.remote[123] = 699
    tick()
    assert pricing.remote[123] == 750
    assert pricing.writes == [(123, 750)]
    tick()
    assert len(pricing.writes) == 1  # fresh confirmation does not rewrite a matching price


def test_success_response_without_confirmed_remote_price_stays_pending(pricing, monkeypatch):
    async def ignored_update(*args, **kwargs):
        return {"price_min": 750, "price_max": 750}  # synthetic acknowledgement, not reality
    monkeypatch.setattr(server, "_ensure_altegio_service_price_matches", ignored_update)
    tick()
    assert pricing.rows[0]["altegio_price_sync_pending"] is True
    assert pricing.rows[0].get("altegio_price_synced_at") is None
    assert pricing.remote[123] == 650


def test_failed_fresh_read_cannot_use_a_stale_catalogue_as_proof(pricing, monkeypatch):
    async def failed_read(*args):
        return {"ok": False, "data": {"price_min": 750, "price_max": 750}}
    monkeypatch.setattr(server.altegio_client, "get_service_detail_result", failed_read)
    tick()
    assert pricing.rows[0]["altegio_price_sync_pending"] is True
    assert not pricing.writes


@pytest.mark.parametrize("missing", ["service", "token"])
def test_missing_configuration_remains_pending_and_recovers(pricing, monkeypatch, missing):
    if missing == "service":
        pricing.rows[0]["altegio_service_id"] = None
    else:
        monkeypatch.setattr(server, "ALTEGIO_PARTNER_TOKEN", "")
    tick()
    assert pricing.rows[0]["altegio_price_sync_pending"] is True
    pricing.rows[0]["altegio_service_id"] = 123
    monkeypatch.setattr(server, "ALTEGIO_PARTNER_TOKEN", "isolated-test")
    tick()
    assert pricing.rows[0]["altegio_price_sync_pending"] is False


def test_one_service_conflict_does_not_block_other_events(pricing, monkeypatch):
    pricing.rows.append(event(id="second", altegio_service_id=456))
    pricing.remote[456] = 650
    async def conflict(sid, price, *args, **kwargs):
        if sid == 123:
            raise server.HTTPException(status_code=409, detail="конфлікт спільної послуги")
        return await pricing.ensure(sid, price, *args, **kwargs)
    monkeypatch.setattr(server, "_ensure_altegio_service_price_matches", conflict)
    tick()
    assert pricing.rows[0]["altegio_price_sync_pending"] is True
    assert pricing.remote[123] == 650
    assert pricing.rows[1]["altegio_price_sync_pending"] is False
    assert pricing.remote[456] == 750


@pytest.mark.parametrize("flag", ["archived", "cancelled"])
def test_inactive_events_are_not_repriced(pricing, flag):
    pricing.rows[0][flag] = True
    tick()
    assert pricing.rows[0]["price"] == 650
    assert not pricing.writes


def test_pending_event_without_tiers_restores_full_price(pricing):
    pricing.rows[0].update(price_tiers=[], altegio_price_sync_pending=True)
    tick()
    assert pricing.rows[0]["price"] == pricing.remote[123] == 750


def test_removing_last_tier_restores_full_price():
    payload = event(price_tiers=[])
    server._apply_pricing(payload)
    assert payload["price"] == payload["base_price"] == 750


def test_concurrent_edit_is_not_overwritten_or_marked_synced(pricing, monkeypatch):
    async def detail(sid):
        pricing.rows[0].update(price=900, base_price=900, price_tiers=[])
        return {"ok": True, "data": {"price_min": 650, "price_max": 650}}
    monkeypatch.setattr(server.altegio_client, "get_service_detail_result", detail)
    tick()
    assert pricing.rows[0]["price"] == 900
    assert pricing.rows[0].get("altegio_price_synced_at") is None
    assert not pricing.writes


def test_service_helper_rechecks_snapshot_after_catalogue_read(pricing, monkeypatch):
    snapshot = copy.deepcopy(pricing.rows[0])
    async def catalog(**kwargs):
        pricing.rows[0].update(price=900, base_price=900)
        return [{"id": 123, "title": "Ігри розуму", "price_min": 650, "price_max": 650,
                 "active": True, "is_online": True, "capacity": 10}]
    async def forbidden_write(*args, **kwargs):
        raise AssertionError("застаріла ціна не повинна потрапити в Altegio")
    monkeypatch.setattr(server, "_get_altegio_services_cached", catalog)
    monkeypatch.setattr(server.altegio_client, "update_service_price_result", forbidden_write)
    with pytest.raises(server.HTTPException, match="подію змінено"):
        asyncio.run(ensure_service_price(123, 750, "price-test", expected_event_snapshot=snapshot))
    assert not pricing.writes


def test_cancellation_during_final_catalogue_read_prevents_patch(pricing, monkeypatch):
    snapshot = copy.deepcopy(pricing.rows[0])
    service = {"id": 123, "title": "Ігри розуму", "price_min": 650, "price_max": 650,
               "active": True, "is_online": True, "capacity": 10}
    async def helper_catalogue(**kwargs):
        return [service]
    async def updater_catalogue():
        pricing.rows[0]["cancelled"] = True
        return [service]
    sent = []
    def handler(request):
        sent.append(request.method)
        return httpx.Response(200, json={"data": {**service, "price_min": 750, "price_max": 750}})
    real_client = httpx.AsyncClient
    monkeypatch.setattr(server, "_get_altegio_services_cached", helper_catalogue)
    monkeypatch.setattr(server.altegio_client, "get_services", updater_catalogue)
    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(server.HTTPException, match="подію змінено"):
        asyncio.run(ensure_service_price(123, 750, "price-test", expected_event_snapshot=snapshot))
    assert sent == []


def test_tier_expires_at_kyiv_midnight(monkeypatch):
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 23, 22, 1, tzinfo=timezone.utc).astimezone(tz)
    monkeypatch.setattr(server, "datetime", FixedDateTime)
    tiers = [{"price": 650, "until": "2026-10-23"}]
    assert server._effective_price(750, tiers) == 750
    assert server._effective_price(750, tiers, "2026-10-23") == 650


def test_shibari_duration_payloads_are_valid_for_both_create_and_update(monkeypatch):
    requests = []
    def handler(request):
        import json
        requests.append(json.loads(request.content))
        return httpx.Response(201 if request.method == "POST" else 200, json={"data": {"id": 456}})
    real_client = httpx.AsyncClient
    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))
    monkeypatch.setattr(server, "ALTEGIO_PARTNER_TOKEN", "isolated-test")
    monkeypatch.setattr(server.altegio_client, "push_user_token", "isolated-test")
    async def run():
        args = dict(title="ШИБАРІ ПЕРФОРМАНС", date="2026-12-12", start_time="16:00", end_time="17:33", service_id=123)
        created = await server.altegio_client.create_activity_result(**args)
        updated = await server.altegio_client.update_activity_result(activity_id="456", **args)
        assert created["ok"] and updated["ok"]
        assert args["end_time"] == "17:33"
    asyncio.run(run())
    assert [r["length"] for r in requests] == [5700, 5700]
    assert all(r["date"] == "2026-12-12 16:00:00" for r in requests)
    assert server.altegio_client._calc_length_seconds("18:00", "21:00") == 10800
