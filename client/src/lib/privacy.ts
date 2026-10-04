/**
 * The privacy policy, as data: what app/privacy.tsx shows at /privacy, in
 * both languages. It is the public page the app stores and Google's consent
 * screen link to, so it says only what the code does — every line here is a
 * claim a reader can hold the repository to:
 *
 *   - the Google address, and nothing else of the Google account
 *     (worker/auth.ts drops the name, the photo and Google's tokens);
 *   - the answers and what grows from them (worker/core/), the notes and
 *     reports a learner writes, the settings;
 *   - no IP address or browser kept with a session (worker/auth.ts);
 *   - no analytics, no advertising, nothing sent to an AI service at practice
 *     time (questions and voices are made in advance);
 *   - deletion: the account screen (worker/core/profile.ts, deleteAccount).
 *
 * A change to what the app keeps is a change here, and `UPDATED` with it.
 * The operator's name and contact address are the owner's to fill in before
 * the page is published (blockers.md #5).
 */
import type { Lang } from "./i18n";

export const PRIVACY_UPDATED = "2026-10-03";

/** Who runs the app, and where to write. Empty until the owner fills them in. */
export const PRIVACY_OPERATOR = "";
export const PRIVACY_CONTACT = "";

export type PrivacySection = { title: string; paragraphs: string[] };

type Bilingual = { title: [string, string]; paragraphs: [string[], string[]] };

