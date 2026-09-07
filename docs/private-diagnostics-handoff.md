# gaze-caret: 非公開の詳細診断・自動共有 実装要件とエージェント引き継ぎ

作成日: 2026-09-07 / 状態: 実装開始用の要求仕様。実装完了・本番接続確認を意味しない。

## 0. 最初に読むこと

ユーザーの目的は、実験中の詳細診断 JSON、特徴量、生ランドマーク、連続視線履歴、カメラ画像・短い映像を、許可した範囲で非公開保存し、チャットから依頼すればエージェントが添付操作なしで参照できるようにすること。

- 利便性: 初回設定後は実験ごとの細かな確認を減らし、記録・送信・取得を可能な限り自動化する。
- 安全性: データの収集、外部保存、AI 参照を独立した権限として管理する。完全な無リスクや完全削除を約束しない。
- ユーザーしか行えない操作が判明したら、その時点ですぐに具体的に尋ねる。最終報告まで溜めない。秘密値そのものをチャットに貼らせない。
- 実装は TDD。短命ブランチから develop 宛ての PR。main はリリース用。所有者が確認して統合する。今回の要件整理はマージ・本番デプロイの新たな許可ではない。
- 最初の技術検証は「現在の ChatGPT Work から認証付き MCP を通してダミーの非公開データを取得できるか」。使えると仮定して本実装を終わらせない。
- この文書の数値は初期設定案。実測性能や Cloudflare の契約上限ではない。変更した場合は理由と測定条件を記録する。

## 1. 現行実装と確認範囲

リポジトリ: https://github.com/shgnaka/gaze-caret

2026-09-07 に GitHub の develop 上の README.md、CONTRIBUTING.md、docs/tdd-diagnostics.md、src/core/diagnostics.ts、worker/diagnostics-worker.ts を参照。ルート AGENTS.md は取得時 404。着手時には最新 HEAD、追加指示、未統合 PR を再確認すること。この確認は本番疎通確認ではない。

既存資料:
- https://github.com/shgnaka/gaze-caret/blob/develop/docs/requirements.md
- https://github.com/shgnaka/gaze-caret/blob/develop/docs/validation-plan.md
- https://github.com/shgnaka/gaze-caret/blob/develop/docs/development-strategy.md
- https://github.com/shgnaka/gaze-caret/blob/develop/docs/experiment-runner.md
- https://github.com/shgnaka/gaze-caret/blob/develop/docs/tdd-diagnostics.md
- https://github.com/shgnaka/gaze-caret/blob/develop/CONTRIBUTING.md

既存契約: /ingest は基本集計専用。frames を含む詳細レポートを拒否し、basic/<sessionId>.json に保存する。詳細ダウンロードはローカル経路。公開読み取り API はない。Origin の検証は本人認証ではない。

会話で報告済みのデプロイ先: https://gaze-caret-diagnostics.shogonakamurawppt.workers.dev/
基本送信先: 上記の /ingest。Pages origin: https://shgnaka.github.io
既存ビルド変数: VITE_DIAGNOSTIC_UPLOAD_ENDPOINT
既存ローカル構成では R2 binding は DIAGNOSTICS、bucket 名は gaze-caret-diagnostics。実装前に最新 wrangler.toml と実環境を照合する。

本番での変数値、R2 ポリシー、保存期間、実データ到着、独自 MCP の利用権限は未確認。コードや CI 成功のみでこれらを確認済みと報告しない。

関連実装の入口:
- src/core/diagnostics.ts: レポート型、上限付きフレーム・イベント記録。
- src/core/diagnostic-upload.ts: 基本集計化、自動送信と再試行。
- src/main.ts: カメラ・モデル・画面と記録の接続。
- src/core/camera-session.ts / runner.ts: カメラと実験の状態管理。
- worker/diagnostics-worker.ts: 基本受信 API。
- tests/diagnostics.test.ts / diagnostic-upload.test.ts / diagnostic-worker.test.ts / browser/runner.spec.ts: 回帰テストの入口。

