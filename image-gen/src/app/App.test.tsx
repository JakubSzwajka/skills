import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("keeps composer before library in visual and keyboard order", () => {
    const html = renderToStaticMarkup(<App />);
    const composerPosition = html.indexOf('class="studio-rail"');
    const libraryPosition = html.indexOf('class="studio-library"');

    expect(composerPosition).toBeGreaterThan(-1);
    expect(libraryPosition).toBeGreaterThan(composerPosition);
  });
});
