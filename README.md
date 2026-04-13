# Market Morning Brief (Japan Stocks)

毎朝の日本株デイトレ向け「寄り前ブリーフ」を作り、GitHub Pages（HTML）で閲覧できるようにします。あわせて、Slackにサマリーとリンクを配信します。

## 1) 初回セットアップ（GitHub Pages）

1. GitHubに新しいリポジトリを作成（例: `market-morning-brief`）。
2. このローカルリポジトリにリモートを設定してpushします。
3. GitHubの `Settings → Pages` で以下を設定します。
   - Source: `Deploy from a branch`
   - Branch: `main`（または現在のデフォルトブランチ） / Folder: `/docs`

Pages URL は通常 `https://<github-username>.github.io/<repo>/` になります。

## 2) 設定ファイル

`brief.config.json` を編集して、GitHub PagesのURLを入れてください。

- `pages_base_url`: 例 `https://mamorukomo.github.io/market-morning-brief/`
- `slack_channel_id`: 配信先（現在: `C0ASFHVU94L`）

## 3) 生成される成果物

- `docs/index.html`: 最新のブリーフ
- `docs/archive/YYYY-MM-DD.html`: 日別アーカイブ
- `docs/archive/index.html`: アーカイブ一覧
- `docs/search.html`: 過去ログ検索（キーワード/銘柄/タグ）
- `docs/stocks/index.html`: 銘柄ログ（出現回数）
- `docs/tags/index.html`: タグログ（出現回数）
- `docs/data/briefs.json`: 過去ログのインデックス（検索/銘柄/タグが参照）

## 4) 自動配信（8:30 JST）

Codex のオートメーション `Market Morning Brief` が平日 8:10（JST）に生成を開始し、8:30（JST）に Slack へ「サマリー + GitHub Pages へのリンク」を送る想定です。

GitHub Pages へ反映するため、生成後にリポジトリへ commit/push します（commit message は固定で `Daily brief`）。

### 注意: 実行環境のネットワーク制限

Codex（このワークスペースのサンドボックス）では、`python`/`curl`/`git` から外部ネットワークに出られず DNS 解決が失敗することがあります（例: `Could not resolve host: github.com`）。

その場合でも **Codex の `web.run`（ブラウズ）で情報取得 → 生成スクリプトはオフライン実行** にすることで回避できます。

`scripts/morning_brief.py` は次の2モードで動きます。

- **オンライン実行（GitHub Actions向け）**: 通常どおりHTML/JSONを取得して生成
- **オフライン実行（Codex automation向け）**: `--cache-dir` に保存されたHTML/JSONだけで生成（ネットワーク不要）

オフラインで回す場合は、まず以下で必要URL一覧を出して（JSON）、そのURLを `web.run` で取得→ `--cache-dir` に保存してから生成します。

```bash
python3 scripts/morning_brief.py --print-cache-plan
python3 scripts/morning_brief.py --offline --cache-dir /tmp/brief-cache
```

### 現在の推奨構成（ハイブリッド）

- **Codex automation（推奨/主系）**: `web.run`でニュース収集→ `scripts/morning_brief.py --offline`でHTML生成→ `git push`→ Slack（Slack tools）投稿
- **GitHub Actions（補助/監視）**
  - 適時開示アラート: `.github/workflows/tdnet-alert.yml`（5分おき、SlackはWebhook）
  - ウォッチリスト定点: `.github/workflows/watchlist-snapshot.yml`（09:30/16:00 JST、SlackはWebhook）
  - ブリーフ手動生成（バックアップ）: `.github/workflows/morning-brief.yml`（`workflow_dispatch`のみ / 事前にテスト実行）

## 5) リポジトリ構成

- `pipelines/`: 実処理（ActionsとCodexの両方から利用）
- `scripts/`: CLI用の薄いラッパー（`python3 scripts/...` で実行）
- `tests/`: オフラインで動くパーサー/生成のユニットテスト
- `docs/`: GitHub Pagesで公開されるHTML/JS/CSSとログJSON

## 6) 適時開示アラート（Slack）

GitHub Actions が 5分おきに適時開示（KabutanのTDnet一覧）を監視し、新着があれば Slack に「要約（タイトル+分類タグ）+ PDFリンク + ログURL」を投稿します。

有効化に必要な設定:

- GitHub repo の `Settings → Secrets and variables → Actions` で `SLACK_WEBHOOK_URL` を追加
  - Slack の「Incoming Webhook」を作り、投稿先チャンネルを指定したURLを入れます

ログ:

- `docs/data/tdnet.json` に蓄積され、`docs/tdnet/index.html` で検索できます。