既存の「詳細を自動送信しない」という説明は現行経路の記録として正しい。新機能は別の認証付き v2 経路で追加し、README・要件・実験説明に新旧の適用範囲を明記する。既存 /ingest の拒否テストを削除して詳細を通す方法は禁止。

## 2. スコープと完成像

必須:
1. カメラ準備前から失敗も含めた実験全体の診断。
2. 詳細 JSON、ランドマーク、特徴量、視線履歴の許可付き自動送信。
3. 成功例と失敗例の画像、許可した短い動画の自動送信。
4. 本人専用の一覧、送信状況、共有停止、削除、手動ダウンロード。
5. 認証付き読み取り専用 MCP。実験一覧 → 概要 → 必要な区間・画像の段階取得。
6. 監査、期限、撤回、容量制限、異常系のテスト。

範囲外: 常時バックグラウンド監視、音声、画面録画、一般 Web 閲覧履歴、顔識別、健康・感情推定、学習への自動転用、ログ到着だけで会話外のエージェントを起動する仕組み。学習への利用は将来の別目的・別同意。今回のアプリ内実験ページとフィクスチャに限定する。

元の製品方針も維持: Vimium-C は fork せず共存。カメラ位置確認、単段落群から複雑 CSS への段階実験、視線精度とソフトウェア correctness の区別。

## 3. 権限と画面要件

REQ-C01: データ種別 basic / detail / landmarks / features / gaze / image / video ごとに capture、upload、aiRead を管理する。upload は capture を、aiRead は保存済みまたは upload を前提とする。矛盾する組み合わせは UI とサーバーの両方で拒否。
REQ-C02: 初回は詳細送信・画像・動画・AI 参照を無効。明示選択後は本人用プリセットを保存可能。設定保存と実験に適用した consent snapshot は別物とする。
REQ-C03: consent は purpose、policyVersion、subject、session、許可種別、時刻、revision を持つ。クライアント送信の ownerId や「同意済み」フラグだけを信用せず、認証主体とサーバー上の許可に照合する。
REQ-C04: プリセットの許可拡大は既存実験へ遡及しない。既存データを共有する場合は対象実験・種別を明示した操作が必要。
REQ-C05: 実験開始前に送信種別、保存先、AI 参照、期限を短く表示。記録・送信・停止・オフライン状態を常時確認可能。毎フレーム・毎ファイルの確認は不要。
REQ-C06: 「記録停止」「自動送信停止」「AI 共有停止」「保存済みデータ削除」を別操作として提供。各操作の効果を表示する。
REQ-C07: 記録停止は新規収集とメモリバッファを停止・破棄。送信停止は待機キューと進行中送信を中断し、サーバーの許可 revision も更新。AI 共有停止は次の読み取りから拒否。削除は関連オブジェクト・派生画像・索引まで追跡。
REQ-C08: オフライン撤回ではローカル停止を即時実行し「サーバー反映待ち」を表示。通信回復時は撤回を送信再開より優先する。遠隔での即時失効を偽って表示しない。
REQ-C09: 設定が読めない、認証切れ、未知の policyVersion は詳細送信を止める。基本の視線実験を不要に止めない。
REQ-C10: 手動共有は対象実験・データ種別・サイズを確認し、認証された同じ送信経路を使う。元のローカル JSON ダウンロードも残す。画面内に秘密値を出さない。

## 4. 計測データ契約

v2 の独立した schema を定義し、旧 v1 を無理に拡張しない。JSON Schema または同等の runtime validator と TypeScript 型を整合させる。未知のフィールド、非有限数、過大配列、過深ネストを拒否。すべて UTF-8、日時は UTC、時間差は単調時計の ms。

