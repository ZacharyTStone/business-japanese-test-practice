/**
 * What a screen shows instead of itself when it throws while drawing.
 *
 * Without a boundary, one bad row — a question whose document has a block
 * nobody anticipated, a field the database stopped sending — takes the whole
 * app down to a white page, and on a phone the only way out is to kill it.
 * expo-router catches the throw at the nearest route that exports an
 * `ErrorBoundary` and renders that instead; each route here exports
 * `ScreenCrash`, so a failure stays on its own screen with the navigator still
 * standing around it. The root layout's is the last resort, for a failure the
 * navigator itself did not survive.
 *
 * Two ways on, and neither a dead end: draw the screen again, or go home. The
 * sentence is the friendly one; the technical text is in small print, for
 * whoever the learner sends a screenshot to.
 */
import { router, type ErrorBoundaryProps } from "expo-router";
import { Platform, View } from "react-native";

import { friendlyError } from "../lib/errors";
import { LangProvider, useLang } from "../lib/i18n";
import { Button, Notice, ScreenMessage } from "./components";
import { space } from "./theme";

function Crashed({ error, retry, root }: ErrorBoundaryProps & { root: boolean }) {
  const { t } = useLang();
  const { message, detail } = friendlyError(error, t);

  function home() {
    // Under the root layout there is no navigator left to ask. A browser can
    // start again from the address; a phone asks the router, which is above
    // the layout, and then draws the layout again at wherever it now is.
    if (root && Platform.OS === "web" && typeof window !== "undefined") {
      window.location.assign("/");
      return;
    }
    try {
      router.replace("/");
    } catch {
      // Nothing mounted to navigate: drawing again is all there is.
    }
    void retry();
  }

  return (
    <ScreenMessage>
      <Notice
        title={t("crash_title")}
        body={message}
        detail={detail}
        tone="warn"
        action={{ label: t("crash_again"), onPress: () => void retry() }}
      />
      <View style={{ gap: space.md }}>
        <Button label={t("to_home")} tone="secondary" onPress={home} />
      </View>
    </ScreenMessage>
  );
}

/** A route's boundary: its screen fails, the rest of the app stands. */
export function ScreenCrash(props: ErrorBoundaryProps) {
  return <Crashed {...props} root={false} />;
}

/** The root layout's boundary. The providers it would have drawn are gone
 *  with it, so the language comes back on its own here. */
export function RootCrash(props: ErrorBoundaryProps) {
  return (
    <LangProvider>
      <Crashed {...props} root />
    </LangProvider>
  );
}
