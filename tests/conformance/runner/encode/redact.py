"""Ruling R-34 (2026-10-01): a command line the reference ran, shown on screen ("Error removing volume: Command failed:
..."), carries the same program information as a log line, so the script-text rule applies to it. Recordings, cases
and notes replace the embedded command with `<docker command>` (`<kubectl command>`, `<podman command>`, ... by
program) and keep the surrounding message; never the flags or their order.

Two strengths:
  captured  text captured from the screen or the engine (observations, expect, transcripts, logs): "Command failed:"
            followed by anything, and ANY docker/podman/compose/kubectl invocation with a subcommand.
  prose     text people write (case steps, comments and notes, and the writers' other notes): "Command failed:"
            followed by anything; an invocation that carries options; a backticked command fragment with options
            (`version --format ...`); the reference's own construction flags (--security-opt, --docker-path ...).
            Naming a command without options ("a mid-case docker pause") stays allowed.
redact_* rewrite; find_* report what is still unredacted (schema.py).
The programs and the reference's own command construction come from ROOM_RULES (the extension's encode rules; in the
standalone runner, rules.json beside this module); without them only "Command failed:" is redacted, as `<command>`.
"""
import os
import re

import json  # noqa: E402
with open(os.environ.get("ENCODE_RULES") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "rules.json"), encoding="utf-8") as _f:
    ROOM_RULES = json.load(_f, object_hook=lambda d: re.compile(d["re"], d["flags"]) if d.keys() == {"re", "flags"} else d)
NOTHING = r"(?!)"   # a pattern that matches nothing: the neutral value of a rule the room does not have

PROGRAMS = tuple(ROOM_RULES.get("PROGRAMS", ()))
_PROG_PATH = r"(?<![\w.${}/<-])(?:[\w.${}~-]*/)*(?P<prog>" + ("|".join(PROGRAMS) or NOTHING) + r")(?![\w.-])"
_PROG_PLACEHOLDER = r"<(?P<ph>" + ("|".join(ROOM_RULES.get("PROGRAM_PLACEHOLDERS", ())) or NOTHING) + r")>"
PROG = f"(?:{_PROG_PATH}|{_PROG_PLACEHOLDER})"
SUBS = ROOM_RULES.get("SUBS", {})
_ALL_SUBS = sorted({w for v in SUBS.values() for w in v.split()}, key=len, reverse=True)
_PROGRAM_OPTIONS = ROOM_RULES.get("PROGRAM_OPTIONS")
SUB = r"(?:" + ("|".join([re.escape(w) for w in _ALL_SUBS] + ([_PROGRAM_OPTIONS] if _PROGRAM_OPTIONS else [])) or NOTHING) + \
      r")(?![\w-])"
INVOCATION = re.compile(PROG + r"[ \t]+(?P<sub>" + SUB + r")")
COMMAND_FAILED = re.compile(r"(?P<head>Command\s+failed:)(?![ \t]*<[a-z-]+ command>)[ \t]*(?P<cmd>[^\n'\"`]*?)(?P<tail>\)?(?:['\"`]|\n|$))")
TOKEN = re.compile(r"[ \t]+(?:'[^'\n]*'|\"[^\"\n]*\"|[^\s'\"`(),;]+)")
OPTION = re.compile(r"^-{1,2}[A-Za-z][\w-]*(=\S*)?$")
STOP = {"on", "from", "while", "in", "at", "to", "the", "a", "an", "and", "or", "of", "for", "with", "is", "are", "when",
        "then", "that", "which", "after", "before", "as", "but", "if", "so", "by", "it", "its", "this", "fails", "failed",
        "succeeds", "runs", "returns", "lists", "path", "route", "probe", "call", "calls"}
# the reference's own command-construction flags, named in prose without the program
CONSTRUCTION_FLAGS = ROOM_RULES.get("CONSTRUCTION_FLAGS") or re.compile(NOTHING)
FRAGMENT_FLAGS = ROOM_RULES.get("FRAGMENT_FLAGS") or NOTHING   # a backticked fragment that starts with one
BACKTICK = re.compile(r"`([^`\n]+)`")
LABEL = ROOM_RULES.get("LABEL", {})
DEFAULT_PROGRAM = ROOM_RULES.get("DEFAULT_PROGRAM")   # "Command failed:" and fragments that name no program
RULES = ROOM_RULES.get("RULES") or [
    {"rule": "command-failed", "placeholder": "Command failed: <command>", "applies": "captured and prose"},
]


