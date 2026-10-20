# Source of devcontainer-index.json

Cut by `tools/trim-template-index.ts` from https://containers.dev/static/devcontainer-index.json,
downloaded on 2026-10-20. The full file's sha256 was `a54e56190405b3cd97b32f6abdde7dc30a8f6a6b09b60ab290931ddccf5b7e29`.

It keeps only the metadata of the `ghcr.io/devcontainers/templates` collection, the specification's own
templates, and of the Features `common-utils`, `docker-in-docker`, `git`, `node`, `python` of
the `ghcr.io/devcontainers/features` collection, each collection with its source information. Both collections are the
specification's own, published under the MIT licence in `LICENSE` beside this file. It is test data of the
acceptance run only and reaches no package.