const SECTIONS: Bilingual[] = [
  {
    title: ["このポリシーについて", "About this policy"],
    paragraphs: [
      [
        "「Horenso」（以下「本アプリ」）が、どの情報を、何のために、どのように扱うかを説明します。本アプリはウェブ版とAndroid版があり、どちらも同じ方法で情報を扱います。",
      ],
      [
        "This explains what information Horenso (“the app”) handles, why, and how. The app runs on the web and on Android, and both handle information the same way.",
      ],
    ],
  },
  {
    title: ["集める情報", "What we collect"],
    paragraphs: [
      [
        "ログインに使うGoogleアカウントのメールアドレス。Googleアカウントの名前・写真・Googleが発行するトークンは保存しません。",
        "解答の記録：どの問題に、どの選択肢を選び、正解だったか、かかった時間、音声を聞き直したか・選択肢を文字で表示したか、解いた日時。そこから計算する復習の予定と三つのレベル。",
        "ご自身で入力したもの：試験日・1日の目標・読解の制限時間の設定、問題へのメモ、問題についての報告（理由と任意のコメント）。",
        "ログイン状態を保つための情報（セッション）。IPアドレスやブラウザの種類はセッションと一緒に保存しません。ログインの連続した試行を防ぐため、IPアドレスごとの回数を1分間だけメモリ上で数えますが、保存はしません。",
        "広告なしで使える権利が付与された場合は、その記録。",
        "端末の中だけに保存するもの：表示言語、最初の説明を見たかどうか、送信前の解答、Android版ではログイン用のトークン（端末の暗号化された保管領域に保存）。",
      ],
      [
        "The email address of the Google account you sign in with. We do not keep the account’s name, photo, or any token Google issues.",
        "Your answers: which question, which option you chose, whether it was right, how long it took, whether you replayed the audio or showed the spoken options as text, and when. The review schedule and the three levels the app works out from them.",
        "What you enter yourself: your exam date, daily goal and reading-clock setting, notes on questions, and reports about questions (a reason and an optional comment).",
        "What keeps you signed in (a session). No IP address or browser details are kept with it. To stop repeated sign-in attempts, requests are counted per IP address for one minute, in memory, and never written down.",
        "If your account is given the ad-free option, the record of that.",
        "Kept only on your device: your display language, whether you have seen the introduction, answers not yet sent, and on Android your sign-in token (in the device’s encrypted storage).",
      ],
    ],
  },
  {
    title: ["使う目的", "Why"],
    paragraphs: [
      [
        "本アプリの提供のためだけに使います。次に出す問題を選ぶこと、復習の予定を立てること、記録を表示すること、ログイン状態を保つこと、テスト参加者だけが使えるようにすること、報告された問題を直すこと。",
        "全員の最初の解答を問題ごとに数えた集計（8人以上のときだけ使い、誰の解答かは分かりません）を、問題の出し方の調整に使います。",
      ],
      [
        "Only to run the app: choosing the next questions, scheduling reviews, showing your record, keeping you signed in, letting in only the people on the tester list, and fixing questions people report.",
        "Per-question counts of everybody’s first answers (used only over eight or more people, and not linked to anyone) tune which questions are served.",
      ],
    ],
  },
  {
    title: ["使わないこと", "What we do not do"],
    paragraphs: [
      [
        "広告・アクセス解析・行動の追跡は行いません。情報を販売しません。",
        "練習中にあなたの情報をAIサービスに送ることはありません。問題と音声はAIを使ってあらかじめ作っておいたもので、あなたの解答を使って作るものではありません。",
      ],
      [
        "No advertising, no analytics, no tracking. We do not sell information.",
        "Nothing about you is sent to an AI service while you practise. Questions and voices are made with AI in advance, not from your answers.",
      ],
    ],
  },
  {
    title: ["外部のサービス", "Services we rely on"],
    paragraphs: [
      [
        "次の事業者のサービスを使っており、その範囲で情報が扱われます。いずれも米国の事業者で、情報は日本国外で処理されることがあります。",
        "Cloudflare, Inc.：本アプリの配信・データベース・音声と画像の保管。通信の処理のためにIPアドレスなどを扱います。",
        "Google LLC：Googleアカウントでのログイン。",
        "これら以外の第三者に、法令に基づく場合を除いて、あなたの情報を提供することはありません。",
      ],
      [
        "The app runs on the following services, which handle information to that extent. Both are US companies, and information may be processed outside your country.",
        "Cloudflare, Inc.: serving the app, the database, and storing the audio and pictures. It handles IP addresses and similar data to deliver each request.",
        "Google LLC: signing in with a Google account.",
        "We give your information to no one else, except where the law requires it.",
      ],
    ],
  },
  {
    title: ["保存期間と削除", "How long, and deleting it"],
    paragraphs: [
      [
        "アカウントを削除するまで保存します。アカウント画面の「アカウントを削除」で、アカウントと上に書いた情報をすべて、すぐに削除できます（元には戻せません）。「記録を消してやり直す」では解答の記録だけを消せます。",
        "ウェブ版でも同じ画面から削除できます。アプリを使えない場合は、下の連絡先にメールでご依頼ください。",
        "削除した情報は、データベースの自動バックアップに最大30日残ることがあり、その後消えます。テスト参加者の名簿にあるメールアドレスは、運営者が参加者を管理するために残ります。",
      ],
      [
        "Until you delete your account. “Delete account” on the account screen deletes the account and everything listed above, at once and for good. “Start again” deletes only your answers.",
        "The web version has the same screen. If you cannot use the app, ask by email at the address below.",
        "Deleted information may remain in the database’s automatic backups for up to 30 days, then goes. An address on the tester list stays there, as the operator’s list of who may use the app.",
      ],
    ],
  },
  {
    title: ["子どもの利用", "Children"],
    paragraphs: [
      ["本アプリはビジネス日本語の試験を受ける大人向けで、16歳未満の方を対象にしていません。"],
      ["The app is for adults preparing for a business Japanese exam, and is not directed at anyone under 16."],
    ],
  },
  {
    title: ["変更", "Changes"],
    paragraphs: [
      ["このポリシーを変えるときは、このページを更新し、下の日付を変えます。"],
      ["When this policy changes, this page is updated and the date below changes with it."],
    ],
  },
];

/** The policy in one language. */
export function privacySections(lang: Lang): PrivacySection[] {
  const i = lang === "ja" ? 0 : 1;
  return SECTIONS.map((s) => ({ title: s.title[i], paragraphs: s.paragraphs[i] }));
}

/** The closing lines: who runs the app, where to write, and the date. */
export function privacyFooter(lang: Lang): string[] {
  const pending = lang === "ja" ? "（準備中）" : "(to be added)";
  return lang === "ja"
    ? [`運営者：${PRIVACY_OPERATOR || pending}`, `連絡先：${PRIVACY_CONTACT || pending}`, `最終更新日：${PRIVACY_UPDATED}`]
    : [`Operator: ${PRIVACY_OPERATOR || pending}`, `Contact: ${PRIVACY_CONTACT || pending}`, `Last updated: ${PRIVACY_UPDATED}`];
}