| レコード | 必須内容 |
| --- | --- |
| SessionManifest | schemaVersion、serverSessionId、status、serverCreatedAt、clientStartUtc、clockOrigin、buildCommit、consentRevision、モデル・特徴量・校正の版、実験設定の hash、フィクスチャ版、artifact 一覧、欠測・終了理由 |
| Environment | カメラ位置の自己申告、実際の幅・高さ・FPS、viewport の CSS px、devicePixelRatio、ズームは取得可能性と算出法、スクロール、顔までの距離は自己申告なら明記 |
| FrameRecord | frameId、cameraGeneration、captureTimeMs、inferenceStart/EndMs、phase、faceCount、validity/rejectReason、許可された landmarks/features/gaze、target、artifact との参照 |
| Event | eventId、timeMs、phase、列挙した code、許可済み構造化 detail、severity、correlationId |
| Artifact | artifactId、kind、contentType、bytes、SHA-256、timeRange、frameIds、chunkIndex、captureTransform、expiresAt、uploadState |
| Audit | actor の内部 ID、操作、session/artifact の内部 ID、時刻、結果、requestId。生データ・鍵・URL の query は含めない |

REQ-D01: 座標系を明示する。ランドマークはモデルの座標定義・順序・鏡像有無、視線と目標は viewport CSS px、画像は pixel 座標。crop/resize/mirror の変換を保存。単位と欠損 null を仕様化し、ゼロで代用しない。
REQ-D02: フレーム番号はカメラ再起動を識別し、画像と推論を同じ入力フレームへ結びつける。単に近い時刻の別画像を対応画像と呼ばない。動画で厳密対応できない場合は時間誤差と対応方式を記録。
REQ-D03: 校正目標は指示座標であり実際の注視の真値ではない。校正・独立検証の区別、学習データの範囲、モデル設定を記録する。
REQ-D04: デバイス ID、カメラのシリアルや自由文字の label、認証情報、ローカルパス、任意 URL・本文・キー入力は収集しない。エラー stack は許可形式へ変換。ブラウザ版など再現に必要な環境情報は専用フィールドに限定。
REQ-D05: 未検出画像も必要。顔 crop を作れない失敗時は許可された原画像を利用し、背景が写ることを事前表示。未知の顔を識別しない。複数人検出時は既定で media の保存を抑止し、その理由を記録。ただし検出による第三者の完全排除は保証しない。

## 5. フローごとのログ範囲

| フェーズ | 必須イベント・計測 |
| --- | --- |
| 設定・認証 | 設定適用、非機密の認証成否、endpoint 設定有無、consent revision |
| カメラ確認 | 要求開始・拒否・取得失敗、実 settings、video readiness、フレーム停止、track ended |
| モデル準備 | asset/build の版、読み込み開始・失敗・完了、WASM 初期化、初回推論、初回有効特徴量 |
| 検出 | 顔数、欠測、特徴量棄却理由、推論時間、連続失敗期間、例外、間引き・drop |
| 校正・検証 | 目標表示、サンプル採用/棄却、校正 fitting 成否、独立検証誤差、再校正理由 |
| 練習・測定 | 目標・推定点・選択結果・補正数・操作時間、フィクスチャ・設定の変化 |
| 休憩・復帰 | visibility、pause/resume、cameraGeneration、配置再確認、精度確認 |
| 終了・中断 | 正常終了/中断/失敗、保持済み区間、欠測区間、送信結果 |
| 通信・閲覧 | キュー、試行数、拒否理由、容量、期限、取得監査。ログ本文をサーバーの console に出さない |

REQ-F01: session はカメラ準備前に作り、校正ボタンが押せない状態も診断対象とする。20 秒程度有効特徴量が得られない場合は非ブロッキングの診断案内を表示。タイムアウトを顔検出不能の確定判定にしない。
REQ-F02: 開始不能・途中中断でも保存済みデータを送信可能。ページ終了時の送信完了は保証せず、途中保存・再開と欠測表示で扱う。

## 6. 収集量・性能の初期値

| 設定 | 初期値と動作 |
| --- | --- |
| 数値フレーム | 最大 30 Hz。全推論の集計と保存サンプル数を別計数。間引きは明記 |
| 詳細 chunk | 非圧縮 JSON 1 MiB 以下。5 秒または上限で区切る |
| 画像 | 失敗の開始/継続と比較用成功を採取。10 秒以上の間隔、実験あたり最大 20 枚、1 枚 1 MiB 以下 |
| 動画 | 最大 10 秒/clip、実験あたり最大 3 本、1 本 10 MiB 以下。audio track は作成しない |
| 実験上限 | 診断記録は 30 分・全体 50 MiB。到達後は詳細収集を停止し実験自体は継続 |
| ローカルバッファ | メモリ 32 MiB を上限とする。media の長期ローカル保存は既定無効 |
| 再送 | 1/2/4/8/16 秒に jitter を加え最大 5 回、その後保留。401/403 はログイン/権限回復まで停止。429 は Retry-After を尊重 |
| 保存期間 | 詳細数値 14 日、画像 7 日、動画 1 日。サーバー受信時刻を基準 |

