# Prolog quality criteria + linter

Criteria for idiomatic, maintainable, *correct* Prolog — distilled from a full
imperative→Prolog expert-system port (a well-name matcher/falsifier, every leaf 100%
equivalent to its oracle). Use these when authoring or reviewing Prolog the MCP serves.

> Companion skill: `prolog-idioms` (relations-not-functions, canonicalize/parse/constrain,
> GUARD-vs-PRODUCER determinism). This doc adds the **automated lint** + the **regression-gated
> refactor recipe** + the **coverage lesson**.

## The linter — `prolog/quality_lint.pl`

A **static, no-execute** linter: reads each clause with `read_term/3`, walks the body term-tree,
and never loads the file (so `:- initialization` goals don't fire and fed-fact files aren't
false-flagged). Portable — only `library(lists/apply/prolog_xref)`.

```sh
swipl -q -g main -t 'halt(2)' prolog/quality_lint.pl -- FILE.pl [FILE.pl ...]
# add --strict to also fail on advisory findings (xref-undefined + the paradigm smells)
```

It flags:

| Finding | Severity | Meaning |
|---------|----------|---------|
| `syntax_error`, `singleton_variable` | **fails** | broken or likely-bug clause |
| `undefined_predicate(N/A)` | advisory | called-but-undefined (xref; cross-file FPs) |
| `cond_chain_if_elif(N)` | advisory | an `(_->_ ; _->_ ; …)` ladder, N≥2 arrows in one `;`-spine — a decision tree or lookup wearing imperative clothes |
| `db_read_modify_write(F/A)` | advisory | `retract(F)…assertz(F)` in one body — the DB as a mutable accumulator (use `foldl`/`aggregate_all`); `retractall`+reload loaders are exempt |

Ranked worst-first (`cond_chain_if_elif(7)` before `(2)`), it is the refactor worklist.

## The two paradigm rules the lint enforces

1. **Pattern-matching over conditionals.** A `cond_chain` ladder is a *decision tree* (split into
   one PRODUCER clause per case, priority order, each committed by `!` after a full guard — the
   code then mirrors its own "decision tree" doc) **or** a *lookup* (replace with a `key_value/2`
   **fact table** + one `( table(K,V) -> … ; Default )`). New entries become data, not code.
2. **No DB-as-mutable-state.** Logic vars are single-assignment; `assert/retract` for value-passing
   or a loop counter is the violation. Memo/cache loaders (`retractall`+reload, `:- table`) are fine.

## Refactor recipe — every step regression-gated

The leaf **equivalence gate** (`findall(Ans,P,[Ans])` vs the oracle — exactly one solution, full
tuple) + **plunit** + an **`is_det`** test (`is_det(G):-findall(t,G,[t])`) must stay green before
and after. Proven on a 7-branch matcher core with zero behaviour change.

## Coverage lesson (why a fact table beats an if/elif lookup)

An if/elif *lookup* ladder HIDES incomplete coverage. Real example: a `norm_state` that
special-cased only TX/OK/NM silently matched nothing for any other state's full name — invisible in
the ladder, obvious once it became a fact table (you can SEE the missing keys). **Always prefer a
fact table for a lookup, and audit it for completeness when you convert one** — it is usually
incomplete.
