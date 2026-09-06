# 診断ログの TDD

実施日: 2026-09-06 / 対象: DATA-05、診断ログの自動送信境界

## 固定した契約

自動送信の対象は `basic` の集計だけとする。詳細診断を選んだセッションでも、送信直前に `frames` を除去し、ランドマーク、派生特徴量、推定点、連続視線履歴を payload に残さない。送信は明示的な同意とビルド時の `VITE_DIAGNOSTIC_UPLOAD_ENDPOINT` の両方がある場合だけ画面から呼び出す。

受信先には認証情報を渡さず、`POST` の JSON とする。同一セッションは送信成功後にブラウザ内で重複送信を抑止する。一時的な HTTP エラー、タイムアウト、ネットワークエラーは最大 2 回まで再試行する。送信失敗や endpoint 未設定は実験結果を止めず、詳細ログの手動ダウンロードを使える状態にする。

## Red → Green

| 段階 | コマンド | 結果 |
| --- | --- | --- |
| Red | `node --test tests/diagnostic-upload.test.ts` | `src/core/diagnostic-upload.ts` が存在しないため失敗。テストが要求する公開 payload、送信、再試行、重複抑止の契約を先に固定した。 |
| Green | `node --test tests/diagnostic-upload.test.ts` | 3 件成功。詳細レポートの基本集計化、認証情報なしの送信、同一セッションの重複抑止、503 からの再試行、endpoint 未設定のスキップを確認した。 |
| Worker Red | `node --test tests/diagnostic-worker.test.ts` | `worker/diagnostics-worker.ts` が存在しないため失敗。CORS、R2 の決定的なキー、詳細フレーム拒否、公開読み出しなしの契約を先に固定した。 |
| Worker Green | `node --test tests/diagnostic-worker.test.ts` | 3 件成功。基本診断だけの受信、許可 origin、R2 保存、詳細フレーム拒否、GET / DELETE 経路なしを確認した。 |
| Refactor / 全体確認 | `npm run check`、`npm run build`、`git diff --check` | 型検査と 46 件のユニットテスト、ビルド、空白検査が成功した。 |

## 画面への接続

設定画面に「基本診断を実験終了時に自動送信する」を追加した。受信先が設定されていない公開ビルドではチェックボックスを無効にする。実験終了時に送るのは公開用 `basic` スナップショットだけで、詳細 JSON はカメラ準備画面または結果画面から手動でダウンロードする。GitHub Issue は引き続き本人が内容を確認してから開く。

Worker の受信検証と R2 の決定的な保存キーは実装した。Cloudflare アカウントでの Worker 公開、R2 バケット作成、CORS の Pages origin への設定、保存期間、管理者による削除経路はこの TDD スライスの外に置いた。アカウント操作が必要な段階で、受信先名などを確認してから設定する。
