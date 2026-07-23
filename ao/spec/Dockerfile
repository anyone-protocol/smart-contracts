# Tier-1 spec runner: Lua 5.3 (luerl's language level) + busted.
# Specs are mounted at run time; this image is just the toolchain.
FROM docker.io/nickblah/lua:5.3-luarocks-alpine

# build-base: C toolchain for busted's compiled deps (luafilesystem, luasystem, term)
RUN apk add --no-cache build-base \
 && luarocks install busted

WORKDIR /work
ENTRYPOINT ["busted"]
