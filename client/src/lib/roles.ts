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

export type RoleInfo = {
  label: string;
  /** 0–3. How much damage this does to the relationship. */
  rudeness: number;
  /** 0–3. How far it is from what the situation actually asked for. */
  miss: number;
  /** One line of advice, shown under the meter. */
  advice: string;
  /** The one sentence said first after a wrong answer. 「相手」 is replaced with
   *  who they were talking to, when the item says. */
  verdict?: string;
};

const DEFAULT: RoleInfo = {
  label: "この場面に合わない",
  rudeness: 1,
  miss: 2,
  advice: "場面と相手をもう一度確かめましょう。",
};

export const ROLE_INFO: Record<string, RoleInfo> = {
  correct: { label: "正解", rudeness: 0, miss: 0, advice: "" },

  register_too_casual: {
    label: "砕けすぎ",
    rudeness: 3,
    miss: 1,
    advice: "内容は合っています。相手との距離に合わせて言い方だけを上げましょう。",
    verdict: "相手には、くだけすぎでした",
  },
  wrong_uchi_soto: {
    label: "ウチ・ソトの誤り",
    rudeness: 2,
    miss: 2,
    advice: "社外の相手には、自分の会社の人は呼び捨て・謙譲語です。",
    verdict: "相手の前で、身内を高めてしまいました",
  },
  wrong_honorific_direction: {
    label: "敬意の向きが逆",
    rudeness: 2,
    miss: 2,
    advice: "その動作をするのは誰か。自分なら謙譲語、相手なら尊敬語です。",
    verdict: "敬意の向きが、逆でした",
  },
  set_phrase_wrong_situation: {
    label: "場面違いの決まり文句",
    rudeness: 2,
    miss: 3,
    advice: "言葉自体は正しいものです。使う場面と時点を思い出しましょう。",
    verdict: "決まり文句の、場面がちがいました",
  },
  over_polite_misfit: {
    label: "敬語の重ねすぎ",
    rudeness: 1,
    miss: 2,
    advice: "丁寧にしようとしすぎです。敬語は一動作に一つで足ります。",
    verdict: "丁寧にしすぎて、不自然でした",
  },
  phone_protocol_violation: {
    label: "電話の型から外れる",
    rudeness: 1,
    miss: 3,
    advice: "電話は順番が決まっています。あいさつ、名乗り、用件の順です。",
    verdict: "電話の順番が、くずれました",
  },
  wrong_speech_act: {
    label: "したいことが違う",
    rudeness: 0,
    miss: 3,
    advice: "敬語は正しいのに、依頼・申し出・報告のどれかがずれています。",
    verdict: "言い方は丁寧でも、したいことがちがいました",
  },
  content_mismatch: {
    label: "答えになっていない",
    rudeness: 0,
    miss: 3,
    advice: "丁寧ですが、相手が知りたいことを返せていません。",
    verdict: "相手が知りたいことに、答えていませんでした",
  },

  // The text-only types keep their own enums; these appear once those ship.
  opposite_valence: { label: "意味が逆", rudeness: 2, miss: 3, advice: "語の意味の向きが逆です。" },
  wrong_grammatical_category: { label: "品詞が合わない", rudeness: 0, miss: 3, advice: "その位置には入らない形です。" },
  nonexistent_form: { label: "存在しない形", rudeness: 0, miss: 3, advice: "それらしく見えますが、実在しない語です。" },
  real_form_wrong_context: { label: "使える場面が違う", rudeness: 0, miss: 3, advice: "実在する表現ですが、条件が合いません。" },
  set_phrase_misfit: { label: "定型句の誤用", rudeness: 1, miss: 3, advice: "あいさつの定型を文法の位置に入れています。" },
  register_insulting: { label: "相手を下に見た言い方", rudeness: 3, miss: 2, advice: "文法は正しくても、相手を低く扱っています。" },
  correct_keigo_wrong_speech_act: { label: "したいことが違う", rudeness: 0, miss: 3, advice: "敬語は正しいのに、発話の目的がずれています。" },
};

/** The sentence said first. 「上司には、くだけすぎでした」 — who, and what. */
export function verdictFor(role: string | null | undefined, listener: string | null | undefined): string {
  const info = roleInfo(role);
  const who = listener?.trim() || "相手";
  const line = info.verdict ?? `${info.label}でした`;
  return line.replace("相手", who);
}

export function roleInfo(role: string | null | undefined): RoleInfo {
  if (!role) return DEFAULT;
  return ROLE_INFO[role] ?? DEFAULT;
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