REQ-P01: 画質を盲目的に落とさない。目の判別に十分な解像度・圧縮率を実機比較し、カメラの元設定と保存変換を記録。性能が悪ければ画像・動画頻度から落とす。
REQ-P02: 比較対象は診断無効/数値のみ/media 有効。同条件で推論 p50/p95、フレーム drop、記録 CPU 負荷の測定可能な代替、メモリ、送信量を報告。推論 p95 が 20% を超えて悪化する場合は既定値を下げて再評価する初期ゲートとする。
REQ-P03: MediaRecorder 非対応時は数値・静止画へ降格。圧縮により実験の入力を変えない。診断の都合で注視正解率を捏造しない。
REQ-P04: オフライン時は上限付きメモリキューが既定。再読み込みを跨ぐ保持は別 opt-in とし、最大 24 時間の数値のみを初期対象。共有 PC と暗号鍵保管のリスクを説明。ブラウザ終了を跨ぐ media の確実な再送は初期版の保証外。

## 7. サーバー構成と認証

推奨初期構成: 認証付き診断 Web/API + private R2 + 原子的な権限/索引ストア + read-only MCP。権限・撤回・commit 競合には強い整合性が必要。D1 の transaction/CAS または Durable Objects の直列化を比較し ADR で 1 つ選ぶ。R2 listing やブラウザの状態だけを権限 DB にしない。

REQ-S01: 本人 1 名の allowlist から開始するが、すべての session/artifact を認証 subject に紐付ける。他人の ID を渡す negative test を初日から作る。
REQ-S02: browser のログインと MCP の OAuth 等は別のクライアントとして実証する。Cloudflare Access のブラウザ Cookie や service token を置けば MCP で使えると仮定しない。OAuth は既存の保守された実装を優先し、issuer/audience/expiry/scope を検証。
REQ-S03: 認証付き UI は API と同じ origin に置く案を第一候補とし、公開 Pages からそこへ移動する。Pages と API 間の認証を採用するなら third-party cookie 制約、CORS、CSRF を実ブラウザで検証。長期 token を VITE_*、URL query、localStorage に埋め込まない。
REQ-S04: private R2 は公開ドメイン無効。既存 basic とは prefix または bucket と権限を分離。機微データは認証済み経路からのみ保存する。
REQ-S05: 初期版は Worker 経由の上限付き chunk upload を優先する。受信 bytes を stream 中に計数し、上限超過で中断。申告 Content-Length だけを信用しない。署名 URL による直接 upload は代替 ADR とし、再利用、過大 upload、失効不能時間、未確定領域、post-validation を扱うまで採用しない。
REQ-S06: artifact は staging → validated → committed。最終 commit 時も最新 consent と session 状態を原子的に確認する。撤回と commit が競合したら権限 revision により古い commit を拒否し、staging を掃除。
REQ-S07: TLS、保存時暗号化、最小権限、秘密のサーバー保管を必須とする。必要ならアプリ暗号化を追加できるが、鍵を同じサービスに置くだけで E2E と呼ばない。AI に渡す時点でデータは外部の処理先へ開示される。
REQ-S08: ダウンロードは毎回認証・最新権限・期限を検証し Cache-Control: no-store。生データの署名付き GET URL をチャットや公開 Issue へ渡さない。CDN/shared cache 無効。
REQ-S09: Rate limit と日次総容量を owner ごとに強制。日次初期上限 200 MiB、同時 upload 2。課金増を伴う変更はユーザーへ尋ねる。
REQ-S10: CSRF、CORS、XSS 対策、MIME と実内容検査、有限サイズ JSON 検証、圧縮爆弾拒否、任意 key/path 指定拒否。media 由来の自由文字や診断内容を命令として実行しない。