def placeholder(prog):
    return f"<{LABEL.get(prog, prog)} command>" if prog else "<command>"


def _prog_of(m):
    return m.group("prog") or m.group("ph")


def _program_in(text):
    m = re.match(r"\s*" + PROG, text)
    return _prog_of(m) if m else None


def _span(text, start, prose=True):
    """End of the invocation that starts at `start` (just after its subcommand), and whether it carries options. It
    takes options and their values, tokens with digits or punctuation (ids, paths, ${...}, <...>), and at most two bare
    words (`volume rm`, `get pods`); it stops at an ordinary word such as "on", "from", "to" or at punctuation."""
    pos, words, has_opt, prev_opt = start, 0, False, False
    while True:
        m = TOKEN.match(text, pos)
        if not m:
            break
        tok = m.group(0).strip()
        if OPTION.match(tok):
            has_opt, prev_opt = True, True
        elif not prose:
            prev_opt = False
        elif tok.lower() in STOP:
            break
        elif prev_opt or re.search(r"[0-9_./:=${}<>@\-]", tok) or words < 2:
            words += 0 if prev_opt else 1
            prev_opt = False
        else:
            break
        pos = m.end()
    return pos, has_opt


def _command_failed(s):
    """'Command failed: <anything>' -> 'Command failed: <program command>' (the message around it stays)."""
    def sub(m):
        cmd = m.group("cmd").strip()
        return f"{m.group('head')} {placeholder(_program_in(cmd) or DEFAULT_PROGRAM)}{m.group('tail')}" if cmd else m.group(0)
    return COMMAND_FAILED.sub(sub, s)


def redact_captured(s):
    if not isinstance(s, str) or not s:
        return s
    s = _command_failed(s)
    out, pos = [], 0
    for m in INVOCATION.finditer(s):
        if m.start() < pos:
            continue
        end, _ = _span(s, m.end(), prose=True)
        out.append(s[pos:m.start()] + placeholder(_prog_of(m)))
        pos = end
    return "".join(out) + s[pos:]


def redact_prose(s):
    if not isinstance(s, str) or not s:
        return s
    s = _command_failed(s)
    out, pos = [], 0
    for m in INVOCATION.finditer(s):
        if m.start() < pos:
            continue
        end, has_opt = _span(s, m.end(), prose=True)
        if has_opt:
            out.append(s[pos:m.start()] + placeholder(_prog_of(m)))
            pos = end
    s = "".join(out) + s[pos:]

    def tick(m):
        body = m.group(1).strip()
        toks = body.split()
        if not toks or not any(OPTION.match(t) for t in toks) or placeholder(DEFAULT_PROGRAM) in body:
            return m.group(0)
        if OPTION.match(toks[0]):
            return "`<command flags>`" if re.match(FRAGMENT_FLAGS, toks[0]) else m.group(0)
        if toks[0] in _ALL_SUBS:
            return f"`{placeholder(DEFAULT_PROGRAM)}`"
        return m.group(0)
    s = BACKTICK.sub(tick, s)
    return CONSTRUCTION_FLAGS.sub("<command flags>", s)


def find_captured(s):
    return [] if not isinstance(s, str) or redact_captured(s) == s else [_excerpt(s, redact_captured)]


def find_prose(s):
    return [] if not isinstance(s, str) or redact_prose(s) == s else [_excerpt(s, redact_prose)]


def _excerpt(s, fn):
    """The first place where fn changes s (for an error message), as `...text...`."""
    r = fn(s)
    i = next((k for k, (a, b) in enumerate(zip(s, r)) if a != b), min(len(s), len(r)))
    return s[max(0, i - 30): i + 60].replace("\n", " ")


def redact_obj(obj, fn=redact_captured):
    """Redact every string (dict keys too) of a JSON-like value."""
    if isinstance(obj, str):
        return fn(obj)
    if isinstance(obj, list):
        return [redact_obj(v, fn) for v in obj]
    if isinstance(obj, dict):
        return {fn(k) if isinstance(k, str) else k: redact_obj(v, fn) for k, v in obj.items()}
    return obj


def find_obj(obj, fn=find_captured):
    found = []
    if isinstance(obj, str):
        return fn(obj)
    if isinstance(obj, list):
        for v in obj:
            found += find_obj(v, fn)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            found += (fn(k) if isinstance(k, str) else []) + find_obj(v, fn)
    return found


