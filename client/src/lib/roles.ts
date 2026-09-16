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
 */
import type { Lang } from "./i18n";

export type RoleInfo = {
  label: string;
  /** 0–3. How much damage this does to the relationship. */
  rudeness: number;
  /** 0–3. How far it is from what the situation actually asked for. */
  miss: number;
  /** One line of advice, shown under the meter. */
  advice: string;
  /** The one sentence said first after a wrong answer. 「相手」 / "them" is
   *  replaced with who they were talking to, when the item says. */
  verdict: string;
};

type Entry = {
  rudeness: number;
  miss: number;
  ja: { label: string; advice: string; verdict?: string };
  en: { label: string; advice: string; verdict?: string };
};

const DEFAULT: Entry = {
  rudeness: 1,
  miss: 2,
  ja: { label: "この場面に合わない", advice: "場面と相手をもう一度確かめましょう。" },
  en: { label: "Doesn't fit the scene", advice: "Check the situation and the listener again." },
};

const ROLES: Record<string, Entry> = {
  correct: { rudeness: 0, miss: 0, ja: { label: "正解", advice: "" }, en: { label: "Correct", advice: "" } },

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
      verdict: "Too casual for 相手",
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
      verdict: "You elevated your own side in front of 相手",
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
      verdict: "It didn't answer what 相手 wanted to know",
    },
  },

  // The text-only types keep their own enums.
  opposite_valence: {
    rudeness: 2, miss: 3,
    ja: { label: "意味が逆", advice: "語の意味の向きが逆です。" },
    en: { label: "Opposite meaning", advice: "The word points the wrong way." },
  },
  wrong_grammatical_category: {
    rudeness: 0, miss: 3,
    ja: { label: "品詞が合わない", advice: "その位置には入らない形です。" },
    en: { label: "Wrong part of speech", advice: "That form cannot go in that slot." },
  },
  nonexistent_form: {
    rudeness: 0, miss: 3,
    ja: { label: "存在しない形", advice: "それらしく見えますが、実在しない語です。" },
    en: { label: "Not a real form", advice: "It looks plausible, but the word doesn't exist." },
  },
  real_form_wrong_context: {
    rudeness: 0, miss: 3,
    ja: { label: "使える場面が違う", advice: "実在する表現ですが、条件が合いません。" },
    en: { label: "Real form, wrong context", advice: "A real expression, but the conditions don't fit." },
  },
  set_phrase_misfit: {
    rudeness: 1, miss: 3,
    ja: { label: "定型句の誤用", advice: "あいさつの定型を文法の位置に入れています。" },
    en: { label: "Misused set phrase", advice: "A greeting formula in a grammar slot." },
  },
  register_insulting: {
    rudeness: 3, miss: 2,
    ja: { label: "相手を下に見た言い方", advice: "文法は正しくても、相手を低く扱っています。" },
    en: { label: "Talks down to them", advice: "Grammatical, but it places them beneath you." },
  },
  correct_keigo_wrong_speech_act: {
    rudeness: 0, miss: 3,
    ja: { label: "したいことが違う", advice: "敬語は正しいのに、発話の目的がずれています。" },
    en: { label: "Wrong kind of act", advice: "The keigo is right; the purpose of the utterance isn't." },
  },
};

export function roleInfo(role: string | null | undefined, lang: Lang = "ja"): RoleInfo {
  const entry = (role && ROLES[role]) || DEFAULT;
  const words = entry[lang];
  return {
    label: words.label,
    rudeness: entry.rudeness,
    miss: entry.miss,
    advice: words.advice,
    verdict: words.verdict ?? (lang === "ja" ? `${words.label}でした` : words.label),
  };
}

/** The sentence said first. 「上司には、くだけすぎでした」 — who, and what. */
export function verdictFor(
  role: string | null | undefined,
  listener: string | null | undefined,
  lang: Lang = "ja"
): string {
  const who = listener?.trim() || (lang === "ja" ? "相手" : "them");
  return roleInfo(role, lang).verdict.split("相手").join(who);
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
