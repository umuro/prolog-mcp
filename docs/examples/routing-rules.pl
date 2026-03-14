% routing-rules.pl
% Express message routing as Prolog rules in core.pl.
%
% Load with:
%   prolog_write_file("core.pl", <content>)
%
% Query:
%   prolog_query("handles(billing, Channel)")
%   → { "solutions": [{ "Channel": "telegram" }] }
%
% The final clause provides a default fallback for any topic
% not explicitly listed above it.

handles(billing,   telegram).
handles(support,   telegram).
handles(technical, discord).
handles(X, telegram) :- \+ handles(X, _).  % default fallback
