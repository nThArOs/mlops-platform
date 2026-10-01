import pytest
import yaml

from mlops.project import ContractError, load_project, split_key

BASE = {
    "name": "demo",
    "image": "demo:cpu",
    "entrypoints": {"train": {"command": "python train.py"}, "evaluate": {"command": "python eval.py"}},
    "metrics": {"primary": "f1", "higher_is_better": True},
}


def write(tmp_path, data):
    (tmp_path / "project.yaml").write_text(yaml.safe_dump(data))
    return tmp_path


def test_minimal_project(tmp_path):
    project = load_project(write(tmp_path, BASE))
    assert project.model_key(None) == "demo"
    assert project.image_for(None) == "demo:cpu"
    assert project.workdir == "/app"


@pytest.mark.parametrize("change, message", [
    ({"entrypoints": {"train": {"command": "x"}}}, "missing entrypoints"),
    ({"metrics": {"primary": "f1"}}, "metrics.higher_is_better"),
    ({"name": "Bad Name"}, "name"),
    ({"datasets": [{"name": "d", "mount": "/abs"}]}, "relative"),
])
def test_invalid_contracts(tmp_path, change, message):
    with pytest.raises(ContractError, match=message):
        load_project(write(tmp_path, {**BASE, **change}))


def test_several_models(tmp_path):
    data = {**BASE, "models": {"rgb": {"vars": {"input": "rgb"}, "image": "rgb:cpu"}, "res": {"vars": {"input": "res"}}}}
    project = load_project(write(tmp_path, data))
    assert project.model_key("rgb") == "demo.rgb"
    assert project.slot_vars("res") == {"input": "res"}
    assert project.image_for("rgb") == "rgb:cpu" and project.image_for("res") == "demo:cpu"
    with pytest.raises(ContractError, match="several models"):
        project.model_key(None)
    with pytest.raises(ContractError, match="unknown model"):
        project.model_key("thermal")


def test_split_key():
    assert split_key("demo.rgb") == ("demo", "rgb")
    assert split_key("demo") == ("demo", None)
