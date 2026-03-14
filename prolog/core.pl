% prolog/core.pl — seed template for the shared knowledge base
%
% This file is loaded at server startup and is visible to all agents.
% Populate it via the prolog_write_file tool; do not assert/retract here
% at runtime — use agent:<id> or session:<id> layers instead.
%
% Layer model:
%   core            — permanent, operator-managed (this file)
%   agent:<id>      — permanent per-agent facts (agents/<id>.pl)
%   session:<id>    — ephemeral per-session facts (sessions/<id>.pl)
%   scratch:<name>  — scratch files, manually cleared (scratch/<name>.pl)
%
% Example rules (uncomment and extend):
%
% % Routing: which agent handles a topic
% % handles(Topic, AgentId).
% % handles(_, main).    % default fallback
%
% % Cron conflict detection: period in minutes, conflicts when one divides other
% % cron_period(JobName, PeriodMinutes).
% % conflicts(A, B) :-
% %     cron_period(A, P1), cron_period(B, P2),
% %     A \= B, 0 is min(P1,P2) mod max(P1,P2).
