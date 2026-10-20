# Source of devcontainer-index.json

Cut by `tools/trim-template-index.ts` from https://containers.dev/static/devcontainer-index.json,
downloaded on 2026-10-20. The full file's sha256 was `a54e56190405b3cd97b32f6abdde7dc30a8f6a6b09b60ab290931ddccf5b7e29`.

It keeps only the metadata of the `ghcr.io/devcontainers/templates` collection, the specification's own
templates, of the Features `common-utils`, `docker-in-docker`, `git`, `node`, `python` of `ghcr.io/devcontainers/features`,
and of the community Features `Add Host`, `add-script`, `Adobe Experience Manager LTS`, each with its
collection's source information. The collections hold nothing else. The metadata is published under the MIT licence
in `LICENSE` beside this file. It is test data of the acceptance run only and reaches no package.
