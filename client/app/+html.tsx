/**
 * The page the web build lives in.
 *
 * Expo Router writes one of these by default; this one exists to say four
 * things about the page that the app's own components cannot, because they
 * are properties of the document rather than of anything drawn in it:
 *
 *   - the page is Japanese (`lang`), so the browser picks Japanese glyph
 *     forms for kanji the CJK scripts share, and hyphenates and wraps as
 *     Japanese;
 *   - the typeface is the platform's own Japanese face, in a stated order
 *     (see `fontStack` in ui/theme.ts), smoothed the way native text is;
 *   - the page is the app's background colour *before* the bundle arrives,
 *     and the browser chrome is tinted to match, so a cold start is a quiet
 *     violet-grey rather than a white flash and then the app;
 *   - a tap does not flash the grey rectangle a phone browser draws on
 *     anything clickable, and the page does not rubber-band past its edges
 *     — both of which are the browser reminding you this is a web page.
 *
 * Everything the default page had is kept: the reset for a root ScrollView,
 * the viewport, and the nodes the router hands in through
 * `useServerDocumentContext` (the title, the favicon, the injected styles).
 */
import { ScrollViewStyleReset, useServerDocumentContext } from "expo-router/html";
import React from "react";

import { colors, fontStack } from "../src/ui/theme";

const css = `
html {
  background-color: ${colors.bg};
  color: ${colors.text};
  font-family: ${fontStack};
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
  overscroll-behavior: none;
}
/* React Native Web sets a font on every top-level Text; this puts the
   page's face under it, at one step more specificity than a class. */
div[dir="auto"], input, textarea, button {
  font-family: inherit;
}
/* The one focus style, for keyboard users: the accent, two pixels out, on
   the element that has focus and nothing that was merely clicked. */
:focus-visible {
  outline: 2px solid ${colors.accent};
  outline-offset: 2px;
  border-radius: 6px;
}
`;

export default function Root({ children }: { children: React.ReactNode }) {
  const { bodyAttributes, bodyNodes, htmlAttributes, headNodes } = useServerDocumentContext();
  return (
    <html lang="ja" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="theme-color" content={colors.bg} />
        <meta name="color-scheme" content="light" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
