# 認証画面の Cookie 自動確認

対象: DATA-05 の認証情報を診断ログに含めない制約、および非公開診断の OAuth 接続の障害切り分け。

認証画面を表示すると、一度だけ同一 origin の POST /authorize/cookie-check へ画面の CSRF トークンを送る。HttpOnly Cookie は JavaScript で読まず、ブラウザがリクエストに付けた Cookie を Worker 側で比較する。トークンを URL、応答、画面、ログへ出さない。応答は既存の匿名化診断項目だけで、no-store とし CORS 読み取りを許可しない。

結果は「GitHub で続行」の上に表示する。正常、欠落、不一致、画面トークン欠落、通信失敗、5 秒の時間切れを区別する。確認は Cookie の再設定・削除、KV 保存、認証許可を行わない。続行時の既存 CSRF 検証は引き続き必須。JavaScript が無効でも通常の認証は実行できる。

スクリプトは応答ごとの nonce で CSP に許可する。埋め込み環境でページの origin が opaque になる場合にも動くよう、フォーム送信先とスクリプト通信先には Worker の明示的な origin を指定し、OAuth の転送先として GitHub だけを許可する。Cookie の属性や CSRF の許可条件は変更しない。Cookie 確認の fetch は、opaque origin からも Cookie を送れるよう credentials を include にする。

## 利用手順

1. この変更を develop に統合し、Worker の本番トラフィックに反映する。
2. MCP クライアントから接続を最初から開始する。/authorize の URL だけを直接開かない。
3. 認証画面上の「Cookie 確認」の結果を待つ。結果の文章を共有すればよく、Cookie の値をコピーする必要はない。
4. 続行時に csrf-failed が出る場合、その JSON と表示直後の結果を比較する。

表示直後から欠落なら、最初の応答での設定・保存・返送を調べる。表示直後は正常で続行時に欠落するなら、その間の期限切れ・削除・別画面での操作などを調べる。正常という結果は取得リクエスト時点だけを示し、次のフォーム送信で届くことを保証しない。この機能自体は欠落の修正ではない。

## 検証

- Red: node --test tests/oauth-cookie-probe.test.ts。未実装の 404 応答に対し、正常・欠落・不一致・不正メソッドの 4 テストが失敗。
- Green: 同じ 4 テストが成功。自動実行・通信失敗・時間切れを含む計 8 テストが成功。
- CSP の受け入れテストで、opaque origin のフォーム送信、GitHub 転送、Cookie 確認通信の許可を確認。
- Refactor: 既存の Cookie 読み取りと比較を共通モジュールへ移動し、認証側と診断側の実装差を避けた。
- npm run check: 型検査と全 79 テスト成功。Worker 型検査成功。
- Node の DOM/fetch 代替で表示処理を確認。本物のブラウザでの Cookie 保存、CSP 適用、ユーザーの接続環境は未確認。統合・本番デプロイ後に上記手順で確認する。
