# The base image of the containers launches' dev containers: the harness host's Alpine, pinned by the same digest, with
# the libstdc++ the VSCodium server for Alpine needs. The server ships its own node, which the exec relay runs.
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
RUN apk add --no-cache libstdc++
