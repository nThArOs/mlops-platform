import os
import stat

from mlops.store import Store, file_hash


def make(folder, files):
    for rel, text in files.items():
        path = folder / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)


def test_identical_files_are_stored_once(tmp_path):
    src = tmp_path / "src"
    make(src, {"a.txt": "same", "b/c.txt": "same", "d.txt": "other"})
    store = Store(tmp_path / "store")
    files, counts = store.add_folder(src, link=False)
    assert counts == {"linked": 0, "copied": 2, "existing": 1}
    assert files["a.txt"]["hash"] == files["b/c.txt"]["hash"] == file_hash(src / "a.txt")


def test_manifest_hash_depends_on_content_only(tmp_path):
    store = Store(tmp_path / "store")
    one = store.save_manifest({"x": {"hash": "1", "size": 1}, "y": {"hash": "2", "size": 1}})
    two = store.save_manifest({"y": {"hash": "2", "size": 1}, "x": {"hash": "1", "size": 1}})
    three = store.save_manifest({"x": {"hash": "1", "size": 1}})
    assert one == two != three


def test_ignore_patterns_skip_files_and_folders(tmp_path):
    src = tmp_path / "src"
    make(src, {"keep.txt": "k", "labels/test.cache": "c", "__MACOSX/x.txt": "m"})
    files, _ = Store(tmp_path / "store").add_folder(src, link=False, ignore=["*.cache", "__MACOSX"])
    assert list(files) == ["keep.txt"]


def test_checkout_and_verify(tmp_path):
    src = tmp_path / "src"
    make(src, {"a.txt": "hello", "b/c.txt": "world"})
    store = Store(tmp_path / "store")
    files, _ = store.add_folder(src, link=False)
    digest = store.save_manifest(files)
    out = store.checkout(digest)
    assert (out / "b" / "c.txt").read_text() == "world"
    assert store.verify(digest) == []
    obj = store.object_path(files["a.txt"]["hash"])
    os.chmod(obj, stat.S_IWRITE | stat.S_IREAD)
    obj.write_text("tampered")
    assert store.verify(digest) == ["a.txt"]
