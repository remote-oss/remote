"""Narrowed comparisons of a recorded case: `recorded.narrowed`, a list of entries that replay and confirm (and the
runner, which shares this module) honor when they compare an observation with the case's expect. The expect itself is
never changed. Each entry is

    {path: [<observe id>, <key or index>, ...], rule: contains | excludes | either | unordered | drop | ignore,
     why: <criterion clause>, case_sha256: <the case's writer digest>, value: <contains, excludes>, values: <either>}

- `path` names a place in the expect: an observe id, then keys and list indices; `*` stands for every key or index.
- `contains`: the observation there holds `value`, a part of the expect there that the criterion asserts (items of a
  list, entries of a mapping, or a substring of a text); anything else there is not compared.
- `drop`: the expect's value there is not required: it is left out of the expect, and the observation is compared
  with what remains (so the observation does not have it either).
- `ignore`: the place is left out of both sides.
- `either`: the observation there equals one of `values`, the expect's own value and the other outcomes the cited
  clause allows, each a string or a number quoted from it (athena, register, 2026-11-02).
- `unordered`: the observation there holds exactly the expect's list, in any order (the cited clause states none).
- `excludes`: beside a `contains` at the same place, the observation there holds none of `value`'s items (or not
  that text), and the expect holds none of them either, so it never fails what the strict comparison passes.

Every check reads the observation as it came; only then are the places replaced or left out, so a `contains` and an
`excludes` at one place both see what was observed.

The rules (athena, register, 2026-11-01): only the dirty side writes an entry, through narrow.py; `why` cites the
clause of the case's own criterion (F-XXXX AC-n) and never a ruling or decision (D-n); a deviation is never narrowed;
`ignore` is for a place no criterion asserts, after `contains` and `drop`; an entry holds the case_sha256 of the case it
was written for and is stale (not applied, and the case does not validate) once the case changes; testcov.py lists every
narrowed place.
"""
import copy
import re

RULES = ("contains", "excludes", "either", "unordered", "drop", "ignore")
WILDCARD = "*"
CRITERION = re.compile(r"\bF-\d{4}(?:\.| )AC-\d+\b")
RULING = re.compile(r"\bD-\d+\b")
ENTRY_KEYS = {"path", "rule", "why", "case_sha256", "value", "values"}

# the rules that check the observation there, and then compare that place through the check alone
CHECKS = ("contains", "excludes", "either", "unordered")


def _places(obj, path):
    """The concrete paths that `path` names in `obj`: every key or index for a wildcard, only places that exist."""
    if not path:
        return [[]]
    head, rest = path[0], path[1:]
    if isinstance(obj, dict):
        keys = list(obj) if head == WILDCARD else ([head] if head in obj else [])
    elif isinstance(obj, list):
        keys = list(range(len(obj))) if head == WILDCARD else (
            [head] if isinstance(head, int) and not isinstance(head, bool) and 0 <= head < len(obj) else [])
    else:
        keys = []
    return [[k] + more for k in keys for more in _places(obj[k], rest)]


def _get(obj, place):
    for k in place:
        obj = obj[k]
    return obj


def _delete(obj, places):
    """Removes every place from `obj`, the later list indices first so the earlier ones keep their meaning."""
    for place in sorted(places, key=lambda p: [(-k if isinstance(k, int) else 0) for k in p], reverse=False):
        parent = _get(obj, place[:-1])
        del parent[place[-1]]


def _holds(observed, value):
    """Whether `observed` holds `value`: every item of a list (with its count), every entry of a mapping, a substring
    of a text, or the same scalar."""
    if isinstance(value, list):
        rest = list(observed) if isinstance(observed, list) else None
        if rest is None:
            return False
        for item in value:
            if item not in rest:
                return False
            rest.remove(item)
        return True
    if isinstance(value, dict):
        return isinstance(observed, dict) and all(k in observed and observed[k] == v for k, v in value.items())
    if isinstance(value, str):
        return isinstance(observed, str) and value in observed
    return observed == value


