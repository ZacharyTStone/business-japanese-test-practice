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
  // Short forms, for the one line on home where all three appear at once.
  sec_choukai_short: ["聴解", "Listening"],
  sec_choudokkai_short: ["聴読解", "L&R"],
  sec_dokkai_short: ["読解", "Reading"],
  times: ["{n}回", "×{n}"],
  mark_correct: ["○ 正解", "○ Correct"],
  mark_chosen: ["× これを選びました", "× Your choice"],
  mark_wrong: ["× 不正解", "× Wrong"],
  explanation: ["解説", "Explanation"],

  // welcome — the only screen in the app that explains anything
  wel_kicker: ["ビジネス日本語ドリル", "Business Japanese drill"],
  wel_title: ["選ぶのは、こちらの仕事です", "The choosing is our job"],
  wel_lead: ["あなたの答えから、いまのレベルと弱いところを読み取って、次に出す問題を決めます。レベルも、種類も、難しさも、選ぶところはありません。", "We read your level and your weak spots out of your answers, and pick what comes next. There is no level, type or difficulty to choose."],
  wel_p1_title: ["レベルは、分野ごとに答えが決めます", "Your answers set the level, section by section"],
  wel_p1_body: ["自己申告はありません。聴解・聴読解・読解を別々に見て、得意な分野はどんどん難しく、苦手な分野はやさしくします。読むのは得意だけれど聞き取りは苦手、という人がほとんどだからです。", "Nothing to declare about yourself. Listening, listening-and-reading and reading are judged separately: what you are good at gets harder, what you struggle with gets gentler. Almost everybody reads better than they listen."],
  wel_p2_title: ["弱いところを、狙って出します", "It aims at your weak spots"],
  wel_p2_body: ["正誤だけでなく、どのまちがえ方をしたかまで見ます。まちがえた問題は一晩おいて、できた問題も三日後・一週間後と間をあけて、もう一度出します。", "Not just right or wrong — which way you went wrong. A question that caught you comes back after a night's sleep; one you got right comes back in three days, then a week, then longer."],
  wel_p3_title: ["あなたがすることは、答えるだけ", "Your part is to answer"],
  wel_p3_body: ["1日10問、6分ほど。読解の問題には本番と同じだけの時間をはかります（設定で外せます）。続けるほど、出る問題があなたに合っていきます。", "Ten questions a day, about six minutes. Reading questions are timed at exam pace — you can turn that off in settings. The longer you keep at it, the better the questions fit you."],
  wel_start: ["始める", "Get started"],
  wel_testers_note: ["いまはテスト中です。登録されたメールアドレスでのみ使えます。", "The app is in testing and opens only to registered email addresses."],
  wel_honesty: ["問題はすべて独自に作ったものです。過去問は使っていません。点数の予測は出しません。", "Every question is an original composition — no past papers. The app never predicts a score."],

  // home
  level_line: ["いまのレベル {level}", "Level {level}"],
  level_split: ["分野ごとのレベル：{levels}", "By section: {levels}"],
  streak_days: ["{n}日", "{n} day|{n} days"],
  today: ["今日", "Today"],
  goal_ring: ["今日の目標{goal}問のうち{done}問", "{done} of today's {goal} questions"],
  today_done: ["今日のぶんは終わりました", "Today's set is done"],
  streak_going: ["{n}日つづいています", "{n} day in a row|{n} days in a row"],
  start_today: ["今日から始めましょう", "Start today"],
  btn_more: ["もう一組やる", "One more set"],
  btn_more_sub: ["あと{n}問", "{n} more question|{n} more questions"],
  btn_today: ["今日の練習をする", "Practice today"],
  btn_today_sub: ["{n}問・約{min}分", "{n} questions · about {min} min"],
  // The full stop. Shown once the day's ceiling is reached; nothing on it
  // leads to a question.
  day_done_title: ["今日のぶんは終わりました 🙂", "That's today done 🙂"],
  day_done_body: ["{n}問、おつかれさまでした。", "{n} questions. Nicely done."],
  day_done_next: ["次の問題は、明日の0時から出ます", "New questions from midnight"],

  // the door, while the app is in testing
  gate_title: ["ログインしてください", "Sign in to continue"],
  gate_body: ["いまはテスト中のため、登録されたメールアドレスでのみ使えます。", "The app is in testing and opens only to registered email addresses."],
  gate_email: ["メールアドレス", "Email"],
  gate_password: ["パスワード", "Password"],
  gate_password_hint: ["パスワードは6文字以上。登録済みのメールアドレスであれば、初めての方は「アカウントを作る」を押してください。", "Password of at least 6 characters. If your address is already registered, press “Create account” the first time."],
  gate_sign_in: ["ログイン", "Sign in"],
  gate_create: ["アカウントを作る", "Create account"],
  gate_busy: ["確認しています…", "Checking…"],
  gate_check_email: ["確認メールを送りました。メールのリンクを開いてから、もう一度ログインしてください。", "We sent a confirmation email. Open the link in it, then sign in again."],
  closed_title: ["まだ公開していません", "Not open yet"],
  closed_body: ["{email} はテスト参加者に登録されていません。別のアカウントで入る場合は、いったんログアウトしてください。", "{email} is not on the tester list. To use another account, sign out first."],

  // account
  acc_signed_in: ["ログイン中", "Signed in"],
  acc_google: ["Googleアカウント", "Google account"],
  acc_level: ["分野ごとのレベル", "Level by section"],
  acc_exam: ["試験日", "Exam date"],
  acc_exam_unset: ["まだ決めていません", "Not set yet"],
  acc_exam_placeholder: ["2026-12-01", "2026-12-01"],
  clear: ["消す", "Clear"],
  acc_lang: ["言語", "Language"],
  acc_lang_sub: ["問題は日本語のままです。", "Questions stay in Japanese."],
  // the one setting about how you practise, rather than about what you are served
  acc_timer: ["読解の制限時間", "Reading clock"],
  acc_timer_on: ["本番と同じペース", "Exam pace"],
  acc_timer_off: ["時間をはからない", "No clock"],
  acc_timer_sub: ["読解の問題だけです。聴解・聴読解は音声が進み方を決めるので、時計は出ません。", "Reading questions only. In listening the audio sets the pace, so there is no clock."],
  acc_timer_body: ["本番の読解は自分で時間を配ります。1問ずつ、本番と同じだけの時間をはかり、切れたら不正解として次へ進みます。", "The real reading section is self-paced. This gives each question the time the exam allows; when it runs out the question is marked wrong and you move on."],
  acc_noscore_title: ["点数の予測は出しません", "No score prediction"],
  acc_noscore_body: ["生成した問題には本番と同じ尺度がないので、「たぶん◯点」は出しません。上の「レベル」は、いま出している問題の難しさです。問題はすべて独自に作ったもので、過去問は使っていません。試験の運営とは関係ありません。", "Generated questions share no scale with the real exam, so the app never says “probably N points”. The level above is the difficulty of the questions you are being served. Every question is original; no past papers. The app is not affiliated with the exam."],
  logout: ["ログアウト", "Sign out"],
  // Starting again. Worded as what it costs rather than as what it offers: the
  // press is easy and the history is not coming back.
  acc_reset: ["記録を消してやり直す", "Start again"],
  acc_reset_body: [
    "解いた記録・復習の予定・三つのレベルを全部消して、はじめて使うときと同じ状態にします。",
    "Erases every answer, the review schedule and the three levels, and puts the app back to how it was on the first day.",
  ],
  acc_reset_keeps: [
    "試験日・1日の目標・言語・読解の制限時間はそのままです。",
    "Your exam date, daily goal, language and reading clock stay as they are.",
  ],
  acc_reset_confirm: ["本当に消しますか。元には戻せません。", "Really erase it? This cannot be undone."],
  acc_reset_do: ["消す", "Erase it"],
  acc_reset_busy: ["消しています…", "Erasing…"],
  acc_reset_done: ["{n}問の記録を消しました。", "{n} answer erased.|{n} answers erased."],
  cancel: ["やめる", "Cancel"],

  // countdown
  countdown_past: ["試験はもう終わりました", "The exam has passed"],
  countdown_today: ["試験は今日です", "The exam is today"],
  countdown_days: ["試験まであと{n}日", "{n} day to the exam|{n} days to the exam"],

  // progress
  prog_first: ["一組やってみると、ここに出てきます。", "Do one set and it shows up here."],
  prog_mistakes: ["よくあるミス", "Common mistakes"],
  prog_weak: ["苦手な場面", "Weak situations"],
  // On the two "what to work on" cards, and only when they are showing the
  // queue's window rather than the whole record.
  prog_recent: ["この30日", "Last 30 days"],
  axis_function: ["何をする場面か", "What you're doing"],
  axis_relation: ["誰に言うか", "Who you're talking to"],
  axis_setting: ["どこでの話か", "Where"],
  axis_channel: ["どう伝わるか", "How (in person, phone…)"],
  pct_n: ["{pct}%（{n}問）", "{pct}% ({n})"],
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
  q_of_n: ["{n}問中{i}問目", "Question {i} of {n}"],
  key_hint_answer: ["キーボードの 1〜4 でも選べます", "You can also press 1–4"],
  key_hint_next: ["Enter で次へ", "Press Enter for the next question"],
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
  prompt_gazou_haaku: ["絵に合う説明を選んでください。", "Choose the description that matches the picture."],
  prompt_sougou_choukai: ["会話の内容に合うものを選んでください。", "Choose what matches the conversation."],
  prompt_joukyou_haaku: ["掲示と依頼の両方をふまえて選んでください。", "Choose using both the notice and the request."],
  prompt_shiryou_choudokkai: ["資料と音声の両方をふまえて選んでください。", "Choose using both the document and the audio."],
  prompt_sougou_choudokkai: ["会話と資料の両方をふまえて選んでください。", "Choose using both the conversation and the documents."],
  prompt_sougou_dokkai: ["文書から読み取れることを選んでください。", "Choose what can be read from the document."],
  prompt_default: ["最も適切なものを選んでください。", "Choose the most appropriate one."],
  correct_title: ["正解です", "Correct"],
  // the clock, on the reading questions
  time_left: ["残り{time}", "{time} left"],
  time_up: ["時間切れです", "Time's up"],
  time_up_sub: ["本番と同じ時間配分では、ここで次へ進みます。", "At exam pace this is where you move on."],
  timer_hint: ["この問題の目安は{sec}秒です。", "About {sec} seconds for this one."],
  details_open: ["解説をくわしく見る", "Show the explanation"],
  details_close: ["解説をとじる", "Hide the explanation"],
  btn_result: ["結果を見る", "See results"],
  btn_next: ["次の問題へ", "Next question"],

  // reporting a question — on every question, under the explanation
  report_open: ["この問題はおかしいと思う", "Something's wrong with this question"],
  report_close: ["閉じる", "Close"],
  report_title: ["どこがおかしいですか", "What's wrong with it?"],
  report_unnatural: ["日本語が不自然", "Unnatural Japanese"],
  report_wrong_answer: ["正解がちがう", "The answer is wrong"],
  report_ambiguous: ["答えが二つある", "Two answers work"],
  report_unclear: ["問題の意味がわからない", "The question is unclear"],
  report_audio: ["音声がおかしい", "The audio is wrong"],
  report_other: ["その他", "Something else"],
  report_note: ["よければ、ひとこと（任意）", "A line about it, if you like (optional)"],
  report_send: ["送る", "Send"],
  report_sending: ["送っています…", "Sending…"],
  report_thanks: ["ありがとうございます。確認します。", "Thank you — we'll look at it."],
  report_failed: ["送れませんでした。あとでもう一度お試しください。", "Couldn't send that. Please try again later."],

  // result
  no_result_title: ["結果がありません", "No result"],
  no_result_body: ["練習を始めると、ここに結果が出ます。", "Start practising and results show here."],
  to_home: ["ホームへ", "Home"],
  level_up_sec: ["{section}のレベルが上がりました", "{section}: level up"],
  level_up_sec_body: ["{a} → {b}。ここから{section}は難しくなります。", "{a} → {b}. {section} gets harder from now on."],
  level_down_sec: ["{section}を少しやさしくします", "{section}: easing off"],
  level_down_sec_body: ["次から{section}は{b}の問題にします。正解が続けば、また上がります。", "From now on {section} comes at {b}. Keep answering right and it rises again."],
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
  play_option: ["{letter}をもう一回聞く", "Play {letter} again"],
  option_spoken: ["{letter}（音声）", "{letter} (spoken)"],
  show_options_text: ["選択肢を文字で見る", "Show the options as text"],
  hide_options_text: ["選択肢の文字を隠す", "Hide the text"],

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

/**
 * A string, in the chosen language, with `{name}` filled in.
 *
 * English counts and Japanese does not, so a string may carry two forms
 * separated by a pipe — `"{n} day|{n} days"` — and `n` picks between them.
 * Japanese sides never need it and never have it; a string with no pipe is
 * used as written, which is nearly all of them.
 */
export function tr(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  let out: string = S[key][lang === "ja" ? 0 : 1];
  if (out.includes("|")) {
    const [one, many] = out.split("|");
    out = Number(vars?.n) === 1 ? one : many;
  }
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
