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

## 7) EDINET DB APIキー（任意）

EDINET DB の APIキーは **git に入れません**。

- ブラウザで使う（推奨）: `docs/fundamentals/index.html` / `docs/watchlist/manage.html` / `docs/watchlist/fundamentals.html` の画面で入力すると、キーは **ブラウザの localStorage にのみ保存**されます（リポジトリには保存されません）。
- GitHub Actions で使う: `Settings → Secrets and variables → Actions` に `EDINETDB_API_KEY` のような名前で登録して、workflow から環境変数として参照してください。
  - ファンダランキング（`docs/data/fundamentals_rankings.json` / `docs/data/hidden_gems.json`）は `.github/workflows/fundamentals-update.yml` が `EDINETDB_API_KEY` を使って自動更新します。

## Design system（ナレッジ）

- デザイン方針（保管）: `DESIGN.md`

## 適時開示PDF（日本語リンク）

- このプロジェクトでは、適時開示のPDFリンクは **公式TDnet**（`https://www.release.tdnet.info/inbs/...`）を優先して保存/表示します（通常は日本語PDF）。
- 公式が閲覧できない場合に備えて、**KabutanのPDFミラー**（`https://tdnet-pdf.kabutan.jp/...`）も併記用に保持します。
- 一部の開示（統合報告書など）は、元PDFが英語のみの場合があります（その場合は日本語リンクにしても英語になります）。

## 8) Slack点呼メッセージへの✅自動リアクション（GitHub Actions）

`#03_rooms`（`C0AFD5SKDG9`）に毎日 21:00 ちょうどに投稿される点呼メッセージへ、**自分のSlackアカウントとして** `:white_check_mark:` リアクションを付けるためのワークフローです。

- Workflow: `.github/workflows/rollcall-reaction.yml`（毎日 21:01 JST = 12:01 UTC）
- Script: `scripts/slack_rollcall_react.py`

有効化に必要な設定:

1. Slack でアプリを作成し、User OAuth（あなた自身のトークン）を発行してワークスペースへインストールします。
   - 必要スコープの目安: `reactions:write` +（メッセージ検索用に）`channels:history`（チャンネルがprivateなら `groups:history` も）
2. GitHub repo の `Settings → Secrets and variables → Actions` に `SLACK_USER_TOKEN` を追加します（**このトークンは漏洩すると危険**なので、共有/ログ出力しないでください）。
3. Actions の `Rollcall reaction` を `workflow_dispatch` で手動実行して動作確認できます。
