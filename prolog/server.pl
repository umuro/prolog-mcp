:- module(prolog_mcp_server, []).

:- use_module(library(http/thread_httpd)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_json)).

:- http_handler('/health', handle_health,  [method(get)]).
:- http_handler('/query',  handle_query,   [method(post)]).
:- http_handler('/assert', handle_assert,  [method(post)]).
:- http_handler('/retract',handle_retract, [method(post)]).
:- http_handler('/load',   handle_load,    [method(post)]).
:- http_handler('/reset',  handle_reset,   [method(post)]).
:- http_handler('/list',   handle_list,    [method(post)]).

:- initialization(main, main).

:- dynamic kb_dir/1.

main :-
    ( getenv('SWIPL_PORT', PortStr) -> atom_number(PortStr, Port) ; Port = 7474 ),
    ( getenv('KB_DIR', KbDir) -> true
    ; expand_file_name('~/.local/share/prolog-mcp', [KbDir]) ),
    assertz(kb_dir(KbDir)),
    load_all_layers(KbDir),
    http_server(http_dispatch, [port(Port), workers(4)]),
    format("prolog-mcp: listening on :~w~n", [Port]),
    thread_get_message(_).

load_all_layers(KbDir) :-
    atomic_list_concat([KbDir, '/core.pl'], Core),
    ( exists_file(Core) -> consult(Core) ; true ),
    load_dir(KbDir, agents),
    load_dir(KbDir, sessions).

load_dir(KbDir, Sub) :-
    atomic_list_concat([KbDir, '/', Sub], Dir),
    ( exists_directory(Dir) ->
        directory_files(Dir, Files),
        forall(
          ( member(F, Files), atom_concat(_, '.pl', F),
            atomic_list_concat([Dir, '/', F], Full) ),
          ( catch(consult(Full), _, true) )
        )
    ; true ).

handle_health(_) :- reply_json_dict(_{status: ok}).

handle_query(Req) :-
    http_read_json_dict(Req, Body, []),
    atom_string(GoalAtom, Body.goal),
    % atom_to_term preserves source variable names in Bindings (['X'=Var, ...]).
    % term_to_atom discards them, making dict keys unreadable internal names.
    atom_to_term(GoalAtom, Goal, Bindings),
    ( get_dict(timeout_ms, Body, TMs) -> TimeoutSec is TMs / 1000 ; TimeoutSec = 5 ),
    ( catch(
        call_with_time_limit(TimeoutSec,
          aggregate_all(bag(Dict), solve_named(Goal, Bindings, Dict), Dicts)),
        time_limit_exceeded,
        ( reply_json_dict(_{error: timeout, partial: []}) )
      )
    -> reply_json_dict(_{solutions: Dicts, exhausted: true})
    ;  reply_json_dict(_{solutions: [], exhausted: true}) ).

solve_named(Goal, Bindings, Dict) :-
    % copy_term duplicates Goal+Bindings together so the shared variable links
    % between them are preserved in the copy.
    copy_term(Goal+Bindings, GoalCopy+BindingsCopy),
    % Catch existence_error so a query for an abolished/undefined predicate
    % returns [] instead of HTTP 500.
    catch(call(GoalCopy), error(existence_error(procedure, _), _), fail),
    % After call, BindingsCopy vars are bound to the solution values.
    maplist([Name=Val, Name-VS]>>term_string(Val, VS), BindingsCopy, Pairs),
    dict_pairs(Dict, _, Pairs).

pairs_to_dict(Pairs, Dict) :-
    pairs_keys_values(Pairs, Ks, Vs),
    maplist([K,V,K-V]>>true, Ks, Vs, KVs),
    dict_pairs(Dict, _, KVs).

handle_assert(Req) :-
    http_read_json_dict(Req, Body, []),
    atom_string(TermAtom, Body.term),
    term_to_atom(Term, TermAtom),
    assertz(Term),
    reply_json_dict(_{ok: true}).

handle_retract(Req) :-
    http_read_json_dict(Req, Body, []),
    atom_string(TermAtom, Body.term),
    term_to_atom(Term, TermAtom),
    aggregate_all(count, retract(Term), Count),
    reply_json_dict(_{ok: true, removed: Count}).

handle_load(Req) :-
    http_read_json_dict(Req, Body, []),
    atom_string(File, Body.path),
    ( catch(
        ( ( exists_file(File) -> unload_file(File) ; true ),
          consult(File) ),
        Err,
        ( term_string(Err, EStr),
          reply_json_dict(_{error: syntax_error, detail: EStr}) )
      )
    -> reply_json_dict(_{ok: true})
    ;  true ).

handle_reset(Req) :-
    http_read_json_dict(Req, Body, []),
    atom_string(File, Body.path),
    ( exists_file(File) ->
        file_terms(File, Terms),
        length(Terms, Count),
        % retractall each head pattern so assertz'd + file-loaded clauses are cleared
        % abolish works on both static (consult-loaded) and dynamic predicates.
        % retractall/1 throws permission_error on static predicates from consult.
        maplist([T]>>(functor(T, F, A), catch(abolish(F/A), _, true)), Terms),
        catch(unload_file(File), _, true)
    ; Count = 0 ),
    reply_json_dict(_{ok: true, removed: Count}).

% file_terms(+File, -Terms): read all top-level terms from a .pl file
file_terms(File, Terms) :-
    exists_file(File), !,
    setup_call_cleanup(
        open(File, read, Stream),
        read_all_terms(Stream, Terms),
        close(Stream)).
file_terms(_, []).

read_all_terms(Stream, Terms) :-
    read_term(Stream, T, []),
    ( T == end_of_file -> Terms = []
    ; Terms = [T | Rest], read_all_terms(Stream, Rest) ).

% layer_to_file(+LayerName, -AbsPath) maps "agent:foo" -> KbDir/agents/foo.pl etc.
layer_to_file(Layer, File) :-
    kb_dir(KbDir),
    ( sub_atom(Layer, _, _, _, ':') ->
        sub_atom(Layer, B, _, _, ':'),
        sub_atom(Layer, 0, B, _, Prefix),
        atom_length(Layer, Len), After is Len - B - 1,
        sub_atom(Layer, _, After, 0, Id),
        atomic_list_concat([KbDir, '/', Prefix, 's/', Id, '.pl'], File)
    ; % bare names: core, scratch
      atomic_list_concat([KbDir, '/', Layer, '.pl'], File)
    ).

handle_list(Req) :-
    http_read_json_dict(Req, Body, []),
    ( get_dict(limit, Body, Limit) -> true ; Limit = 100 ),
    ( get_dict(layer, Body, LayerStr) ->
        % Read terms directly from the layer file on disk — reliable regardless of
        % whether facts were loaded via consult or assertz, and avoids the
        % clause/2 instantiation-error on unbound heads in SWI 9.x.
        atom_string(LayerAtom, LayerStr),
        layer_to_file(LayerAtom, LayerFile),
        file_terms(LayerFile, LayerTerms),
        maplist(term_string, LayerTerms, All)
    ;   aggregate_all(bag(S),
          ( clause(H, _), term_string(H, S) ),
          All)
    ),
    ( get_dict(offset, Body, Offset) -> true ; Offset = 0 ),
    ( Offset > 0, length(All, AllLen), AllLen >= Offset ->
        length(Skip, Offset), append(Skip, Paged, All)
    ;   Paged = All ),
    length(Paged, Total),
    ( Total > Limit ->
        length(Trunc, Limit), append(Trunc, _, Paged),
        reply_json_dict(_{facts: Trunc, truncated: true})
    ;   reply_json_dict(_{facts: Paged, truncated: false}) ).
