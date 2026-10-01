from mlops.yaml_comments import read

TEXT = """# Same settings for every modality.
# Second header line.
init: models/yolo11n.pt   # COCO weights
epochs: 30

# Images per step
batch: 16
url: "http://x#y"   # quoted hash
augment:
  # Flip left-right
  fliplr: 0.5
  mosaic: 1.0   # mosaic probability
"""


def test_header_and_keys():
    header, comments = read(TEXT)
    assert header == "Same settings for every modality. Second header line."
    assert comments == {
        "init": "COCO weights",
        "batch": "Images per step",
        "url": "quoted hash",
        "augment.fliplr": "Flip left-right",
        "augment.mosaic": "mosaic probability",
    }
