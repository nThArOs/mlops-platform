import importlib
import pkgutil

import mlops


def test_every_module_imports():
    for module in pkgutil.iter_modules(mlops.__path__):
        importlib.import_module(f"mlops.{module.name}")
