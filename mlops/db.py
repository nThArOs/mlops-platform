from functools import lru_cache

import sqlalchemy as sa

from .config import load_config

metadata = sa.MetaData()


def _created():
    return sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


projects = sa.Table(
    "projects", metadata,
    sa.Column("name", sa.String(100), primary_key=True),
    sa.Column("root", sa.Text, nullable=False),
    sa.Column("contract", sa.JSON, nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column("archived", sa.Boolean, server_default=sa.false(), nullable=False),
)

datasets = sa.Table(
    "datasets", metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("name", sa.String(100), unique=True, nullable=False),
    sa.Column("license", sa.String(100), nullable=False),
    sa.Column("source", sa.Text),
    sa.Column("format", sa.String(50)),
    sa.Column("description", sa.Text),
    sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
    _created(),
)

dataset_versions = sa.Table(
    "dataset_versions", metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("dataset_id", sa.ForeignKey("datasets.id"), nullable=False),
    sa.Column("version", sa.Integer, nullable=False),
    sa.Column("parent_id", sa.ForeignKey("dataset_versions.id")),
    sa.Column("manifest_hash", sa.String(64), nullable=False),
    sa.Column("files", sa.Integer, nullable=False),
    sa.Column("bytes", sa.BigInteger, nullable=False),
    sa.Column("splits", sa.JSON, nullable=False),
    sa.Column("stats", sa.JSON),
    sa.Column("note", sa.Text),
    sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
    _created(),
    sa.UniqueConstraint("dataset_id", "version"),
)

run_datasets = sa.Table(
    "run_datasets", metadata,
    sa.Column("run_id", sa.String(32), primary_key=True),
    sa.Column("dataset_version_id", sa.ForeignKey("dataset_versions.id"), primary_key=True),
    sa.Column("project", sa.String(100), nullable=False),
    sa.Column("entrypoint", sa.String(50), nullable=False),
    sa.Column("mount", sa.Text, nullable=False),
    _created(),
)

model_evaluations = sa.Table(
    "model_evaluations", metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("project", sa.String(100), nullable=False),
    sa.Column("model_version", sa.Integer, nullable=False),
    sa.Column("run_id", sa.String(32), nullable=False),
    sa.Column("dataset_version_id", sa.ForeignKey("dataset_versions.id"), nullable=False),
    sa.Column("metrics", sa.JSON, nullable=False),
    sa.Column("confusion", sa.JSON),
    sa.Column("extras", sa.JSON),
    _created(),
)

model_benchmarks = sa.Table(
    "model_benchmarks", metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("project", sa.String(200), nullable=False),
    sa.Column("model_version", sa.Integer, nullable=False),
    sa.Column("run_id", sa.String(32), nullable=False),
    sa.Column("profile", sa.String(100), nullable=False),
    sa.Column("measured", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("metrics", sa.JSON, nullable=False),
    _created(),
)

retrain_triggers = sa.Table(
    "retrain_triggers", metadata,
    sa.Column("model", sa.String(200), primary_key=True),
    sa.Column("dataset_version_id", sa.ForeignKey("dataset_versions.id"), primary_key=True),
    sa.Column("job_id", sa.ForeignKey("jobs.id")),
    _created(),
)

jobs = sa.Table(
    "jobs", metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("project", sa.String(100), nullable=False),
    sa.Column("model", sa.String(200), nullable=False),
    sa.Column("entrypoint", sa.String(50), nullable=False),
    sa.Column("spec", sa.JSON, nullable=False),
    sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
    sa.Column("run_id", sa.String(32)),
    sa.Column("result", sa.JSON),
    sa.Column("error", sa.Text),
    sa.Column("parent_id", sa.ForeignKey("jobs.id")),
    _created(),
    sa.Column("started_at", sa.DateTime(timezone=True)),
    sa.Column("finished_at", sa.DateTime(timezone=True)),
)

MIGRATIONS = [
    "ALTER TABLE model_evaluations ADD COLUMN IF NOT EXISTS confusion JSON",
    "ALTER TABLE model_evaluations ADD COLUMN IF NOT EXISTS extras JSON",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE",
]

model_events = sa.Table(
    "model_events", metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("project", sa.String(100), nullable=False),
    sa.Column("action", sa.String(20), nullable=False),
    sa.Column("from_version", sa.Integer),
    sa.Column("to_version", sa.Integer, nullable=False),
    sa.Column("reason", sa.Text),
    sa.Column("forced", sa.Boolean, nullable=False, server_default=sa.false()),
    _created(),
)


@lru_cache
def engine() -> sa.Engine:
    eng = sa.create_engine(load_config()["database_url"])
    metadata.create_all(eng)
    with eng.begin() as conn:
        for statement in MIGRATIONS:
            conn.execute(sa.text(statement))
    return eng
