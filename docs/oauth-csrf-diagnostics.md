# OAuth CSRF 診断

OAuth の認証画面で `csrf-failed` が発生した場合、Worker はトークンの値を返さず、Cookie とフォーム値の状態だけを JSON で返す。

## レスポンス例

```json
{
  "error": "csrf-failed",
  "diagnostics": {
    "schemaVersion": 1,
    "state": "csrf-cookie-missing",
    "formToken": "present",
    "csrfCookie": "missing",
    "oauthStateCookie": "present",
    "cookieHeader": "present",
    "origin": "opaque-null",
    "fetchSite": "same-origin"
  }
}
```

## フィールド

| フィールド | 意味 |
| --- | --- |
| `state` | `form-token-missing`、`csrf-cookie-missing`、`token-mismatch`、`valid` |
| `formToken` | POST フォームに CSRF トークンが存在したか |
| `csrfCookie` | `__Host-GAZE-CSRFTOKEN` がリクエストに存在したか |
| `oauthStateCookie` | OAuth 状態 Cookie が存在したか |
| `cookieHeader` | リクエストに Cookie ヘッダーが存在したか |
| `origin` | Origin ヘッダーの状態。値そのものは返さない |
| `fetchSite` | Fetch Metadata の分類。値が未知の場合は `other` |

診断レスポンスには、CSRF トークン、OAuth 状態値、Cookie ヘッダーの内容、認証情報を含めない。レスポンスは `Cache-Control: no-store` で返す。

## 確認手順

1. OAuth 画面を新しく開く。
2. 「GitHub で続行」を押す。
3. `csrf-failed` が表示されたら JSON の `diagnostics.state` を確認する。
4. `csrf-cookie-missing` の場合は、ブラウザが Cookie を保存または送信できていない。
5. `token-mismatch` の場合は、古い OAuth 画面を使っているか、フォームと Cookie が別のブラウジングコンテキストにある。
6. Cookie の値は共有せず、フィールド名と状態だけを報告する。

## TDD 契約

診断状態の分類は `tests/diagnostics-oauth-contract.test.ts` で検証する。テストは、フォーム値・Cookie 値・OAuth 状態値が診断レスポンスに出力されないことも確認する。
