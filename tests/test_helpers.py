import pytest

from mlops.deploy import _mib, _timestamp, psi
from mlops.jobs import merge
from mlops.project import ContractError
from mlops.run import flatten_metrics, flatten_params, render_command


def test_render_command():
    assert render_command("run {model} --x {x}", {"model": "/m.pt", "x": 2}) == "run /m.pt --x 2"
    with pytest.raises(ContractError, match="--dataset-path"):
        render_command("eval {dataset_path}", {})


def test_flatten_metrics_keeps_numbers_and_skips_hardware():
    data = {"mean": {"HOTA": 33.4, "ok": True}, "sequences": [1, 2], "hardware": {"cpu_count": 16}, "fps": 7}
    assert flatten_metrics(data) == {"mean.HOTA": 33.4, "fps": 7.0}


def test_flatten_params():
    assert flatten_params({"a": {"b": 1}, "c": [1, 2]}) == {"a.b": "1", "c": "[1, 2]"}


def test_merge_overrides_nested_values():
    assert merge({"a": 1, "b": {"c": 2, "d": 3}}, {"b": {"c": 5}, "e": 6}) == {"a": 1, "b": {"c": 5, "d": 3}, "e": 6}


def test_psi():
    assert psi([10, 20, 30], [10, 20, 30]) == pytest.approx(0)
    assert psi([10, 20, 30], [30, 20, 10]) > 0.25
    assert psi([10, 0], [10, 0]) == pytest.approx(0)


def test_docker_parsers():
    assert _timestamp("2026-10-01T02:43:20.5Z") - _timestamp("2026-10-01T02:43:20Z") == pytest.approx(0.5)
    assert _mib("1.5GiB") == 1536 and _mib("512MiB") == 512