def _holds_none(observed, value):
    """Whether `observed` holds none of `value`'s items (a list), or not the text `value`."""
    if isinstance(value, list):
        return not (isinstance(observed, list) and any(item in observed for item in value))
    return not (isinstance(observed, str) and value in observed)


def _same_items(observed, expected):
    """Whether two lists hold the same items with the same counts, in any order."""
    return isinstance(observed, list) and len(observed) == len(expected) and _holds(observed, expected)


def _scalar(value):
    return isinstance(value, (str, int, float)) and not isinstance(value, bool)


def _passes(rule, entry, observed, expected):
    """Whether the observed value at a place meets the check `rule` of `entry`, the expect's value being `expected`."""
    if rule == "contains":
        return _holds(observed, entry["value"])
    if rule == "excludes":
        return _holds_none(observed, entry["value"])
    if rule == "either":
        return observed in entry["values"]
    return _same_items(observed, expected)


def _shown(place):
    return "/" + "/".join(str(k) for k in place)


def entry_errors(case, digest):
    """What is wrong with the case's `recorded.narrowed`, given its writer digest `digest`: one line per fault."""
    entries = (case.get("recorded") or {}).get("narrowed")
    if entries is None:
        return []
    if not isinstance(entries, list) or not entries:
        return ["recorded.narrowed must be a non-empty list of entries"]
    expect = case.get("expect") or {}
    errs = []
    for j, entry in enumerate(entries):
        where = f"recorded.narrowed[{j}]"
        if not isinstance(entry, dict):
            errs.append(f"{where}: an entry is a mapping")
            continue
        extra = set(entry) - ENTRY_KEYS
        if extra:
            errs.append(f"{where}: unknown keys {sorted(extra)}")
        path, rule, why = entry.get("path"), entry.get("rule"), entry.get("why")
        if rule not in RULES:
            errs.append(f"{where}: rule must be one of {list(RULES)}")
        if not isinstance(why, str) or not CRITERION.search(why):
            errs.append(f"{where}: why must cite the clause of the case's criterion (F-XXXX AC-n)")
        elif RULING.search(why):
            errs.append(f"{where}: why cites a ruling (D-n); a narrowing cites only the criterion")
        if entry.get("case_sha256") != digest:
            errs.append(f"{where}: written for another version of the case (case_sha256): re-write the narrowing")
        if not (isinstance(path, list) and path and isinstance(path[0], str) and path[0] in expect
                and all(isinstance(k, (str, int)) and not isinstance(k, bool) for k in path)):
            errs.append(f"{where}: path must be [<observe id of the expect>, <key or index>, ...]")
            continue
        places = _places(expect, path)
        if not places:
            errs.append(f"{where}: path {_shown(path)} names nothing in the expect")
        errs += _rule_errors(where, entry, rule, [_get(expect, p) for p in places],
                             [e.get("path") for e in entries if isinstance(e, dict) and e.get("rule") == "contains"])
    return errs


def _rule_errors(where, entry, rule, expected, contained):
    """What is wrong with the rule-specific fields of one entry, the expect's values at its places being `expected`
    and `contained` the paths of the case's `contains` entries."""
    errs = []
    if "value" in entry and rule not in ("contains", "excludes"):
        errs.append(f"{where}: only contains and excludes take a value")
    if "values" in entry and rule != "either":
        errs.append(f"{where}: only either takes values")
    if rule == "contains":
        if "value" not in entry:
            errs.append(f"{where}: contains needs the value the criterion asserts")
        elif not all(_holds(e, entry["value"]) for e in expected):
            errs.append(f"{where}: value is not part of the expect at {_shown(entry['path'])}")
    elif rule == "excludes":
        if entry["path"] not in contained:
            errs.append(f"{where}: excludes goes only beside a contains at the same path")
        if "value" not in entry:
            errs.append(f"{where}: excludes needs the items the observation must not hold")
        elif not all(_holds_none(e, entry["value"]) for e in expected):
            errs.append(f"{where}: the expect at {_shown(entry['path'])} holds what excludes names, so it would fail "
                        "what the strict comparison passes")
    elif rule == "either":
        values = entry.get("values")
        if not isinstance(values, list) or len(values) < 2:
            errs.append(f"{where}: either needs at least two values, the expect's own among them")
        else:
            if not all(e in values for e in expected):
                errs.append(f"{where}: values must hold the expect's own value at {_shown(entry['path'])}")
            if not all(_scalar(v) for v in values if v not in expected):
                errs.append(f"{where}: an alternative of either is a string or a number quoted from the clause")
    elif rule == "unordered" and not all(isinstance(e, list) for e in expected):
        errs.append(f"{where}: unordered goes only on a list of the expect")
    return errs


