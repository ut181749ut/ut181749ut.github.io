// 一言日記の設定。公開する前にここを書き換えます。
window.HITOKOTO_CONFIG = {
  // 「1年のまとめ」の値段（表示用）
  proPrice: "300円",

  // 決済ページのURL（例: Stripe の Payment Link）。空のままだと「準備中」と表示されます。
  // 決済が終わったら次のURLに戻すよう、決済サービス側で設定してください:
  //   https://<公開先のURL>/?unlock=<購入コード>
  paymentUrl: "",

  // 購入コードの SHA-256 ハッシュ（コードそのものはここに書かない）。
  // 新しいコードにするときは README の手順でハッシュを作り直します。
  unlockCodeSha256: "bc9295af9b9a3938b9e5b384383e526b4162f4c435bb59b96314cb9d1326633c",
};
