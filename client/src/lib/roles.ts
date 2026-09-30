/**
 * What each wrong answer means, in the learner's terms.
 *
 * The database records a role like `wrong_uchi_soto`; that is our vocabulary,
 * not theirs. This file turns it into a sentence and a severity.
 *
 * The severity is the 失礼度メーター. It is worth being careful about, because
 * the two axes a beginner conflates are exactly the two this separates:
 *
 *   rudeness  — how badly this lands on the person you said it to
 *   miss      — how far it is from doing what the situation needed
 *
 * 「お召し上がりになられてください」 is barely rude at all and still wrong;
 * 「まだですか」 is grammatically fine and lands like a slap. A single "wrong"
 * score would flatten that distinction, and the distinction is the thing being
 * taught.
 *
 * Half the roles are not about manners at all. The comprehension types — 場面把握,
 * 総合聴解, all of 聴読解 and 総合読解, 50 of the exam's 80 questions — go wrong
 * by misreading: the row next to the right one, the value before it was changed
 * aloud, the word that appears in the passage with a different referent. Those
 * have no rudeness to measure, so they are marked `manner: false` and the meter
 * steps aside for the advice.
 *
 * The table is typed over DISTRACTOR_ROLES, which `python -m bjt.client_constants`
 * generates from bjt/fidelity/roles.py: a role added there and not described
 * here is a type error.
 */
import { type DistractorRole } from "./generated";
import type { Lang } from "./i18n";

type RoleInfo = {
  label: string;
  /** 0–3. How much damage this does to the relationship. */
  rudeness: number;
  /** 0–3. How far it is from what the situation actually asked for. */
  miss: number;
  /** Whether the 失礼度メーター means anything here: true where the question is
   *  about how words land on a listener, false where it is about reading or
   *  hearing correctly. */
  manner: boolean;
  /** One line of advice, shown under the meter. */
  advice: string;
  /** The one sentence said first after a wrong answer. In Japanese 「相手」 is
   *  replaced with who they were talking to, when the item says; see
   *  `verdictFor` for English. */
  verdict: string;
};

type Words = { label: string; advice: string; verdict: string };

type Entry = {
  rudeness: number;
  miss: number;
  /** Defaults to true: a role is about manners unless it says otherwise. */
  manner?: boolean;
  ja: Words;
  en: Words;
};

// Every verdict is written out: a label followed by でした is grammatical only
// when the label ends in a noun, and 「品詞が合わないでした」 is not Japanese.
const DEFAULT: Entry = {
  rudeness: 1,
  miss: 2,
  ja: {
    label: "この場面に合わない",
    advice: "場面と相手をもう一度確かめましょう。",
    verdict: "この場面には合いませんでした",
  },
  en: {
    label: "Doesn't fit the scene",
    advice: "Check the situation and the listener again.",
    verdict: "It didn't fit the scene",
  },
};

/** The two roles no option carries. */
type RecordedRole = "correct" | "timed_out";

