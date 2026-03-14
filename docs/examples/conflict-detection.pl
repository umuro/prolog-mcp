% conflict-detection.pl
% Detect conflicting "every N seconds" cron jobs.
%
% Load with:
%   prolog_write_file("scratch/conflicts.pl", <content>)
%
% Then query:
%   prolog_query("conflicts(X, Y)")
%
% Two periodic jobs conflict when one period evenly divides the other —
% they will fire at the same time repeatedly.

job(brain_watchdog, every, 3600).
job(ocaml_hunt,     cron,  "0 3 * * 2").
job(linkedin_mon,   every, 1800).

conflicts(A, B) :-
    job(A, every, PA),
    job(B, every, PB),
    A @< B,
    ( 0 is PA mod PB ; 0 is PB mod PA ).
