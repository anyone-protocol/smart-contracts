%%% Tier-2 luerl scenario runner.
%%%
%%% Loads our lean runtime + a contract into a luerl 1.3.0 state (the exact luerl
%%% HyperBEAM v0.9-FINAL vendors) and runs a scenario through the REAL device VM,
%%% so luerl's divergences (integer semantics, string.gmatch gaps, cross-message
%%% persistence) are exercised without standing up a node.
%%%
%%% Modules are preloaded into package.loaded the same way the busted harness'
%%% freshEnv does — by evaluating each file and assigning its return — so contract
%%% `require('.common.x')` calls resolve with no luerl filesystem access.
%%%
%%% Usage:
%%%   luerl_runner eval "<lua source>"          -- smoke: eval a chunk, print result
%%%   luerl_runner run <repo_ao_root> <contract_rel> <StateGlobal> <scenario.lua>
-module(luerl_runner).
-export([main/1]).

main(["eval", Lua]) ->
    St0 = luerl:init(),
    try luerl:do(unicode:characters_to_binary(Lua), St0) of
        {ok, Res, _St1} -> io:format("OK ~p~n", [Res]);
        Other -> io:format("UNEXPECTED ~p~n", [Other]), halt(2)
    catch C:E:S -> io:format("ERR ~p:~p~n~p~n", [C, E, S]), halt(2) end;

main(["run", Root, ContractRel, StateGlobal, Scenario]) ->
    Program = build_program(Root, ContractRel, StateGlobal, Scenario),
    St0 = luerl:init(),
    try luerl:do(Program, St0) of
        {ok, Res, St1} ->
            Decoded = [luerl:decode(R, St1) || R <- Res],
            report(Decoded);
        Other -> io:format("LUERL non-ok ~p~n", [Other]), halt(2)
    catch
        C:E:S ->
            io:format("LUERL ERROR ~p:~p~n~p~n", [C, E, S]),
            halt(2)
    end;

%% D26 native shape: preload deps, install the native runtime, register the contract
%% (which RETURNS a { state, actions, views } table), then run a scenario. `native` and
%% `compute` are globals so the scenario can call compute()/native.view().
main(["native", Root, ContractRel, Scenario]) ->
    Program = build_native_program(Root, ContractRel, Scenario),
    St0 = luerl:init(),
    try luerl:do(Program, St0) of
        {ok, Res, St1} ->
            report([luerl:decode(R, St1) || R <- Res]);
        Other -> io:format("LUERL non-ok ~p~n", [Other]), halt(2)
    catch
        C:E:S ->
            io:format("LUERL ERROR ~p:~p~n~p~n", [C, E, S]),
            halt(2)
    end;

%% Verify a self-contained deployable BUNDLE: load it (defines global compute +
%% registers handlers with no external preloads), then run a scenario in that state.
main(["bundle", BundlePath, Scenario]) ->
    Bundle = read(BundlePath),
    Scen = read(Scenario),
    St0 = luerl:init(),
    try luerl:do(Bundle, St0) of
        {ok, _, St1} ->
            case luerl:do(Scen, St1) of
                {ok, Res, St2} -> report([luerl:decode(R, St2) || R <- Res]);
                Other -> io:format("scenario non-ok ~p~n", [Other]), halt(2)
            end;
        Other -> io:format("bundle non-ok ~p~n", [Other]), halt(2)
    catch C:E:S -> io:format("BUNDLE ERROR ~p:~p~n~p~n", [C, E, S]), halt(2) end;

%% Measure the cost of json.decode-ing a large payload under the REAL device VM. Answers:
%% "what happens if the seed/spawn message is several MB?" Times a parse-only run and a
%% parse+decode run in fresh luerl states; decode ≈ the difference.
main(["decode-timing", Root, JsonFile]) ->
    P = fun(Rel) -> filename:join(Root, Rel) end,
    Payload = read(JsonFile),
    JsonSrc = read(P("runtime/vendor/json.lua")),
    Preload = [<<"package.loaded['json'] = (function()\n">>, JsonSrc, <<"\nend)()\n">>,
               <<"local json = package.loaded['json']\n">>,
               <<"local P = [==[\n">>, Payload, <<"\n]==]\n">>],
    ProgA = iolist_to_binary([Preload, <<"return #P\n">>]),
    ProgB = iolist_to_binary([Preload,
        <<"local d = json.decode(P)\nlocal n=0\nfor _ in pairs(d) do n=n+1 end\nreturn n\n">>]),
    io:format("payload bytes: ~p~n", [byte_size(Payload)]),
    {TA, _}  = time_do(ProgA),
    {TB, RB} = time_do(ProgB),
    io:format("parse-only:    ~p ms~n", [TA]),
    io:format("parse+decode:  ~p ms  (top-level keys: ~p)~n", [TB, RB]),
    io:format("decode approx: ~p ms~n", [TB - TA]),
    halt(0);