const ROLES: Record<DistractorRole | RecordedRole, Entry> = {
  correct: {
    rudeness: 0,
    miss: 0,
    ja: { label: "正解", advice: "", verdict: "正解です" },
    en: { label: "Correct", advice: "", verdict: "Correct" },
  },

  // Not a distractor role at all: the database writes it when the question
  // clock ran out with nothing chosen (chosen_index = -1). It is here because
  // every screen that reads a wrong answer's role reaches through roleInfo,
  // and a timeout would otherwise print the generic "doesn't fit the scene",
  // which is a sentence about the Japanese when the fact is about the clock.
  // Both meters read zero: nobody was offended and nothing was misread.
  timed_out: {
    rudeness: 0,
    miss: 0,
    manner: false,
    ja: {
      label: "時間切れ",
      advice: "本番の読解は自分で時間を配ります。長い問題は先に全体を見て、迷ったら決めて進みましょう。",
      verdict: "時間内に答えられませんでした",
    },
    en: {
      label: "Ran out of time",
      advice:
        "The reading section is self-paced: skim the whole thing first, decide, and move on.",
      verdict: "Time ran out before you answered",
    },
  },

  // 画像把握: the picture is the question, so a miss is about looking, never
  // about manners. Nobody was offended; something in the drawing was not seen.
  different_action: {
    rudeness: 0,
    miss: 3,
    manner: false,
    ja: {
      label: "動作がちがう",
      advice: "手に何を持っているか、体がどちらを向いているかを先に見ましょう。",
      verdict: "絵の中の人は、それをしていませんでした",
    },
    en: {
      label: "A different action",
      advice: "Look first at what is in the hands and which way the body is turned.",
      verdict: "That is not what the person in the picture is doing",
    },
  },
  wrong_participants: {
    rudeness: 0,
    miss: 2,
    manner: false,
    ja: {
      label: "人がちがう",
      advice: "「誰が」「誰に」を絵で確かめましょう。動作は合っていても、向きが逆のことがあります。",
      verdict: "動作は合っていましたが、している人がちがいました",
    },
    en: {
      label: "Wrong person",
      advice: "Check who is doing it to whom in the picture. The action can be right and the direction reversed.",
      verdict: "Right action, wrong person doing it",
    },
  },

  // 場面把握 and 画像把握 share these two: the situation, misplaced.
  adjacent_setting: {
    rudeness: 0,
    miss: 2,
    manner: false,
    ja: {
      label: "となりの場面",
      advice: "似た場所と取り違えています。場所を決める一言（受付・応接室など）を聞き取りましょう。",
      verdict: "近いけれど、別の場面でした",
    },
    en: {
      label: "A neighbouring setting",
      advice: "Listen for the one word that fixes the place: reception, meeting room, and so on.",
      verdict: "Close, but a different setting",
    },
  },
  right_scene_wrong_moment: {
    rudeness: 0,
    miss: 2,
    manner: false,
    ja: {
      label: "場面の段階がちがう",
      advice: "場面は合っています。今がその流れのどの時点か（始まり・途中・終わり）を確かめましょう。",
      verdict: "場面は合っていましたが、時点がちがいました",
    },
    en: {
      label: "Right scene, wrong moment",
      advice: "The situation is right. Check which stage of it this is: the start, the middle or the end.",
      verdict: "Right situation, wrong point in it",
    },
  },
  wrong_participant: {
    rudeness: 0,
    miss: 2,
    manner: false,
    ja: {
      label: "別の人のこと",
      advice: "質問が誰について聞いているかを先に押さえ、その人の言葉と動きだけを追いましょう。",
      verdict: "その場にいた、別の人のことでした",
    },
    en: {
      label: "Someone else in the scene",
      advice: "Pin down who the question asks about first, then follow only that person.",
      verdict: "That was someone else in the scene",
    },
  },
  plausible_but_unmentioned: {
    rudeness: 0,
    miss: 2,
    manner: false,
    ja: {
      label: "言っていないこと",
      advice: "ありそうな内容でも、音声で言っていなければ答えにはなりません。聞いたことだけで選びましょう。",
      verdict: "ありそうですが、話には出てきませんでした",
    },
    en: {
      label: "Plausible, never said",
      advice: "However likely it sounds, if it was not said it cannot be the answer.",
      verdict: "Plausible, but nobody said it",
    },
  },

  // 総合聴解 and 総合聴読解: who said what, and what was said last.
  stated_by_wrong_speaker: {
    rudeness: 0,
    miss: 2,
    manner: false,
    ja: {
      label: "話した人がちがう",
      advice: "内容は会話に出てきましたが、言ったのは別の人です。誰の発言かに注意して聞きましょう。",
      verdict: "会話には出ましたが、言ったのは別の人でした",
    },
    en: {
      label: "Said by someone else",
      advice: "It was said, but by the other speaker. Keep track of who says what.",
      verdict: "Said in the conversation, but by the other person",
    },
  },
  superseded_by_later_turn: {
    rudeness: 0,
    miss: 3,
    manner: false,
    ja: {
      label: "あとで変わった話",
      advice: "会話の途中で予定や結論が変わっています。最後に決まったことを聞き取りましょう。",
      verdict: "最初はそうでしたが、あとで変わりました",
    },
    en: {
      label: "Changed later on",
      advice: "The plan changed partway through. Listen for what was settled at the end.",
      verdict: "True at first, changed later",
    },
  },
  unsupported_but_plausible: {
    rudeness: 0,
    miss: 2,
    manner: false,
    ja: {
      label: "根拠がない",
      advice: "一般的には正しくても、資料や会話の中に根拠がなければ答えになりません。",
      verdict: "もっともらしいですが、根拠がありませんでした",
    },
    en: {
      label: "Plausible, but unsupported",
      advice: "True in general is not enough: the answer has to be supported by what you read or heard.",
      verdict: "Plausible, but nothing supports it",
    },
  },
  surface_keyword_match: {
    rudeness: 0,
    miss: 3,
    manner: false,
    ja: {
      label: "同じ言葉につられた",
      advice: "同じ言葉が入っていても、指している内容がちがいます。言葉ではなく中身で選びましょう。",
      verdict: "同じ言葉が出てきましたが、指している内容がちがいました",
    },
    en: {
      label: "Fooled by a shared word",
      advice: "The same word appears, but it refers to something else. Match the meaning, not the word.",
      verdict: "Same word, different thing",
    },
  },

  // 状況把握: the document and the request have to be read together.
  ignores_the_document: {
    rudeness: 0,
    miss: 3,
    manner: false,
    ja: {
      label: "資料を見ていない",
      advice: "頼まれたことには合っていますが、掲示や資料の内容と合いません。資料の条件と照らし合わせましょう。",
      verdict: "頼まれたことには合っていますが、資料と合いませんでした",
    },
    en: {
      label: "Ignored the document",
      advice: "It answers the request but clashes with what is posted. Check it against the document.",
      verdict: "Fits the request, contradicts the document",
    },
  },
  ignores_the_request: {
    rudeness: 0,
    miss: 3,
    manner: false,
    ja: {
      label: "頼まれたことと違う",
      advice: "資料どおりの行動ですが、相手が頼んだことではありません。音声で何を頼まれたかを確かめましょう。",
      verdict: "資料には合っていますが、頼まれたことではありませんでした",
    },
    en: {
      label: "Not what was asked",
      advice: "It follows the document, but not the request. Check what you were actually asked to do.",
      verdict: "Fits the document, not the request",
    },
  },
  wrong_action_owner: {
    rudeness: 0,
    miss: 2,
    manner: false,
    ja: {
      label: "する人がちがう",
      advice: "行動は合っていますが、それをするのは別の人です。「誰が」するのかを確かめましょう。",
      verdict: "することは合っていましたが、するのは別の人でした",
    },
    en: {
      label: "Wrong person to do it",
      advice: "The action is right; someone else is supposed to do it.",
      verdict: "Right action, wrong person to do it",
    },
  },
  right_action_wrong_condition: {
    rudeness: 0,
    miss: 2,
    manner: false,
    ja: {
      label: "条件が合わない",
      advice: "その行動は、ある条件のときだけです。今の状況がその条件に当てはまるかを確かめましょう。",
      verdict: "その行動の条件に、今の状況は当てはまりませんでした",
    },
    en: {
      label: "Condition doesn't apply",
      advice: "That action only applies under a condition this situation does not meet.",
      verdict: "Right action, but its condition doesn't hold here",
    },
  },

  // 資料聴読解: a figure read off the page, as changed by what is heard.
  reads_wrong_row: {
    rudeness: 0,
    miss: 2,
    manner: false,
    ja: {
      label: "読む行がずれた",
      advice: "表のとなりの行や列を読んでいます。聞いた条件で、行と列を指でたどりましょう。",
      verdict: "表の、となりの行を読んでいました",
    },
    en: {
      label: "Read the wrong row",
      advice: "You read a neighbouring row or column. Trace the row and column from what you heard.",
      verdict: "That was the row next to it",
    },
  },
  ignores_the_spoken_change: {
    rudeness: 0,
    miss: 3,
    manner: false,
    ja: {
      label: "変更を聞き落とした",
      advice: "資料の内容は、音声で変更されています。資料よりも、あとから言われたことが優先です。",
      verdict: "資料のままの内容で、話で変わった点が入っていませんでした",
    },
    en: {
      label: "Missed the spoken change",
      advice: "The document was revised aloud. What was said later wins over what is printed.",
      verdict: "That is the printed value, before it was changed",
    },
  },
  wrong_timeframe: {
    rudeness: 0,
    miss: 2,
    manner: false,
    ja: {
      label: "時期を取り違えた",
      advice: "もう終わったことと、これからのことを区別しましょう。「済み」「予定」「来週」など時を表す言葉に注意。",
      verdict: "終わったことと、これからのことを取り違えていました",
    },
    en: {
      label: "Wrong time frame",
      advice: "Separate what is done from what is planned, and watch the words that say when.",
      verdict: "Done and planned got mixed up",
    },
  },

  // 総合聴読解 and 総合読解: the right source, joined to the wrong question.
  combines_wrong_pair: {
    rudeness: 0,
    miss: 3,
    manner: false,
    ja: {
      label: "組み合わせがちがう",
      advice: "資料は合っていますが、会話の別の部分と組み合わせています。どの発言がどの資料の話かを確かめましょう。",
      verdict: "資料と会話の、組み合わせがずれていました",
    },
    en: {
      label: "Wrong pairing",
      advice: "Right document, wrong part of the conversation. Match each remark to the document it is about.",
      verdict: "The document was paired with the wrong remark",
    },
  },
  stated_but_answers_different_question: {
    rudeness: 0,
    miss: 2,
    manner: false,
    ja: {
      label: "質問の答えではない",
      advice: "本文に書いてある内容ですが、この質問の答えではありません。質問が何を聞いているかを先に確かめましょう。",
      verdict: "本文にはありますが、聞かれていることの答えではありませんでした",
    },
    en: {
      label: "True, but not the question",
      advice: "It is in the passage, but it is not what the question asks.",
      verdict: "True, but it answers a different question",
    },
  },

  register_too_casual: {
    rudeness: 3,
    miss: 1,
    ja: {
      label: "砕けすぎ",
      advice: "内容は合っています。相手との距離に合わせて言い方だけを上げましょう。",
      verdict: "相手には、くだけすぎでした",
    },
    en: {
      label: "Too casual",
      advice: "The content is right. Only the register needs raising to match the distance.",
      verdict: "Too casual for them",
    },
  },
  wrong_uchi_soto: {
    rudeness: 2,
    miss: 2,
    ja: {
      label: "ウチ・ソトの誤り",
      advice: "社外の相手には、自分の会社の人は呼び捨て・謙譲語です。",
      verdict: "相手の前で、身内を高めてしまいました",
    },
    en: {
      label: "In-group / out-group mix-up",
      advice: "To an outsider, your own company's people get plain names and humble forms.",
      verdict: "You elevated your own side in front of them",
    },
  },
  wrong_honorific_direction: {
    rudeness: 2,
    miss: 2,
    ja: {
      label: "敬意の向きが逆",
      advice: "その動作をするのは誰か。自分なら謙譲語、相手なら尊敬語です。",
      verdict: "敬意の向きが、逆でした",
    },
    en: {
      label: "Honorific pointed the wrong way",
      advice: "Who does the action? Humble for yourself, respectful for them.",
      verdict: "The honorific pointed the wrong way",
    },
  },
  set_phrase_wrong_situation: {
    rudeness: 2,
    miss: 3,
    ja: {
      label: "場面違いの決まり文句",
      advice: "言葉自体は正しいものです。使う場面と時点を思い出しましょう。",
      verdict: "決まり文句の、場面がちがいました",
    },
    en: {
      label: "Set phrase, wrong moment",
      advice: "The phrase is real. Recall when and where it is used.",
      verdict: "Right phrase, wrong moment",
    },
  },
  over_polite_misfit: {
    rudeness: 1,
    miss: 2,
    ja: {
      label: "敬語の重ねすぎ",
      advice: "丁寧にしようとしすぎです。敬語は一動作に一つで足ります。",
      verdict: "丁寧にしすぎて、不自然でした",
    },
    en: {
      label: "Stacked honorifics",
      advice: "Trying too hard. One honorific per action is enough.",
      verdict: "So polite it became unnatural",
    },
  },
  phone_protocol_violation: {
    rudeness: 1,
    miss: 3,
    ja: {
      label: "電話の型から外れる",
      advice: "電話は順番が決まっています。あいさつ、名乗り、用件の順です。",
      verdict: "電話の順番が、くずれました",
    },
    en: {
      label: "Broke the phone pattern",
      advice: "Phone calls have an order: greeting, name, then the matter.",
      verdict: "The phone order broke down",
    },
  },
  wrong_speech_act: {
    rudeness: 0,
    miss: 3,
    ja: {
      label: "したいことが違う",
      advice: "敬語は正しいのに、依頼・申し出・報告のどれかがずれています。",
      verdict: "言い方は丁寧でも、したいことがちがいました",
    },
    en: {
      label: "Wrong kind of act",
      advice: "The keigo is right, but request, offer and report got mixed up.",
      verdict: "Polite, but it did the wrong thing",
    },
  },
  content_mismatch: {
    rudeness: 0,
    miss: 3,
    ja: {
      label: "答えになっていない",
      advice: "丁寧ですが、相手が知りたいことを返せていません。",
      verdict: "相手が知りたいことに、答えていませんでした",
    },
    en: {
      label: "Didn't answer the question",
      advice: "Polite, but it doesn't give them what they asked for.",
      verdict: "It didn't answer what they wanted to know",
    },
  },

  // The text-only types keep their own enums.
  opposite_valence: {
    rudeness: 2,
    miss: 3,
    ja: { label: "意味が逆", advice: "語の意味の向きが逆です。", verdict: "意味が、逆になっていました" },
    en: { label: "Opposite meaning", advice: "The word points the wrong way.", verdict: "It meant the opposite" },
  },
  wrong_grammatical_category: {
    rudeness: 0,
    miss: 3,
    ja: { label: "品詞が合わない", advice: "その位置には入らない形です。", verdict: "その位置には入らない形でした" },
    en: { label: "Wrong part of speech", advice: "That form cannot go in that slot.", verdict: "That form can't go in that slot" },
  },
  nonexistent_form: {
    rudeness: 0,
    miss: 3,
    ja: { label: "存在しない形", advice: "それらしく見えますが、実在しない語です。", verdict: "実在しない語でした" },
    en: { label: "Not a real form", advice: "It looks plausible, but the word doesn't exist.", verdict: "That word doesn't exist" },
  },
  real_form_wrong_context: {
    rudeness: 0,
    miss: 3,
    ja: {
      label: "使える場面が違う",
      advice: "実在する表現ですが、条件が合いません。",
      verdict: "実在する表現ですが、ここでは使えませんでした",
    },
    en: {
      label: "Real form, wrong context",
      advice: "A real expression, but the conditions don't fit.",
      verdict: "A real expression, but not one that fits here",
    },
  },
  set_phrase_misfit: {
    rudeness: 1,
    miss: 3,
    ja: {
      label: "定型句の誤用",
      advice: "あいさつの定型を文法の位置に入れています。",
      verdict: "定型句の使い方が、ちがいました",
    },
    en: {
      label: "Misused set phrase",
      advice: "A greeting formula in a grammar slot.",
      verdict: "A set phrase in the wrong place",
    },
  },
  register_insulting: {
    rudeness: 3,
    miss: 2,
    ja: {
      label: "相手を下に見た言い方",
      advice: "文法は正しくても、相手を低く扱っています。",
      verdict: "相手を、下に見る言い方でした",
    },
    en: {
      label: "Talks down to them",
      advice: "Grammatical, but it places them beneath you.",
      verdict: "It talked down to them",
    },
  },
  correct_keigo_wrong_speech_act: {
    rudeness: 0,
    miss: 3,
    ja: {
      label: "したいことが違う",
      advice: "敬語は正しいのに、発話の目的がずれています。",
      verdict: "敬語は正しくても、したいことがちがいました",
    },
    en: {
      label: "Wrong kind of act",
      advice: "The keigo is right; the purpose of the utterance isn't.",
      verdict: "Right keigo, wrong kind of act",
    },
  },
};

