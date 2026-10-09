/**
 * The question itself, once the scene has been entered: what you read, then
 * what you hear.
 */
import { Text } from "react-native";

import type { QueuedItem } from "../../lib/types";
import { AutoPlaylist, DialoguePlayer } from "../audio";
import { Card } from "../components";
import { DocumentView } from "../document";
import { space, type } from "../theme";
import { SceneImage } from "./SceneCard";

export function StimulusCard({
  item,
  sceneImage,
  playlist,
  autoplay,
  stemAsText,
  dialogueAsText,
  audioFailed,
  onFinished,
  onFailed,
  onReplay,
}: {
  item: QueuedItem;
  sceneImage: string | null;
  /** Every clip of the item, in the order heard; empty when nothing plays. */
  playlist: string[];
  /** Play the run by itself: the listening stage has just been entered. */
  autoplay: boolean;
  stemAsText: boolean;
  dialogueAsText: boolean;
  audioFailed: boolean;
  onFinished: () => void;
  onFailed: () => void;
  onReplay: () => void;
}) {
  return (
    <Card style={{ gap: space.md }}>
      {/* The same picture at the same size as on the scene card: a strip
          would crop the drawing to a band of ceiling. */}
      {sceneImage ? <SceneImage uri={sceneImage} /> : null}

      {/* The stimulus, in the order it is met: what you read, then what you
          hear. A document comes first because the audio usually revises it —
          hearing the change before reading the original teaches nothing. */}
      {item.documents?.map((doc, i) => (
        <DocumentView key={`${item.id}-doc-${i}`} doc={doc} />
      ))}

      {dialogueAsText ? <DialoguePlayer turns={item.dialogue} unplayable={audioFailed} /> : null}

      {playlist.length > 0 ? (
        <AutoPlaylist
          key={item.id}
          urls={playlist}
          autoplay={autoplay}
          onFinished={onFinished}
          onFailed={onFailed}
          onReplay={onReplay}
        />
      ) : null}

      {stemAsText ? <Text style={type.body}>{item.stem}</Text> : null}
    </Card>
  );
}