main(_) ->
    io:format("usage: luerl_runner eval <lua> | run <root> <contract> <State> <scenario> | native <root> <contract> <scenario> | bundle <bundle.lua> <scenario> | decode-timing <root> <jsonfile>~n"),
    halt(1).

time_do(Program) ->
    T0 = erlang:monotonic_time(millisecond),
    R = (catch luerl:do(Program, luerl:init())),
    T1 = erlang:monotonic_time(millisecond),
    Res = case R of {ok, V, _} -> V; Other -> Other end,
    {T1 - T0, Res}.

%% Assemble one Lua chunk: preload deps, install runtime, load contract, run scenario.
build_program(Root, ContractRel, StateGlobal, ScenarioPath) ->
    P = fun(Rel) -> filename:join(Root, Rel) end,
    Preloads = [
        {<<"json">>,           P("runtime/vendor/json.lua")},
        {<<".common.bigint">>, P("src/contracts/common/bigint.lua")},
        {<<".common.errors">>, P("src/contracts/common/errors.lua")},
        {<<".common.utils">>,  P("src/contracts/common/utils.lua")},
        {<<".common.acl">>,    P("src/contracts/common/acl.lua")}
    ],
    PreloadSrc = [preload(Name, read(Path)) || {Name, Path} <- Preloads],
    Parts = [
        PreloadSrc,
        <<"package.loaded['.json'] = package.loaded['json']\n">>,
        <<"local runtime = (function()\n">>, read(P("runtime/runtime.lua")),
        <<"\nend)()\nruntime.install()\n">>,
        <<"do (function()\n">>, read(P(ContractRel)),
        <<"\nend)() end\n">>,
        [<<"runtime.manage(">>, StateGlobal, <<")\n">>],
        <<"runtime.manage(package.loaded['.common.acl'].State)\n">>,
        <<"return (function()\n">>, read(ScenarioPath), <<"\nend)()\n">>
    ],
    iolist_to_binary(Parts).

%% Assemble one Lua chunk for the native shape: preload deps, install native runtime,
%% register the contract table, run scenario. `native`/`compute` are left global.
build_native_program(Root, ContractRel, ScenarioPath) ->
    P = fun(Rel) -> filename:join(Root, Rel) end,
    Preloads = [
        {<<"json">>,           P("runtime/vendor/json.lua")},
        {<<".common.errors">>, P("src/contracts/common/errors.lua")},
        {<<".common.utils">>,  P("src/contracts/common/utils.lua")},
        {<<".common.eip55">>,  P("src/contracts/common/eip55.lua")}
    ],
    PreloadSrc = [preload(Name, read(Path)) || {Name, Path} <- Preloads],
    Parts = [
        PreloadSrc,
        <<"package.loaded['.json'] = package.loaded['json']\n">>,
        <<"native = (function()\n">>, read(P("runtime/native.lua")),
        <<"\nend)()\nnative.install()\n">>,
        <<"native.register((function()\n">>, read(P(ContractRel)),
        <<"\nend)())\n">>,
        <<"return (function()\n">>, read(ScenarioPath), <<"\nend)()\n">>
    ],
    iolist_to_binary(Parts).

preload(Name, Src) ->
    [<<"package.loaded['">>, Name, <<"'] = (function()\n">>, Src, <<"\nend)()\n">>].

read(Path) ->
    case file:read_file(Path) of
        {ok, Bin} -> Bin;
        {error, Reason} -> io:format("cannot read ~ts: ~p~n", [Path, Reason]), halt(3)
    end.

%% The scenario returns a Lua table { pass=, fail=, failures={...} }; luerl decodes
%% a table to a proplist. Print a summary and exit non-zero on any failure.
report(Res) ->
    Tbl = case Res of [T | _] -> T; _ -> Res end,
    Pass = kv(Tbl, <<"pass">>, 0),
    Fail = kv(Tbl, <<"fail">>, 0),
    Failures = kv(Tbl, <<"failures">>, []),
    io:format("=== luerl (1.3.0) scenario ===~n"),
    lists:foreach(fun(F) -> io:format("  FAIL  ~ts~n", [failure_name(F)]) end, Failures),
    io:format("=== ~p passed, ~p failed ===~n", [trunc(Pass), trunc(Fail)]),
    case trunc(Fail) of 0 -> ok; _ -> halt(1) end.

failure_name({_I, Name}) -> Name;
failure_name(Name) -> Name.

kv(Proplist, Key, Default) when is_list(Proplist) ->
    case lists:keyfind(Key, 1, Proplist) of
        {Key, V} -> V;
        false -> Default
    end;
kv(_, _, Default) -> Default.