export function roleInfo(role: string | null | undefined, lang: Lang = "ja"): RoleInfo {
  const entry = (role && (ROLES as Record<string, Entry>)[role]) || DEFAULT;
  const words = entry[lang];
  return {
    label: words.label,
    rudeness: entry.rudeness,
    miss: entry.miss,
    manner: entry.manner ?? true,
    advice: words.advice,
    verdict: words.verdict,
  };
}

/**
 * The sentence said first. 「上司には、くだけすぎでした」 — who, and what.
 *
 * The listener is the item's own role name, and it is Japanese (「取引先の担当者」).
 * Spliced into an English sentence it would read "Too casual for 取引先の担当者",
 * and English needs "they" in one place and "them" in another besides. So the
 * English sentences say "them" / "they" as written, and the listener follows
 * in brackets — only for a role whose sentence is about who the words landed
 * on, which is the ones whose Japanese names 相手.
 */
export function verdictFor(
  role: string | null | undefined,
  listener: string | null | undefined,
  lang: Lang = "ja"
): string {
  const who = listener?.trim();
  const ja = roleInfo(role, "ja").verdict;
  if (lang === "ja") return ja.split("相手").join(who || "相手");
  const en = roleInfo(role, "en").verdict;
  return who && ja.includes("相手") ? `${en} (${who})` : en;
}

/** The headline for a whole session: the trap that caught them most. */
export function worstTrap(roles: string[]): { role: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const r of roles) {
    if (r === "correct") continue;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  let best: { role: string; count: number } | null = null;
  for (const [role, count] of counts) {
    if (!best || count > best.count) best = { role, count };
  }
  return best;
}
