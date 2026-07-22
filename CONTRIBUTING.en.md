[日本語](CONTRIBUTING.md)

# Contributing

## Environment setup

`make build` / `make deploy` etc. run fully inside a Docker container.
The host only needs Docker and `jq`.

Paths that differ per contributor, such as the local FreeLens extensions directory, go in a `.env` file at the repo root (gitignored).

```sh
# Deploy target for `make deploy` (the FreeLens extensions directory).
# Without this, `make deploy` stops with an error.
# Example (operating a native Windows FreeLens from WSL):
#   /mnt/c/Users/<user>/.freelens/extensions
FREELENS_EXT_DIR=
```

Values can also be overridden per invocation with `make <target> VAR=value`.

## Build, test & deploy

The build is fully containerized; pnpm, node and electron are self-contained inside the build image.

```sh
make build    # install dependencies + build
make deploy   # build + deploy to FREELENS_EXT_DIR
make test     # run the vitest suite
make lint     # Biome lint
make fmt      # Biome format (--write)
make pack     # pack into a .tgz
make clean    # remove node_modules/out/*.tgz/.pnpm-store
```

### First-time setup

Before using `make deploy` on a new environment, install the extension once via the [README](README.en.md#install) steps (drag the `.tgz` onto the Extensions screen in FreeLens). A `.tgz` from `make pack` works too if you just want to try unreleased changes.

`make deploy` only updates an already-installed extension; running it before the extension has ever been installed may not take effect.

## Release process

1. Bump `version` in `package.json` to the value you want to release, and commit it
2. Run `make tag`.
   It creates and pushes the tag `vX.Y.Z` from the version in `package.json` (it refuses to run if that tag already exists)
3. GitLab CI picks up the tag and runs the following.
   - Builds and packs the extension into a `.tgz` (`make pack`) inside Docker
   - Uploads the `.tgz` and its `.sha256` to the GitLab Generic Package Registry
   - Creates a GitLab Release with those files attached
   - Mirrors the repository to GitHub
   - Creates a GitHub Release with the `.tgz` and `.sha256` attached

The GitHub mirror step only runs when the CI variables `GH_APP_ID` / `GH_APP_PRIVATE_KEY` are configured on the project.
When they are, every push to `master` and every tag is mirrored to GitHub automatically; without them, GitLab remains the sole source and the GitHub-facing jobs are skipped.
