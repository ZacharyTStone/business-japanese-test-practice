/**
 * Loading a set: the day, the levels, the pace, the numbers, and the questions.
 *
 * **The whole set is fetched up front.** One request for the questions, then no
 * network until the first answer — and the clips and pictures they need are
 * fetched straight after, while the first question is read. Someone practising
 * on the Yamanote line should not lose their set in a tunnel.
 */
import { clearPreloadedSource, preload } from "expo-audio";
import { useEffect, useRef, useState, type Dispatch, type RefObject } from "react";
import { Image, Platform } from "react-native";

import { flushAnswers } from "../../lib/answers";
import { setSize } from "../../lib/day";
import {
  audioSource,
  clipUrl,
  fetchDay,
  fetchOptionLabels,
  fetchPace,
  fetchProfile,
  fetchQueue,
  fetchSectionLevels,
  mayVeto,
  sceneUrl,
  startSession,
} from "../../lib/db";
import { examIsNear } from "../../lib/exam";
import type { TypePace } from "../../lib/pace";
import { playlistFor } from "../../lib/playlist";
import type { PracticeAction } from "../../lib/practice";
import { isConfigured } from "../../lib/api";
import type { QueuedItem, SectionLevel } from "../../lib/types";

export type PracticeLoad = {
  loaded: boolean;
  /** Why the set could not be loaded, as thrown; drawn through friendlyError. */
  error: unknown;
  /** Run the load again, after an error. */
  retry: () => void;
  /** Today's count when the day's ceiling had been reached; null otherwise. */
  blocked: number | null;
  /** Today's count as the day stood when the set was built, for the day's done
   *  screen if the database closes the day part-way through. */
  answeredAtLoad: number;
  /** What the exam affords each self-paced type, and whether this learner wants
   *  it counted. Both are furniture: if either fails to load the set is
   *  practised without a clock rather than not at all. */
  pace: Record<string, TypePace>;
  timed: boolean;
  /** 「いち」「に」「さん」「よん」, or null until all four are synthesised.
   *  Furniture too: without them the spoken options play unnumbered. */
  labels: string[] | null;
  /** Asked once per screen. False for every tester but the owner, and the
   *  server re-checks it, so this only decides whether a button is drawn. */
  canVeto: boolean;
  /** The three levels when the set began, read before the first answer so the
   *  result screen can name the section whose level moved. */
  levelsBefore: RefObject<SectionLevel[]>;
  /** The practice session this set's answers are filed under: a grouping
   *  label, started with the set so that the first answer already carries it,
   *  and only when there is a set to file. Null when it could not be made — a
   *  set without a label is still a set (see startSession). */
  sessionReady: RefObject<Promise<string | null> | null>;
};

export function usePracticeLoad(userId: string | null, dispatch: Dispatch<PracticeAction>): PracticeLoad {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** Bumped by "try again", which is what runs the load a second time. */
  const [attempt, setAttempt] = useState(0);
  const [blocked, setBlocked] = useState<number | null>(null);
  const [answeredAtLoad, setAnsweredAtLoad] = useState(0);
  const [pace, setPace] = useState<Record<string, TypePace>>({});
  const [timed, setTimed] = useState(false);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [canVeto, setCanVeto] = useState(false);
  const levelsBefore = useRef<SectionLevel[]>([]);
  const sessionReady = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    if (!isConfigured || !userId) return;
    let cancelled = false;
    /** Every clip the set will play, fetched as soon as the set is known, and
     *  let go when the screen is. */
    const warmed: string[] = [];
    (async () => {
      try {
        // Anything a previous set could not send goes first, so the day's count
        // read next already includes it.
        await flushAnswers(userId);
        const [day, levels, profile, paces, spokenLabels] = await Promise.all([
          fetchDay(),
          fetchSectionLevels(),
          // The clock is furniture. A set that cannot be timed is still a set,
          // so neither of these is allowed to fail the screen. Nor are the
          // spoken numbers, which are the same four clips for every item.
          fetchProfile().catch(() => null),
          fetchPace().catch(() => ({}) as Record<string, TypePace>),
          fetchOptionLabels().catch(() => null),
        ]);
        levelsBefore.current = levels;
        setPace(paces);
        // In the last two weeks before the exam date the reading clock runs
        // whatever the setting says: that is when exam pace is the thing left
        // to practise. The account screen says so beside the switch.
        setTimed((profile?.timed_reading ?? false) || examIsNear(profile?.exam_date));
        setLabels(spokenLabels);
        // What the day has left of its set, or the bonus set (lib/day.ts). Zero
        // means the day is over, and the database would serve nothing anyway —
        // the screen says so.
        const remaining = setSize(day);
        setAnsweredAtLoad(day.answered_today);
        setBlocked(remaining <= 0 ? day.answered_today : null);
        const queue = remaining > 0 ? await fetchQueue(remaining) : [];
        if (cancelled) return;
        // Started now rather than after the set is on screen, so an answer
        // given at once still has it to carry; the answer waits for it. None
        // for a set with nothing in it — there is nothing to group.
        if (queue.length > 0) {
          sessionReady.current = startSession(userId).catch(() => null);
        }
        dispatch({ type: "loaded", items: queue, now: Date.now() });
        setLoaded(true);
        warmed.push(...warm(queue, spokenLabels));
        mayVeto().then(setCanVeto).catch(() => setCanVeto(false));
      } catch (e) {
        if (!cancelled) setError(e ?? new Error("load failed"));
      }
    })();
    return () => {
      cancelled = true;
      for (const url of warmed) {
        try {
          void Promise.resolve(clearPreloadedSource(audioSource(url))).catch(() => undefined);
        } catch {
          // Nothing held for it.
        }
      }
    };
    // `dispatch` is a reducer's, the same function for the life of the screen.
  }, [userId, attempt, dispatch]);

  const retry = () => {
    setError(null);
    setAttempt((n) => n + 1);
  };

  return {
    loaded,
    error,
    retry,
    blocked,
    answeredAtLoad,
    pace,
    timed,
    labels,
    canVeto,
    levelsBefore,
    sessionReady,
  };
}

/**
 * The set's sound and pictures, fetched while the first question is read.
 * Returns the clips it asked for, so they can be let go with the screen.
 *
 * Each clip is its own player, made when the one before it ends, so a clip
 * that is only fetched then leaves a gap between two turns of a conversation
 * as long as the connection is slow — and on a train, a gap that never ends.
 * The whole set was fetched up front so that a tunnel does not lose it; this
 * is the same promise kept for what it plays and shows.
 */
function warm(queue: QueuedItem[], spokenLabels: string[] | null): string[] {
  const urls = new Set<string>();
  for (const it of queue) {
    for (const url of playlistFor(it, spokenLabels, clipUrl)) urls.add(url);
    const scene = sceneUrl(it.scene_image_path);
    // On the web only: a prefetch cannot carry the sign-in token a native
    // build needs (lib/db/media.ts), so there the picture loads when shown.
    if (scene && Platform.OS === "web") Image.prefetch(scene).catch(() => false);
  }
  const asked: string[] = [];
  for (const url of urls) {
    try {
      void Promise.resolve(preload(audioSource(url))).catch(() => undefined);
      asked.push(url);
    } catch {
      // No preloading here: the clip is fetched when it plays, as before.
    }
  }
  return asked;
}