## 8. API の実装契約案

実装開始 PR で OpenAPI 相当の契約を固定する。すべて /v2 以下、旧 /ingest は別契約。ID はサーバー生成の不透明 ID。返却 owner は入力から採用しない。

| 操作 | 経路案 | 契約 |
| --- | --- | --- |
| 実験作成 | POST /v2/sessions | 認証 subject、許可 snapshot、設定。sessionId/revision/limits を返す |
| 設定・許可更新 | PATCH /v2/sessions/:id/consent | expectedRevision を必須とする。古い更新は 409 |
| upload 予約 | POST /v2/sessions/:id/artifacts | kind、サイズ、hash、時間帯を検証。uploadId を返す |
| chunk 送信 | PUT /v2/uploads/:id/chunks/:index | 所有者・期限・同意・サイズを毎回確認。冪等 hash 照合 |
| upload 確定 | POST /v2/uploads/:id/complete | 実 bytes/hash/type と最新権限を検証し原子的公開 |
| 実験終了 | POST /v2/sessions/:id/finish | completed/aborted/failed と欠測。未確定 upload と区別 |
| 本人一覧 | GET /v2/sessions | cursor と上限、本人だけ。詳細本文を混ぜない |
| 概要・artifact | GET /v2/sessions/:id / artifacts/:artifactId | 現在の認証・scope・期限に従う。MCP では aiRead も必須 |
| 削除 | DELETE /v2/sessions/:id | 即時 tombstone で参照拒否、202 と jobId。物理削除は追跡 |
| 削除状態 | GET /v2/deletions/:jobId | queued/running/completed/failed。本人のみ |

共通 error: { code, requestId, retryable }。401 未認証、403 権限不足、404 存在しない/他人の ID、409 revision/hash conflict、413 容量超過、415 MIME 不一致、422 schema 不正、429 上限。レスポンスに秘密・生 stack を含めない。

セッション status: created → recording → completed/aborted/failed。共有可否は別フィールド。削除はどの状態からでも tombstone → deleted。通信状態: queued → uploading → validating → committed / paused / rejected。サーバー accepted と R2 保存完了と全実験同期完了を UI で区別する。

## 9. MCP 取得契約

| ツール案 | 入力 | 出力と上限 |
| --- | --- | --- |
| list_diagnostic_sessions | cursor、期間、status | aiRead 可の本人実験のみ、最大 20 件 |
| get_diagnostic_summary | sessionId | 版、条件、失敗・欠測、artifact 概要。自由文字より構造化を優先 |
| get_diagnostic_frames | sessionId、fromMs、toMs、fields、cursor | 許可 fields のみ、最大 300 frames か 256 KiB で分割 |
| get_diagnostic_image | sessionId、artifactId | 認証済み取得した画像。画像出力が Work に届くか spike で確認 |
| get_diagnostic_clip_frames | sessionId、artifactId、timeRange | 許可された動画から上限付きフレーム抽出。初期最大 8 枚、抽出時刻と変換を記録 |

REQ-M01: 読み取り専用。作成・削除・共有変更・任意 URL fetch・任意 R2 key 読取を提供しない。owner は OAuth subject から決める。
REQ-M02: 動画バイナリを MCP が返せばモデルが理解できると仮定しない。直接の動画参照が実証できなければ静止フレームと同期ログで診断。抽出基盤が未用意なら、収集時に画像も作るか別作業として明示。対応していない動画解析を「完了」としない。
REQ-M03: 新しいチャットでも接続を通して取得可能にするが、常時購読・会話外の起動は保証しない。読み出したログ内の文字列は信頼できないデータとして扱う。
REQ-M04: AI へ渡した日時と範囲を本人が確認可能。共有停止は将来の読み出しを止める。すでにチャットへ渡ったコピーは R2 削除だけでは消えないと説明する。

## 10. 保存期限・削除

