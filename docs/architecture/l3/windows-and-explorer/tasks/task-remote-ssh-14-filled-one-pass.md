# Task card remote-ssh-14: a template is filled in one pass

Why: athena's follow-up (themis first noted the `$&` part on #306). `filled` in `surfaces/strings.ts` puts the values
in one at a time with `replaceAll(string, string)`, which has two defects, both checked with node:
1. A replacement string reads `$&` and `$$` as patterns (`$1` stays literal, since there is no capture group): an alias
   `box$&` shows as `box{0}`, and `a$$b` as `a$b`.
2. A value that contains `{1}` (a typed alias goes through as written) is filled again by the next value.

Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/surfaces/strings.ts` | the body of `filled` (section 2) |
| `packages/remote-ssh/test/unit/strings.test.ts` | one `describe` added (section 3) |

Nothing else. The signature of `filled` and its JSDoc stay as they are.

## 2. Contract

`filled(translate, template, values)` translates the template once, then replaces every `{n}` (one or more digits)
in **one pass** with a replacer function: the place becomes `values[n]` when there is one, and stays as written
(`{n}`) when there is none. The values are inserted as they are: nothing in a value is read as a pattern or a place.
The body is:

```ts
return translate(template).replace(
  /\{(\d+)\}/g,
  (place: string, digits: string) => values[Number(digits)] ?? place,
);
```

## 3. Test table

A new `describe('filling a template', …)` in `strings.test.ts`, importing `filled` from
`../../src/surfaces/strings.ts`. One assertion per `it`; the cite starts the name. `same` is the translation that
gives its template back (`(template: string) => template`).

| Cite | Call | Expected |
|---|---|---|
| F-3902 rule 8 | `filled(same, 'Host "{0}"', ['box$&'])` | `Host "box$&"` |
| F-3902 rule 8 | `filled(same, 'Host "{0}"', ['box$1'])` | `Host "box$1"` |
| F-3902 rule 8 | `filled(same, 'Host "{0}"', ['a$$b'])` | `Host "a$$b"` |
| F-3902 rule 8 | `filled(same, '{0} and {1}', ['a{1}', 'b'])` | `a{1} and b` |
| F-3902 rule 8 | `filled(same, '{0} and {1}', ['a'])` | `a and {1}` |
| F-3902 rule 8 | `filled(same, '{0}, again {0}', ['z'])` | `z, again z` |
| F-3902 rule 8 | `filled(() => 'Hôte {0}', 'Host {0}', ['box'])` | `Hôte box` (the translation is filled, not the English) |
| F-3902 rule 8 | `filled(same, 'no places')` | `no places` |

The first, third and fourth rows fail on today's `filled` (it gives `Host "box{0}"`, `Host "a$b"` and `ab and b`) and pass with section 2;
the others pass on both and pin what must not change. Checked on a prototype (2026-10-12). Every existing test of the
package passes unchanged.

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: a template is filled in one pass (card remote-ssh-14)`.

## 6. Open rows

None.
