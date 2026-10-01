import re

KEY = re.compile(r"^(\s*)([A-Za-z0-9_\-]+)\s*:(.*)$")


def _split(rest: str) -> tuple[str, str | None]:
    """Value and inline comment; a "#" starts a comment only outside quotes and after a space."""
    quote = None
    for i, ch in enumerate(rest):
        if ch in "'\"":
            quote = None if quote == ch else (quote or ch)
        elif ch == "#" and quote is None and (i == 0 or rest[i - 1].isspace()):
            return rest[:i].strip(), rest[i + 1:].strip() or None
    return rest.strip(), None


def read(text: str) -> tuple[str | None, dict[str, str]]:
    """Header comment of a YAML file and the comment of each key, as dotted paths.

    Comments before the first key describe the file. A key takes its inline comment,
    or else the comment lines right above it."""
    header, pending, comments, stack = [], [], {}, []
    seen_key = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            (pending if seen_key else header).append(stripped.lstrip("#").strip())
            continue
        m = KEY.match(line)
        if not stripped or not m:
            pending = []
            continue
        seen_key = True
        indent, key = len(m.group(1)), m.group(2)
        value, note = _split(m.group(3))
        while stack and stack[-1][0] >= indent:
            stack.pop()
        path = ".".join([k for _, k in stack] + [key])
        if note or pending:
            comments[path] = note or " ".join(pending)
        pending = []
        if not value:
            stack.append((indent, key))
    return (" ".join(header) or None), comments