def applicable(case, digest):
    """The entries of a case that apply: all of them when every entry is sound, else none (the case is then compared
    strictly, and its schema errors say why)."""
    entries = (case.get("recorded") or {}).get("narrowed") or []
    return entries if entries and not entry_errors(case, digest) else []


FAULT_TEXT = {"contains": "does not contain {}", "excludes": "holds what it must not: {}",
              "either": "is none of {}", "unordered": "does not hold exactly {}, in any order"}


def narrow(expect, observed, entries):
    """(expect, observed, faults): copies of both sides with the entries applied, and a line for each check the
    observation does not meet. Every check reads the observation as it came, before any place is replaced or left out.
    The originals are never changed."""
    expect, observed = copy.deepcopy(expect or {}), copy.deepcopy(observed or {})
    faults, checked = [], []
    for entry in entries:
        rule = entry["rule"]
        if rule not in CHECKS:
            continue
        for place in _places(expect, entry["path"]):
            there = bool(_places(observed, place))
            expected = _get(expect, place)
            if not there or not _passes(rule, entry, _get(observed, place), expected):
                shown = entry.get("values", entry.get("value", expected))
                faults.append(f"{_shown(place)}: the observation {FAULT_TEXT[rule].format(repr(shown))} "
                              f"(narrowed: {entry['why']})"[:600])
            if there:
                checked.append(place)
    for place in checked:   # the place is compared through its checks alone
        _get(observed, place[:-1])[place[-1]] = _get(expect, place)
    for entry in entries:
        if entry["rule"] in ("drop", "ignore"):
            _delete(expect, _places(expect, entry["path"]))
            if entry["rule"] == "ignore":
                _delete(observed, _places(observed, entry["path"]))
    return expect, observed, faults


def mismatches(case, observed, digest, diff):
    """The mismatches of an observation against the case's expect, through the case's sound narrowing: `diff` per
    observe id (normalize.diff), plus the unmet `contains` entries."""
    expect, observed, faults = narrow(case.get("expect") or {}, observed, applicable(case, digest))
    # by observe id, so a result lists its mismatches in the same order every time
    return faults + [d for oid in sorted(set(expect) | set(observed))
                     for d in diff(expect.get(oid), observed.get(oid), "/" + oid)]


def report(case):
    """The narrowed places of a case for the gate report, one line per entry: rule, path and why, and for `either` each
    alternative to the expect's own value."""
    expect = case.get("expect") or {}
    lines = []
    for e in (case.get("recorded") or {}).get("narrowed") or []:
        if not isinstance(e, dict):
            continue
        line = f"{e.get('rule')} {_shown(e.get('path') or [])}: {e.get('why')}"
        if e.get("rule") == "either" and isinstance(e.get("values"), list):
            own = [_get(expect, p) for p in _places(expect, e.get("path") or [])]
            line += f"; alternatives {[v for v in e['values'] if v not in own]!r}"
        lines.append(line)
    return lines


def rehash(recorded, old, new):
    """`recorded` with the entries written for digest `old` moved to `new` (a change of the case's notes only)."""
    entries = recorded.get("narrowed")
    if not entries:
        return recorded
    return dict(recorded, narrowed=[dict(e, case_sha256=new) if e.get("case_sha256") == old else e for e in entries])
