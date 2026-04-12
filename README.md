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

## 5) 適時開示アラート（Slack）

GitHub Actions が 5分おきに適時開示（KabutanのTDnet一覧）を監視し、新着があれば Slack に「要約（タイトル+分類タグ）+ PDFリンク + ログURL」を投稿します。

有効化に必要な設定:

- GitHub repo の `Settings → Secrets and variables → Actions` で `SLACK_WEBHOOK_URL` を追加
  - Slack の「Incoming Webhook」を作り、投稿先チャンネルを指定したURLを入れます

ログ:

- `docs/data/tdnet.json` に蓄積され、`docs/tdnet/index.html` で検索できます。
