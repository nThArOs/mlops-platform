from mlops.progress import parse

TRAIN = "      Epoch    GPU_mem   box_loss\n        3/8         0G      1.572     0.8874      1.037         15        640: 45% ━━━━━──── 155/342 3.1s/it 9:18<8:24\n"
VALIDATE = TRAIN + "                 Class     Images  Instances      Box(P          R      mAP50  mAP50-95): 21% ━━╸ 7/33 1.5s/it 9.5s<38.5s\n"


def test_training_line():
    p = parse(TRAIN)
    assert p["epoch"] == 3 and p["epochs"] == 8 and p["phase"] == "running"
    assert abs(p["fraction"] - (2 + 155 / 342) / 8) < 1e-9


def test_validation_counts_the_epoch_as_trained():
    p = parse(VALIDATE)
    assert p["phase"] == "validating" and abs(p["fraction"] - 3 / 8) < 1e-9


def test_generic_marker_and_unknown():
    assert parse("[2/5] dut_anti_uav/test/video03: 100 frames")["fraction"] == 0.4
    assert parse("loading data") is None


def test_custom_patterns():
    p = parse("iteration 30 of 120", {"epoch": r"iteration (\d+) of (\d+)"})
    assert p["epoch"] == 30 and p["epochs"] == 120