REQ-L01: expiresAt はサーバー時刻で計算し、期限を過ぎたデータは読み取り時に即拒否。R2 lifecycle は物理削除の補助であり秒単位の期限保証に使わない。
REQ-L02: 削除要求時は直ちに tombstone、進行中 upload の commit を拒否。索引、media、数値、派生フレーム、staging を一覧化して非同期削除し、失敗は再試行。手動復旧手順も記す。
REQ-L03: 孤立 staging は最長 24 時間で cleanup。削除失敗と容量を管理画面に表示。削除中データの復活を防ぐ。
REQ-L04: 監査は payload を含めず 30 日を初期値とする。識別可能な索引・バックアップ・基盤ログの保持範囲は実装時に確認し説明。物理消去の未確認を完了と表示しない。

## 11. TDD 受け入れ条件

各行を独立した Red → Green → Refactor の最小スライスへ分け、要件 ID、失敗コマンド・理由、成功結果を PR に残す。動作未実装による失敗と環境不備を区別する。

| ID | Given / When | Then |
| --- | --- | --- |
| AT01 | 詳細への同意なしで実験 | 詳細・media の収集/送信が発生せず基本実験は動く |
| AT02 | 保存許可あり、AI 許可なし | 保存成功。MCP 一覧・直接 ID 取得の両方で見えない |
| AT03 | 本人 A が B の session/upload/artifact ID を指定 | どの API でも情報・内容が漏れない |
| AT04 | upload 中に撤回、古い complete が遅延到着 | commit 拒否、staging cleanup。共有停止後の次回取得拒否 |
| AT05 | オフライン撤回後ネット復帰 | 撤回反映を最優先、待機 chunk が再送されない |
| AT06 | 同じ chunk を再送 | 同じ hash なら同一結果、異なる hash なら 409、二重計上なし |
| AT07 | Content-Length を省略/偽装し上限超過 | stream 中断し commit しない |
| AT08 | MIME 偽装、過深 JSON、巨大配列、NaN 相当 | validation 拒否、秘密や本文をエラーへ出さない |
| AT09 | 顔が検出できず校正開始不能 | 準備・model・推論失敗と許可済み画像を実験完了なしで送信可能 |
| AT10 | カメラ再起動/同時非同期推論 | frameId と cameraGeneration の対応が壊れず欠測を明示 |
| AT11 | 401/429/503/timeout/再読み込み | 規定の停止・再試行・上限・欠測表示。無限再送なし |
| AT12 | 数値のみ同意 | media track/recorder を診断目的で作らず画像を送らない |
| AT13 | 動画有効 | audio track がなく、clip/容量制限で停止、非対応時の降格を表示 |
| AT14 | 保存期限後、まだ物理オブジェクトが存在 | API/MCP は拒否、後続 cleanup で消去 |
| AT15 | 削除中に進行中 upload が完了 | データが再公開されず、全派生物が削除対象になる |
| AT16 | ログに命令文や任意 URL を混入 | 命令として実行せず、任意ネットワーク fetch をしない |
| AT17 | 既存 /ingest に frames を送信 | 既存拒否契約を維持。基本送信回帰成功 |
| AT18 | 実 Work からダミー概要と画像を取得 | 認証・画像表示が確認でき、失効後の取得は失敗 |
| AT19 | 実カメラで正常と失敗を各 1 回 | JSON/画像と時刻の対応、AI 読み取り、撤回・削除を通しで確認 |
| AT20 | 診断無効/数値/media の比較 | 性能測定と容量報告、初期性能ゲートの判定を記録 |

ユニット: 時計、認証、ストア、カメラ、upload の注入可能な境界。Worker 統合: 実ランタイムに近い検証、競合と stream 制限。Browser: Playwright の fake camera/network と UI。実機: ユーザーの PC・カメラ。合成テストで顔検出精度は証明しない。

## 12. 作業分割・依存と最初の手順

