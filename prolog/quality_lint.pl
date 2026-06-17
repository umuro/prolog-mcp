% prolog_lint.pl — a static, no-execute linter for the well-resolution Prolog port.
%
% WHY STATIC: the experiment modules use `:- initialization(Goal)` (e.g.
% card_helpers.pl runs load_tract_markers) and expect a companion `_rows_*.pl`
% fact file to be loaded alongside them. A load-based linter would (a) execute
% those initialization goals (DB access, side effects) and (b) false-flag the
% fed facts as undefined. So this linter NEVER loads/executes a file. It:
%
%   1. reads every clause with read_term/3 using the `singletons` option —
%      the same mechanism the compiler uses to emit "Singleton variables" —
%      and catches syntax errors. (FAILING checks: zero false positives.)
%   2. runs xref_source/1 (a static cross-referencer, also no execution) to
%      surface predicates that are CALLED but never DEFINED. (ADVISORY: the
%      rows-fed-facts pattern means this has cross-file false positives, so it
%      only fails the build under --strict.)
%   3. walks each clause body term for two statically-detectable FP-paradigm
%      smells from docs/prolog-quality.md (ADVISORY, --strict only):
%        - cond_chain_if_elif(N): a (_->_ ; _->_ ; _) chain (>=2 arrows in one
%          ;-spine) — should be N indexed clauses (pattern-matching, not if/elif).
%        - db_read_modify_write(F/A): retract+assertz of the SAME functor in one
%          body — the dynamic-DB-as-mutable-accumulator anti-pattern (use foldl/
%          aggregate_all). See the FP principles section of docs/prolog-quality.md.
%
% Usage:
%   swipl -q -g main -t 'halt(2)' tools/prolog_lint.pl -- FILE.pl [FILE.pl ...]
%   add --strict to also fail on advisory (xref undefined) findings.
%
% Exit codes: 0 = clean, 1 = findings, 2 = usage/internal error.
%
% This is the Prolog quality gate referenced by CLAUDE.md (Quality Checker
% Tools / Build Verification / CI Parity) and docs/prolog-quality.md.

:- module(prolog_lint, [main/0, lint_file/4]).

:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(library(prolog_xref)).

% ---------------------------------------------------------------------------
% Entry point
% ---------------------------------------------------------------------------

%!  main is det.
%
%   Reads files (and the optional --strict flag) from argv, lints each, prints
%   findings, and halts with 0 (clean) or 1 (findings). A guard, behaviourally:
%   it is the program's top goal, invoked once.
main :-
    current_prolog_flag(argv, Argv),
    partition([A]>>(A == '--strict'), Argv, Flags, Files),
    ( Files == []
    -> format(user_error, "usage: prolog_lint.pl [--strict] FILE.pl ...~n", []),
       halt(2)
    ; true
    ),
    ( Flags == [] -> Strict = false ; Strict = true ),
    foldl(lint_and_report(Strict), Files, 0, FailCount),
    ( FailCount =:= 0 -> halt(0) ; halt(1) ).

lint_and_report(Strict, File, Acc0, Acc) :-
    ( lint_file(File, Errors, Warnings, Advisories)
    -> report(File, Errors, Warnings, Advisories),
       ( failing(Strict, Errors, Warnings, Advisories) -> Acc is Acc0 + 1 ; Acc = Acc0 )
    ;  format("~w: [ERROR] could not read file~n", [File]),
       Acc is Acc0 + 1
    ).

%   A finding fails the lint when there are syntax errors or singletons (always),
%   or advisory xref findings under --strict.
failing(_, Errors, Warnings, _) :- ( Errors \== [] ; Warnings \== [] ), !.
failing(true, _, _, Advisories) :- Advisories \== [].

report(File, Errors, Warnings, Advisories) :-
    forall(member(E, Errors),     print_finding(File, 'ERROR', E)),
    forall(member(W, Warnings),   print_finding(File, 'WARN', W)),
    forall(member(A, Advisories), print_finding(File, 'ADVISORY', A)).

print_finding(File, Sev, finding(Line, Msg)) :-
    format("~w:~w: [~w] ~w~n", [File, Line, Sev, Msg]).

% ---------------------------------------------------------------------------
% The linter — a PRODUCER: exactly one (Errors, Warnings, Advisories) per file.
% ---------------------------------------------------------------------------

%!  lint_file(+File, -Errors, -Warnings, -Advisories) is semidet.
%
%   Statically analyses File. Errors = syntax errors, Warnings = singleton
%   variables (both FAIL the lint), Advisories = xref undefined predicates
%   (informational). Fails (whole predicate) only if File cannot be opened.
lint_file(File, Errors, Warnings, Advisories) :-
    exists_file(File),
    read_findings(File, Errors, Warnings),
    xref_findings(File, Xref),
    paradigm_findings(File, Paradigm),
    append(Xref, Paradigm, Advisories).

% --- pass 1: read every term, collect syntax errors + singletons -----------

read_findings(File, Errors, Warnings) :-
    setup_call_cleanup(
        open(File, read, Stream),
        read_loop(Stream, [], Errors, [], Warnings),
        close(Stream)).

read_loop(Stream, E0, Errors, W0, Warnings) :-
    line_count(Stream, Line),
    catch(read_term(Stream, Term, [singletons(Sing)]),
          error(syntax_error(What), _),
          Term = '$lint_syntax_error'(What)),
    ( Term == end_of_file
    -> Errors = E0, Warnings = W0
    ; ( Term = '$lint_syntax_error'(What)
      -> E1 = [finding(Line, syntax_error(What)) | E0], W1 = W0,
         skip_to_next_clause(Stream)   % resync after the bad term
      ;  E1 = E0, collect_singletons(Sing, Line, W0, W1)
      ),
      read_loop(Stream, E1, Errors, W1, Warnings)
    ).

