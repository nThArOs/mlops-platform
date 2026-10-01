from mlops import jobs


def test_log_keeps_last_state_of_progress_lines(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "job_dir", lambda job_id: tmp_path)
    (tmp_path / "log.txt").write_bytes(b"start\r\n\x1b[34mepoch\x1b[0m 1/8 10%\repoch 1/8 50%\repoch 1/8 100%\r\ndone\r\n")
    assert jobs.log(1)["text"].split("\n")[:3] == ["start", "epoch 1/8 100%", "done"]
    assert jobs.log(1, -1)["text"].startswith("start")


def test_sweep_points_become_nested_overrides():
    from mlops.jobs import _unflatten, merge

    assert merge({"baseline": {"conf": 0.1, "imgsz": 640}}, _unflatten({"baseline.conf": 0.2})) == \
        {"baseline": {"conf": 0.2, "imgsz": 640}}
