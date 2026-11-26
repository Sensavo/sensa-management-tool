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
