/**
 * The words on the furniture, in the learner's language.
 *
 * The questions are Japanese and stay Japanese — that is the exam. Everything
 * around them (buttons, labels, the app's one sentence about its plan) follows
 * the language the person chose, and before they choose, the device's.
 *
 * Two languages for now. The table is a flat map of key → [ja, en], which is
 * enough for an app this size and keeps a missing translation a type error
 * rather than a blank label. The choice is kept on the device: a language is a
 * property of the phone in your hand, not of your history.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "ja" | "en";
export const LANGS: Lang[] = ["ja", "en"];
export const LANG_NAME: Record<Lang, string> = { ja: "日本語", en: "English" };

const STORAGE_KEY = "ui_lang";

const S = {
  // shared
  back: ["戻る", "Back"],
  retry: ["もう一度読み込む", "Try again"],
  config_needed: ["設定が必要です", "Setup needed"],
  cant_connect: ["接続できません", "Can't connect"],
  cant_load: ["読み込めません", "Couldn't load"],
  loading: ["読み込み中…", "Loading…"],
  tab_home: ["ホーム", "Home"],
  tab_progress: ["記録", "Progress"],
  tab_account: ["アカウント", "Account"],
  title_practice: ["練習", "Practice"],
  title_result: ["結果", "Result"],
  title_history: ["解いた問題", "Answered"],
  sec_choukai: ["聴解", "Listening"],
  sec_choudokkai: ["聴読解", "Listening & reading"],
  sec_dokkai: ["読解", "Reading"],
  times: ["{n}回", "×{n}"],
  mark_correct: ["○ 正解", "○ Correct"],
  mark_chosen: ["× これを選びました", "× Your choice"],
  mark_wrong: ["× 不正解", "× Wrong"],
  explanation: ["解説", "Explanation"],

  // welcome — the only screen in the app that explains anything
  wel_kicker: ["ビジネス日本語ドリル", "Business Japanese drill"],
  wel_title: ["選ぶのは、こちらの仕事です", "The choosing is our job"],
  wel_lead: ["あなたの答えから、いまのレベルと弱いところを読み取って、次に出す問題を決めます。レベルも、種類も、難しさも、選ぶところはありません。", "We read your level and your weak spots out of your answers, and pick what comes next. There is no level, type or difficulty to choose."],
  wel_p1_title: ["レベルは、答えが決めます", "Your answers set the level"],
  wel_p1_body: ["自己申告はありません。解いた記録から、いまちょうどいい難しさを判断して、勝手に上げ下げします。", "Nothing to declare about yourself. The record decides what is the right difficulty right now, and moves it up or down on its own."],
  wel_p2_title: ["弱いところを、狙って出します", "It aims at your weak spots"],
  wel_p2_body: ["正誤だけでなく、どのまちがえ方をしたかまで見ます。まちがえた問題は、一晩おいてもう一度出します。", "Not just right or wrong — which way you went wrong. A question that caught you comes back after a night's sleep."],
  wel_p3_title: ["あなたがすることは、答えるだけ", "Your part is to answer"],
  wel_p3_body: ["1日5問、3分ほど。続けるほど、出る問題があなたに合っていきます。", "Five questions a day, about three minutes. The longer you keep at it, the better the questions fit you."],
  wel_google: ["Googleでログインして始める", "Sign in with Google to start"],
  wel_google_busy: ["つないでいます…", "Signing in…"],
  wel_anon: ["ログインせずに始める", "Start without signing in"],
  wel_anon_note: ["あとからログインしても、記録はそのまま引き継げます。", "Sign in later and your record carries over as it is."],
  wel_honesty: ["問題はすべて独自に作ったものです。過去問は使っていません。点数の予測は出しません。", "Every question is an original composition — no past papers. The app never predicts a score."],

  // home
  level_line: ["いまのレベル {level}・正解が続くと上がります", "Level {level} · rises as you keep answering right"],
  streak_days: ["{n}日", "{n} days"],
  today: ["今日", "Today"],
  today_done: ["今日のぶんは終わりました", "Today's set is done"],
  streak_going: ["{n}日つづいています", "{n} days in a row"],
  start_today: ["今日から始めましょう", "Start today"],
  btn_more: ["もう一組やる", "One more set"],
  btn_today: ["今日の練習をする", "Practice today"],
  btn_today_sub: ["{goal}問・約3分・レベルも弱点もおまかせ", "{goal} questions · about 3 min · level and weak spots handled for you"],
  thinking: ["アプリが考えていること", "What the app is thinking"],
  plan_first: ["まずは5問。ここから、あなたに合わせて出します。", "Five questions to start. From here on, it adapts to you."],
  plan_watching: ["まだ様子を見ています。あと{n}問で、弱点が見えてきます。", "Still watching. {n} more answers and your weak spots will show."],
  plan_weak: ["「{tag}」が弱め（{pct}%）。今日の練習に、自動で入れます。", "“{tag}” is weak ({pct}%). It goes into today's set automatically."],
  plan_trap: ["いちばん多いミスは「{label}」。同じ型の問題を、今日の練習に入れます。", "Your most common mistake is “{label}”. Today's set includes more of that pattern."],
  plan_stretch: ["いい調子です。今日は、少し上のレベルも1問入れます。", "Good pace. Today includes one question from the level above."],
  plan_good: ["いい調子です。このまま毎日つづけましょう。", "Good pace. Keep going every day."],
  anon_title: ["記録はこの端末だけ", "Your record lives on this device only"],
  anon_sub: ["ログインなしで使えています。", "You're using the app without signing in."],
  anon_btn: ["記録を引き継ぐ", "Keep my record"],

  // account
  acc_anon_sub: ["ログインなしで使えています", "Using without signing in"],
  acc_anon_title: ["記録はこの端末にだけあります", "Your record is only on this device"],
  acc_anon_p1: ["ログインしなくても使えます。ただし、いまの記録はこの端末のアプリの中にある鍵でつながっています。アプリを消したり端末を変えたりすると、戻せません。", "You can use the app without signing in. But your record is tied to a key inside this app, on this device. Delete the app or change phones and it cannot be recovered."],
  acc_anon_p2: ["Googleとつなぐと、これまでの解答も連続日数も弱点もそのまま引き継がれます。作り直しにはなりません。", "Link Google and your answers, streak and weak spots carry over as they are. Nothing is rebuilt."],
  acc_link_busy: ["つないでいます…", "Linking…"],
  acc_link: ["Googleで記録を引き継ぐ", "Keep my record with Google"],
  acc_signed_in: ["ログイン中", "Signed in"],
  acc_google: ["Googleアカウント", "Google account"],
  acc_any_device: ["記録はどの端末からでも見られます。", "Your record is available from any device."],
  acc_level: ["いまのレベル", "Current level"],
  acc_level_sub: ["アプリが決めます。選ぶところはありません。", "The app decides. There is nothing to choose."],
  acc_level_rule: ["最初は10問、そのあとは直近20問で判断します。8割正解で上がり、4割以下で少しやさしくします。毎回の練習には、1問だけ上のレベルの問題が入っています。", "Judged on your first 10 answers, then on your last 20. 80% right moves you up; 40% or less eases off. Every set includes one question from the level above."],
  acc_exam: ["試験日", "Exam date"],
  acc_exam_unset: ["まだ決めていません", "Not set yet"],
  acc_exam_hint: ["決めると、ホームにカウントダウンが出ます。", "Set it and a countdown appears on home."],
  preset_1: ["1か月後", "In 1 month"],
  preset_3: ["3か月後", "In 3 months"],
  preset_6: ["6か月後", "In 6 months"],
  clear: ["消す", "Clear"],
  acc_lang: ["言語", "Language"],
  acc_lang_sub: ["問題は日本語のままです。", "Questions stay in Japanese."],
  acc_noscore_title: ["点数の予測は出しません", "No score prediction"],
  acc_noscore_body: ["生成した問題には本番と同じ尺度がないので、「たぶん◯点」は出しません。上の「レベル」は、いま出している問題の難しさです。問題はすべて独自に作ったもので、過去問は使っていません。試験の運営とは関係ありません。", "Generated questions share no scale with the real exam, so the app never says “probably N points”. The level above is the difficulty of the questions you are being served. Every question is original; no past papers. The app is not affiliated with the exam."],
  logout: ["ログアウト", "Sign out"],

  // countdown
  countdown_past: ["試験はもう終わりました", "The exam has passed"],
  countdown_today: ["試験は今日です", "The exam is today"],
  countdown_days: ["試験まであと{n}日", "{n} days to the exam"],

  // progress
  prog_sub: ["本番の成績表と同じ、3つの分け方で", "Cut the way the real score report is: three sections"],
  prog_first: ["一組やってみると、ここに出てきます。", "Do one set and it shows up here."],
  prog_types_open: ["9種類のバランスを見る", "Show all nine types"],
  prog_types_close: ["9種類をとじる", "Hide the nine types"],
  prog_mistakes: ["よくあるミス", "Common mistakes"],
  prog_weak: ["苦手な場面", "Weak situations"],
  axis_function: ["何をする場面か", "What you're doing"],
  axis_relation: ["誰に言うか", "Who you're talking to"],
  axis_setting: ["どこでの話か", "Where"],
  axis_channel: ["どう伝わるか", "How (in person, phone…)"],
  pct_n: ["{pct}%（{n}問）", "{pct}% ({n})"],
  prog_min_tags: ["{n}問以上解いた場面だけを出しています。", "Only situations with {n}+ answers are shown."],
  prog_more: ["もう少し解くと、場面ごとの得意・不得意が出てきます。", "A few more answers and your strong and weak situations will show."],
  review: ["見返す", "Review"],
  review_btn: ["解いた問題を見返す", "Review answered questions"],
  review_sub: ["まちがえた問題と、その解説", "The ones you missed, with explanations"],
  radar_empty: ["まだ記録がありません。5問解くと形が出ます。", "No record yet. Five answers give it a shape."],
  radar_caption: ["白い丸はまだ解いていない種類です（0%ではありません）。", "A white dot is a type not tried yet (not 0%)."],
  prog_load_err: ["記録を読み込めません", "Couldn't load your record"],

  // practice
  preparing: ["問題を用意しています…", "Preparing questions…"],
  q_load_err: ["問題を読み込めません", "Couldn't load questions"],
  no_q_title: ["出せる問題がありません", "No questions to serve"],
  no_q_body: ["いまのレベルの問題をすべて解いたか、まだ問題が公開されていません。", "You've answered everything at your level, or nothing is published yet."],
  again_tag: ["もう一度", "Again"],
  you: ["あなた", "You"],
  other: ["相手", "To"],
  ch_in_person: ["対面", "In person"],
  ch_phone: ["電話", "Phone"],
  ch_video: ["オンライン", "Video call"],
  ch_written: ["文書", "Written"],
  scene_hint_listen: ["準備ができたら、聞いてください。一回だけ流れます。", "When you're ready, listen. It plays once."],
  scene_hint_read: ["準備ができたら、問題へ。", "When you're ready, go to the question."],
  btn_listen: ["聞く", "Listen"],
  btn_to_q: ["問題へ", "To the question"],
  listen_hint: ["聞き終わると、選択肢が出ます。", "The options appear when the audio ends."],
  prompt_hatsugen_choukai: ["この場面で最も適切な言い方を選んでください。", "Choose the most appropriate thing to say here."],
  prompt_hyougen: ["この場面で最も適切な表現を選んでください。", "Choose the most appropriate expression here."],
  prompt_goi_bunpou: ["空欄に入る最も適切なものを選んでください。", "Choose what best fills the blank."],
  prompt_bamen_haaku: ["聞いた内容に合うものを選んでください。", "Choose what matches what you heard."],
  prompt_sougou_choukai: ["会話の内容に合うものを選んでください。", "Choose what matches the conversation."],
  prompt_joukyou_haaku: ["掲示と依頼の両方をふまえて選んでください。", "Choose using both the notice and the request."],
  prompt_shiryou_choudokkai: ["資料と音声の両方をふまえて選んでください。", "Choose using both the document and the audio."],
  prompt_sougou_choudokkai: ["会話と資料の両方をふまえて選んでください。", "Choose using both the conversation and the documents."],
  prompt_sougou_dokkai: ["文書から読み取れることを選んでください。", "Choose what can be read from the document."],
  prompt_default: ["最も適切なものを選んでください。", "Choose the most appropriate one."],
  correct_title: ["正解です", "Correct"],
  details_open: ["解説をくわしく見る", "Show the explanation"],
  details_close: ["解説をとじる", "Hide the explanation"],
  btn_result: ["結果を見る", "See results"],
  btn_next: ["次の問題へ", "Next question"],

  // result
  no_result_title: ["結果がありません", "No result"],
  no_result_body: ["練習を始めると、ここに結果が出ます。", "Start practising and results show here."],
  to_home: ["ホームへ", "Home"],
  level_up: ["レベルが上がりました", "Level up"],
  level_up_body: ["{a} → {b}。次からは{b}の問題が出ます。", "{a} → {b}. From now on you get {b} questions."],
  level_down: ["問題を少しやさしくします", "Easing off a little"],
  level_down_body: ["次からは{b}の問題が出ます。正解が続けば、また上がります。", "From now on you get {b} questions. Keep answering right and it rises again."],
  mode_this: ["今回", "This set"],
  n_correct: ["{n}問 正解", "{n} correct"],
  n_min: ["{total}問・{min}分", "{total} questions · {min} min"],
  ring_correct: ["正解", "right"],
  top_mistake: ["今回いちばん多かったミス", "Most common mistake this set"],
  all_correct: ["全問正解です", "All correct"],
  all_correct_body: ["同じ場面でも、相手が変わると答えは変わります。明日も続けましょう。", "Same scene, different listener, different answer. Keep going tomorrow."],
  breakdown: ["この回の内訳", "This set"],
  retry_promise: ["まちがえた問題は、明日からの練習で、もう一度出します。", "The ones you missed come back in practice from tomorrow."],
  review_wrong: ["まちがえた問題を見返す", "Review the ones you missed"],

  // history
  hist_loading: ["記録を読み込んでいます…", "Loading your record…"],
  hist_empty_title: ["まだ記録がありません", "No record yet"],
  hist_empty_body: ["一組やってみると、ここに残ります。", "Do one set and it will be here."],
  hist_recent: ["直近 {n} 問", "Last {n} answers"],
  hist_wrong_n: ["まちがえたのは {n} 問", "{n} wrong"],
  hist_wrong_chip: ["まちがえた問題", "Wrong ones"],
  hist_all: ["すべて", "All"],
  hist_none_wrong: ["まちがえた問題はありません", "Nothing wrong"],
  hist_keep: ["この調子で続けましょう。", "Keep it up."],
  mistake_label: ["ミス：{label}", "Mistake: {label}"],
  tap_explain: ["タップすると解説を見られます", "Tap for the explanation"],

  // audio
  audio_pending: ["{label}（音声は準備中）", "{label} (audio coming soon)"],
  play_label: ["{label}を再生", "Play {label}"],
  dialogue_pending: ["会話（音声は準備中）", "Conversation (audio coming soon)"],
  show_text: ["本文を見る", "Show text"],
  hide_text: ["本文を隠す", "Hide text"],
  listen_dialogue: ["会話を聞く", "Play the conversation"],
  stop_dialogue: ["会話を止める", "Stop"],
  listen_again: ["もう一回聞く", "Listen again"],
  listening: ["聞いています…", "Listening…"],
  skip: ["とばして選択肢へ", "Skip to the options"],

  // meter
  rudeness: ["失礼度", "Rudeness"],
  miss: ["場面ちがい", "Off target"],
  lvl_none: ["なし", "none"],
  lvl_low: ["小", "low"],
  lvl_mid: ["中", "mid"],
  lvl_high: ["大", "high"],

  // documents
  doc_email_external: ["社外メール", "External email"],
  doc_email_thread: ["メールのやりとり", "Email thread"],
  doc_memo_notice: ["社内通知", "Internal notice"],
  doc_meeting_minutes: ["議事録", "Meeting minutes"],
  doc_schedule: ["予定表", "Schedule"],
  doc_progress_report: ["進捗報告書", "Progress report"],
  doc_quote_order: ["見積書・注文書", "Quote / order form"],
  doc_office_sign: ["掲示・案内", "Sign / notice"],

  // faces
  mood_happy: ["相手は満足しています", "They're pleased"],
  mood_puzzled: ["相手は首をかしげています", "They're puzzled"],
  mood_uneasy: ["相手は少し困っています", "They're a little uncomfortable"],
  mood_upset: ["相手は気を悪くしています", "They're offended"],
  mood_shocked: ["相手は驚いています", "They're taken aback"],
} as const satisfies Record<string, readonly [string, string]>;

export type Key = keyof typeof S;

export function tr(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  let out: string = S[key][lang === "ja" ? 0 : 1];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

/** What the phone speaks. Japanese stays the default for a Japanese phone;
 *  everything else gets English until they say otherwise. */
export function deviceLang(): Lang {
  try {
    const tag =
      (typeof navigator !== "undefined" && navigator.language) ||
      Intl.DateTimeFormat().resolvedOptions().locale ||
      "";
    return tag.toLowerCase().startsWith("ja") ? "ja" : "en";
  } catch {
    return "ja";
  }
}

type LangContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
};

const LangContext = createContext<LangContextValue>({
  lang: "ja",
  setLang: () => {},
  t: (key, vars) => tr("ja", key, vars),
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(deviceLang);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === "ja" || saved === "en") setLangState(saved);
      })
      .catch(() => {
        // No storage (private window, cleared data): the device default holds.
      });
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<LangContextValue>(
    () => ({ lang, setLang, t: (key, vars) => tr(lang, key, vars) }),
    [lang, setLang]
  );
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}
