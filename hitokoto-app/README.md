# 一言日記（Android アプリ）

Web版の `hitokoto/` を Capacitor で包んで、Android アプリにします。
パソコンに Android Studio を入れなくても、GitHub Actions でビルドできます（ヒトテマと同じ仕組み）。

## ビルドのしかた

1. GitHub のこのリポジトリで **Actions** → **一言日記 Android アプリをビルド** → **Run workflow** を押す
2. 10分ほど待つと、実行結果の下の **Artifacts** にファイルができる
   - `hitokoto-try-…`：お試し用 APK。スマホに直接入れて試せる
   - `hitokoto-play-…`：Google Play に上げる AAB（署名鍵を登録したときだけ）

## Google Play 用の署名鍵

リポジトリの **Settings → Secrets and variables → Actions** に、次の4つを登録します。
ヒトテマで使っている鍵と同じ値でもかまいません。

| 名前 | 中身 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 署名鍵ファイル（.keystore）を base64 にしたもの |
| `ANDROID_KEY_ALIAS` | 鍵の別名 |
| `ANDROID_KEY_PASSWORD` | 鍵のパスワード |
| `ANDROID_STORE_PASSWORD` | 鍵ファイルのパスワード |

## アプリ版とWeb版のちがい

- 「1年のまとめ」の購入は、アプリ版では **近日公開** と表示します。Google Play のアプリでは、外部の決済（Stripe など）に案内できないためです。Google Play の課金を入れたら開放します。
- 画像の保存は、共有メニュー（写真に保存・LINE など）から行います。PDF 保存はアプリ版にはありません。

## ファイル

| ファイル | 中身 |
|---|---|
| `capacitor.config.json` | アプリID（`io.github.ut181749ut.hitokoto`）と名前 |
| `package.json` | Capacitor と、保存・共有のプラグイン |
| `android-res/` | アイコン（`play-store-icon-512.png` は Play ストアの掲載用） |
| `scripts/android-setup.mjs` | アプリ名・アイコン・バージョンを Android プロジェクトに反映 |

アプリIDは Google Play に一度出したら変えられません。
