# プラグイン固有 Makefile。ルート Makefile から include される。
# 新規プラグイン作成時はこのファイルをテンプレートとしてコピーする。
#
# 規約:
#   - ターゲット名は "<このディレクトリ名>/<動詞>" で名前空間化する(例: freelens-oci-cluster/test)。
#     全プラグイン Makefile が同時に include されるため、衝突を避ける必要がある。
#   - プラグイン名を保持する共有変数(例: `PLUGIN := ...`)をここで定義しない: 2つ目の include が同名変数を再代入すると、
#     全プラグインのレシピが最後に include されたプラグインを指してしまう。プラグインディレクトリはパスに直接書くこと。

.PHONY: freelens-oci-cluster/test

freelens-oci-cluster/test: docker-image ## freelens-oci-clusterのvitestテストを実行
	@mkdir -p .pnpm-store
	$(DOCKER_RUN) -w /work/plugins/freelens-oci-cluster $(IMAGE) sh -c "(pnpm i --store-dir $(CONTAINER_STORE_DIR) --frozen-lockfile || pnpm i --store-dir $(CONTAINER_STORE_DIR)) && pnpm test"