collect_singletons([], _, W, W).
collect_singletons([Name=_ | Rest], Line, W0, W) :-
    ( intentional_singleton(Name)
    -> W1 = W0                       % `_`-prefixed name: author opted out
    ;  W1 = [finding(Line, singleton_variable(Name)) | W0]
    ),
    collect_singletons(Rest, Line, W1, W).

% A variable name beginning with `_` is the conventional "I know this is
% singleton" marker — exactly what the compiler's own warning suppresses.
intentional_singleton(Name) :-
    atom_chars(Name, ['_' | _]).

% After a syntax error, read_term left the stream mid-clause. Skip characters
% up to and including the next clause terminator so the loop can resync instead
% of looping on the same error.
skip_to_next_clause(Stream) :-
    ( at_end_of_stream(Stream)
    -> true
    ;  get_char(Stream, C), skip_past(C, Stream)
    ).

% One clause per terminator case (§5.6: pattern-matching over an if/elif chain).
skip_past(end_of_file, _).
skip_past('.', _).
skip_past(C, Stream) :- C \== end_of_file, C \== '.', skip_to_next_clause(Stream).

% --- pass 2: xref undefined predicates (advisory) --------------------------

xref_findings(File, Advisories) :-
    catch(xref_source(File, [silent(true)]), _, true),
    findall(finding(0, undefined_predicate(Name/Arity)),
            ( xref_called(File, Goal, _),
              \+ xref_defined(File, Goal, _),
              callable(Goal),
              functor(Goal, Name, Arity),
              \+ system_predicate(Name/Arity)
            ),
            Raw),
    sort(Raw, Advisories).

% A predicate is "system" if it is defined/autoloadable in this Prolog without
% the file under test — those are not the file's responsibility.
system_predicate(Name/Arity) :-
    functor(Probe, Name, Arity),
    ( catch(predicate_property(Probe, defined), _, fail)
    ; catch(predicate_property(Probe, autoload(_)), _, fail)
    ),
    !.

% --- pass 3: FP-paradigm smells in clause bodies (advisory) ----------------
% Re-reads the file (no execution) and walks each `Head :- Body` term for two
% statically-detectable shapes. Directives (:-/1) and DCG rules (-->/2) are not
% matched, so init goals are never inspected as logic. Advisory: fails --strict only.

%!  paradigm_findings(+File, -Findings) is det.
paradigm_findings(File, Findings) :-
    setup_call_cleanup(open(File, read, S),
                       paradigm_loop(S, [], Findings0),
                       close(S)),
    sort(Findings0, Findings).

paradigm_loop(Stream, Acc0, Findings) :-
    line_count(Stream, Line),
    catch(read_term(Stream, Term, []), _, Term = '$lint_skip'),
    ( Term == end_of_file
    -> Findings = Acc0
    ;  ( Term = (_ :- Body)
       -> clause_smells(Body, Line, Fs), append(Fs, Acc0, Acc1)
       ;  Acc1 = Acc0
       ),
       paradigm_loop(Stream, Acc1, Findings)
    ).

clause_smells(Body, Line, Findings) :-
    cond_chain_findings(Body, Line, F1),
    rmw_findings(Body, Line, F2),
    append(F1, F2, Findings).

% R1: an if/elif ->-chain — >=2 arrows along a single ;-spine. Reported once per
% clause, tagged with the (max) arrow count.
cond_chain_findings(Body, Line, Findings) :-
    findall(N,
            ( each_subterm(Body, Sub), nonvar(Sub), Sub = ';'(_, _),
              disjuncts(Sub, Ds), include(is_arrow, Ds, As), length(As, N), N >= 2 ),
            Ns),
    ( Ns == []
    -> Findings = []
    ;  max_list(Ns, Max), Findings = [finding(Line, cond_chain_if_elif(Max))]
    ).

% R2: retract + assertz of the SAME functor/arity within one clause body.
rmw_findings(Body, Line, Findings) :-
    findall(finding(Line, db_read_modify_write(F/A)),
            ( each_subterm(Body, R), db_retract(R, F/A),
              each_subterm(Body, W), db_assert(W, F/A) ),
            Raw),
    sort(Raw, Findings).

% Every subterm of a term (the term itself, then recursively each argument).
each_subterm(T, T).
each_subterm(T, Sub) :- compound(T), arg(_, T, A), each_subterm(A, Sub).

is_arrow(G) :- nonvar(G), ( G = '->'(_, _) ; G = '*->'(_, _) ).

% The disjuncts along a right-nested ;-spine: (A;B;C) -> [A,B,C].
disjuncts(D, [A | Rest]) :- nonvar(D), D = ';'(A, B), !, disjuncts(B, Rest).
disjuncts(G, [G]).

% Only single retract/1 (the read-modify-write accumulator). retractall/1 +
% assertz is the bulk clear-and-reload cache rebuild — a legitimate loader idiom,
% not flagged (see docs/prolog-quality.md, immutability section).
db_retract(retract(X), F/A) :- nonvar(X), functor(X, F, A).
db_assert(assertz(X), F/A) :- nonvar(X), functor(X, F, A).
db_assert(asserta(X), F/A) :- nonvar(X), functor(X, F, A).
db_assert(assert(X), F/A)  :- nonvar(X), functor(X, F, A).
