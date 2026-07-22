FREELENS_EXT_DIR ?=
-include .env
IMAGE := freelens-plugin-builder
CONTAINER_STORE_DIR := /work/.pnpm-store

# --user を外すと bind mount 出力(node_modules/, out/ 等)が root 所有になる。
# HOME=/tmp を外すと host uid が /etc/passwd 未登録で pnpm/npm の書き込み先が無くなる。
DOCKER_RUN := docker run --rm --user $(shell id -u):$(shell id -g) -e HOME=/tmp -v $(CURDIR):/work -w /work $(IMAGE)
# lockfile が最新ならそのまま、古ければ更新込みで再インストール。
PNPM_I := (pnpm i --store-dir $(CONTAINER_STORE_DIR) --frozen-lockfile || pnpm i --store-dir $(CONTAINER_STORE_DIR))

.DEFAULT_GOAL := help
.PHONY: help docker-image build build-mock pack deploy deploy-mock tag clean lint fmt test

help: ## このヘルプを表示
	@grep -hE '^[a-zA-Z0-9_/%-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-28s\033[0m %s\n", $$1, $$2}'

docker-image: ## ビルダーイメージをビルド(未存在時のみ)
	@docker image inspect $(IMAGE) >/dev/null 2>&1 || docker build -t $(IMAGE) -f docker/Dockerfile .

build: docker-image ## 依存関係インストール+ビルド
	@mkdir -p .pnpm-store
	$(DOCKER_RUN) sh -c "$(PNPM_I) && pnpm build"

pack: build ## .tgz にパック
	$(DOCKER_RUN) pnpm pack

# mock/ 配下(gitignore対象)のダミーデータでOCI取得層を差し替えてビルドする。
# README用スクリーンショット撮影専用(mock/oci-cluster-store.mock.tsが無いと通常ビルドと同じ結果になる)。
build-mock: docker-image ## モックデータでビルド(スクリーンショット撮影用)
	@mkdir -p .pnpm-store
	$(DOCKER_RUN) sh -c "$(PNPM_I) && MOCK=1 pnpm build"

deploy: BUILD_TAG := dev
deploy: build ## $(FREELENS_EXT_DIR) へ配置(配置先 package.json のみ dev build metadata 付与)

deploy-mock: BUILD_TAG := mock
deploy-mock: LABEL := (MOCK)
deploy-mock: build-mock ## モックビルドを $(FREELENS_EXT_DIR) へ配置(スクリーンショット撮影用)

deploy deploy-mock:
	@test -n "$(FREELENS_EXT_DIR)" || { echo "FREELENS_EXT_DIR is not set (set it in .env, or: make $@ FREELENS_EXT_DIR=/path/to/.freelens/extensions)"; exit 1; }
	mkdir -p "$(FREELENS_EXT_DIR)/freelens-oci-cluster"
	@jq --indent 2 --arg dev "$(BUILD_TAG).$$(date +%s)" '.version |= . + "+" + $$dev' package.json > "$(FREELENS_EXT_DIR)/freelens-oci-cluster/package.json"
	@echo "== freelens-oci-cluster v$$(jq -r .version "$(FREELENS_EXT_DIR)/freelens-oci-cluster/package.json")$(if $(LABEL), $(LABEL)) =="
	# cp -r は上書きのみで削除しないため、先に rm -rf しないと構成変更時に古いファイルが残る。
	rm -rf "$(FREELENS_EXT_DIR)/freelens-oci-cluster/out"
	cp -r out "$(FREELENS_EXT_DIR)/freelens-oci-cluster/out"

tag: ## package.json の version からリリース用タグ vX.Y.Z を作成し push
	@V=$$(jq -r .version package.json); \
	TAG="v$$V"; \
	if git rev-parse "$$TAG" >/dev/null 2>&1; then \
		echo "tag $$TAG already exists"; exit 1; \
	fi; \
	git tag "$$TAG" && git push origin "$$TAG" && echo "pushed $$TAG"

clean: ## node_modules/out/*.tgz/.pnpm-store を削除
	rm -rf node_modules out .pnpm-store
	rm -f *.tgz

lint: docker-image ## Biome lint
	@mkdir -p .pnpm-store
	$(DOCKER_RUN) sh -c "$(PNPM_I) && pnpm exec biome check ."

fmt: docker-image ## Biome format (--write)
	@mkdir -p .pnpm-store
	$(DOCKER_RUN) sh -c "$(PNPM_I) && pnpm exec biome check --write ."

test: docker-image ## vitest テストを実行
	@mkdir -p .pnpm-store
	$(DOCKER_RUN) sh -c "$(PNPM_I) && pnpm test"