1. 最新 develop と作業ルール、未統合 PR を読み、現在のテスト・ビルドを実行。既存失敗は記録する。
2. docs/private-diagnostics-requirements.md に本仕様を配置する文書 PR を作る。既存 README と要件の新旧契約をリンクする。
3. S0: spike/authenticated-diagnostics-mcp。ダミーのみの認証済み list/summary/image、失効実証。方式比較を最大 2 案・各 1 回の接続検証で区切る。ユーザー操作が必要なら即連絡。
4. S1: feat/diagnostics-consent-contract。schema、consent reducer、状態遷移、AT01/02/04 の Red から。
5. S2: feat/private-diagnostics-api。認証・所有権・staging/commit・制限・監査。AT03/06/07/08/17。
6. S3: feat/detailed-diagnostics-upload。実験開始前の記録、分割・再送・停止・手動共有。AT05/09/10/11。
7. S4: feat/diagnostic-media。画像・動画・同期・負荷制御。AT12/13/20。
8. S5: feat/diagnostics-reader。製品 MCP を S0 の実証方式に接続し、許可フィルタ・段階取得。AT02/16/18。
9. S6: feat/diagnostics-retention。削除・期限・管理画面。AT14/15。
10. S7: 実機 E2E、AT19 と運用手順。レビュー後に develop → experiment の昇格 PR。本番の受け入れ実施前に実データ収集を有効化しない。

S0 と S1 のダミー開発は並行可能。S3 は S1/S2 に依存。S4 は S3 に依存。S5 は S0/S2 に依存。S6 は S2 に依存。S7 はすべてに依存。並行作業はファイル所有範囲を決め、共有 schema の変更を先に同期する。

各 PR の提出物: 要件 ID、変更理由、Red/Green の証拠、回帰結果、設定差分、公開情報のみの再現手順、未確認事項、ロールバック。リポジトリの npm run check / npm run build / npm run test:browser を変更範囲に応じて実行。文書だけの PR に形式的なテストを追加しない。

## 13. ユーザーに即時確認する条件

| 条件 | その場で尋ねる内容 | その間に進める作業 |
| --- | --- | --- |
| 独自 MCP の登録可否が分からない | 現在の Work の接続追加画面で独自 MCP URL と認証を登録できるか。必要なら画面共有/画像 | ダミー server、schema、テスト |
| 認証プロバイダ・本人 allowlist が必要 | 使うログイン方法と本人アカウントを安全な設定画面で登録してもらう | 認証 adapter と拒否系テスト |
| Cloudflare 権限不足 | 作成する資源・設定名・理由と具体的手順を提示。秘密は dashboard に入力 | local runtime と infrastructure 設定ファイル |
| 独自ドメイン/課金が必要 | 必要性、代替案、費用見込みを示して尋ねる | 無課金のローカル/ダミー検証 |
| 実機でしか再現できない | 開くページ、チェック項目、期待表示を短く指示 | fake camera の再現ケース |

既に確定した「詳細を許可付きで自動共有したい」「TDD」「develop 宛て」を聞き直さない。ユーザー依存が見つかったら直ちに質問し、依存しない作業は継続する。秘密値・顔画像を公開 Issue/PR/CI artifact に貼らせない。

## 14. 完了判定と引き継ぎ報告

完成と呼べるのは、実カメラで検出失敗を含む実験が記録され、許可された数値・画像が非公開保存され、実際の Work から添付なしで取得でき、撤回後に再取得できず、削除を追跡できた時点。動画は直接参照かフレーム化か、対応した経路を明示する。

未接続なら「実装済み・Work 接続未確認」、未実機なら「合成テスト済み・実機未確認」とする。インフラ deploy や CI 成功だけで完了と報告しない。

次エージェントの報告形式: 対象 commit/branch、実装済み要件 ID、残り ID、TDD 証拠、実機確認、ユーザーに依頼中の操作、再開コマンド。データ本体や認証情報を引き継ぎ文書へ埋め込まない。

## 15. 実装時に再確認する一次資料

以下は設計検証の入口。現在のプラン・認証互換性・上限の保証ではない。
- R2 presigned URL: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- R2 lifecycle: https://developers.cloudflare.com/r2/buckets/object-lifecycles/
- Cloudflare Access service token: https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- ChatGPT MCP: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- Apps: https://help.openai.com/en/articles/11487775-connectors-in-chatgpt

この要件文書は製品実装を変更していない。必要なセキュリティ制御と利用者の同意 UI が完成するまでは、現行公開ページに詳細データの自動送信を有効化しない。
