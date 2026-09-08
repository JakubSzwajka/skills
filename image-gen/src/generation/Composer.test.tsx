import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Composer } from "./Composer";

function renderComposer() {
  return renderToStaticMarkup(
    <Composer
      seedReferences={[]}
      onSeedConsumed={() => undefined}
      onCreated={() => undefined}
    />,
  );
}

describe("Composer", () => {
  it("renders all generation controls before submission", () => {
    const html = renderComposer();

    expect(html).toContain("References");
    expect(html).toContain("Paste image");
    expect(html).toContain('rows="4"');
    expect(html).toContain("OpenAI");
    expect(html).toContain("Antigravity");
    expect(html).toContain("Images each");
    expect(html).toContain("2 providers × 1 image · 2 jobs");
    expect(html).toContain("Generate 2 images");
  });

  it("uses native button behavior for image-count choices", () => {
    const html = renderComposer();

    expect(html).toContain('role="group"');
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain('role="radio"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
  });
});
