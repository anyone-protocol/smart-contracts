# Tier-2 device-parity runner: OTP 27 (HB builds maint-27) + luerl 1.3.0 (the exact
# luerl HyperBEAM v0.9-FINAL vendors, from its rebar.lock). Runs our runtime+contract
# through the real device Lua VM — no node.
FROM docker.io/erlang:27 AS build
WORKDIR /build
COPY rebar.config .
RUN rebar3 compile
COPY src ./src
RUN rebar3 escriptize

FROM docker.io/erlang:27
COPY --from=build /build/_build/default/bin/luerl_runner /usr/local/bin/luerl_runner
WORKDIR /work
ENTRYPOINT ["luerl_runner"]
