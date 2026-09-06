# 同梱する推定資産

- 検出器: `@mediapipe/tasks-vision` 0.10.32。npm の完全な版と integrity は package-lock.json に固定。
- WASM: 上記パッケージの SIMD / 非 SIMD の JS・WASM。ビルド前に public/wasm へコピーし、dist に含める。
- 顔モデル: MediaPipe Face Landmarker float16、モデル版 1。
- 取得元: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
- SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`

scripts/prepare-assets.mjs がビルド時に取得・照合する。実行時はアプリと同じ公開元の資産を使い、可変 CDN や外部推論 API を利用しない。モデルや WASM のバイナリはソース PR に直接追加せず、検証済みの配布物へ含める。

顔ランドマークの検出と画面上の視線推定は別の処理である。虹彩の目に対する相対座標と顔の位置・向き・大きさの 12 特徴から、本人の校正で画面座標の回帰を学習する。画像モデル全体の学習ではない。

由来と API: [Google の Web 実装ガイド](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)、[Face Landmarker モデル一覧](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker#models)。配布の利用条件は取得元およびパッケージの Apache-2.0 表記に従う。プロジェクト全体の独自ライセンス選定とは分けて扱う。
