import importlib
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException


os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "poriadok_test")

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

server = importlib.import_module("server")


def test_month_bounds_covers_whole_month():
    assert server._finance_month_bounds("2026-11") == ("2026-11-01", "2026-11-30")
    assert server._finance_month_bounds("2026-12") == ("2026-12-01", "2026-12-31")
    assert server._finance_month_bounds("2028-02") == ("2028-02-01", "2028-02-29")


def test_month_bounds_rejects_garbage():
    with pytest.raises(HTTPException):
        server._finance_month_bounds("листопад")


def test_transaction_date_is_kyiv_day():
    # Altegio віддає час із власним зсувом +0400: 00:30 там — це ще 22:30
    # попереднього київського дня, і гроші належать тому дню.
    assert server._finance_tx_date("2026-11-25T17:33:23+0400") == "2026-11-25"
    assert server._finance_tx_date("2026-11-26T00:30:00+0400") == "2026-11-25"
    assert server._finance_tx_date("") == server._today_kyiv()


def test_category_from_altegio_row():
    service = {"sold_item_type": "service", "expense": {"title": "Services rendered"}}
    deposit = {"sold_item_type": "deposit_topup", "expense": {"title": "Client account top-up"}}
    fee = {"sold_item_type": None, "expense": {"title": "Acquiring fee"}}
    salary = {"sold_item_type": None, "expense": {"title": "Salary"}}
    assert server._finance_tx_category(service, "in") == "квитки"
    assert server._finance_tx_category(deposit, "in") == "квитки"
    assert server._finance_tx_category(fee, "out") == "інше"
    assert server._finance_tx_category(salary, "out") == "зарплата"


def test_counterparty_prefers_client_name():
    row = {"client": {"name": "Юрій", "surname": "Кравцов"}, "master": [], "supplier": []}
    assert server._finance_tx_counterparty(row) == "Юрій Кравцов"
    assert server._finance_tx_counterparty({"client": {}, "master": {"name": "Оля"}}) == "Оля"
    assert server._finance_tx_counterparty({}) is None


def test_validation_guards_categories_and_sources():
    server._finance_validate("out", "майстер", "confirmed", "manual")
    with pytest.raises(HTTPException):
        server._finance_validate("out", "квитки", "confirmed", "manual")
    with pytest.raises(HTTPException):
        server._finance_validate("вбік", "інше", "confirmed", "manual")
    with pytest.raises(HTTPException):
        server._finance_validate("out", "інше", "draft", "manual")
    with pytest.raises(HTTPException):
        server._finance_validate("out", "інше", "confirmed", "довільне")


class _FakeLLM:
    """Підміна _llm_text: парсер має витримувати будь-яку відповідь моделі."""

    def __init__(self, reply):
        self.reply = reply
        self.prompt = None

    async def __call__(self, system_prompt, user_prompt, max_tokens=1200):
        self.prompt = user_prompt
        return self.reply


def _parse(monkeypatch, reply, text="заплатив олі тисячу двісті за кадл"):
    import asyncio

    fake = _FakeLLM(reply)
    monkeypatch.setattr(server, "_llm_text", fake)

    async def no_events():
        return {"today": "2026-11-26", "events": []}

    monkeypatch.setattr(server, "_finance_parser_context", no_events)
    return asyncio.get_event_loop().run_until_complete(server._parse_finance_text(text)), fake


def test_parser_reads_json_in_code_fence(monkeypatch):
    reply = '```json\n{"direction":"out","amount":1200,"date":"2026-11-29","category":"майстер","counterparty":"Оля","event_id":null,"comment":"кадл","confidence":0.9}\n```'
    parsed, _ = _parse(monkeypatch, reply)
    assert parsed["amount"] == 1200.0
    assert parsed["category"] == "майстер"
    assert parsed["counterparty"] == "Оля"
    assert parsed["missing"] == []


def test_parser_keeps_entry_without_amount(monkeypatch):
    reply = '{"direction":"out","amount":null,"date":"2026-11-26","category":"оренда","counterparty":null,"event_id":null,"comment":"","confidence":0.8}'
    parsed, _ = _parse(monkeypatch, reply)
    assert parsed["amount"] == 0.0
    assert parsed["missing"] == ["amount"]


def test_parser_rejects_invented_category_event_and_date(monkeypatch):
    reply = 'ось: {"direction":"in","amount":"599","date":"не знаю","category":"вигадана","counterparty":"  ","event_id":"нема-такої","comment":"","confidence":2}'
    parsed, _ = _parse(monkeypatch, reply)
    assert parsed["category"] == "інше"          # не зі списку → «інше»
    assert parsed["confidence"] <= 0.5           # і довіра донизу
    assert parsed["date"] == "2026-11-26"        # нечитабельна дата → сьогодні
    assert parsed["event_id"] is None            # подія не з контексту → None
    assert parsed["counterparty"] is None


def test_parser_returns_none_when_model_fails(monkeypatch):
    parsed, _ = _parse(monkeypatch, "не JSON взагалі")
    assert parsed is None


def test_parser_prompt_carries_today_and_categories(monkeypatch):
    reply = '{"direction":"out","amount":10,"date":"2026-11-26","category":"інше","counterparty":null,"event_id":null,"comment":"","confidence":0.9}'
    _, fake = _parse(monkeypatch, reply)
    assert "сьогодні 2026-11-26" in fake.prompt
    assert "майстер" in fake.prompt and "зарплата" in fake.prompt
