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

## 4) 自動配信（8:30 JST）

Codex のオートメーション `Market Morning Brief` が平日 8:20（JST）に生成を開始し、8:30（JST）に Slack へ「サマリー + GitHub Pages へのリンク」を送る想定です。

GitHub Pages へ反映するため、生成後にリポジトリへ commit/push します（commit message は固定で `Daily brief`）。
