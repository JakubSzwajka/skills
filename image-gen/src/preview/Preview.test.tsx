import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AssetView } from "../app/types";
import { Preview } from "./Preview";

vi.mock("../app/api", () => ({
  fileSrc: (path: string) => path,
}));

const asset: AssetView = {
  id: "asset-1",
  kind: "generated",
  path: "/images/result.png",
  thumbnailPath: "/images/result-thumb.png",
  mediaType: "image/png",
  width: 1024,
  height: 1024,
  byteSize: 2048,
  sha256: "hash",
  createdAt: 1,
};

describe("Preview", () => {
  it("renders an accessible modal with a keyboard-accessible close control", () => {
    const html = renderToStaticMarkup(
      <Preview
        target={{ asset, job: null }}
        onClose={() => undefined}
        onUseReference={() => undefined}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Image preview"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain(">Close</button>");
  });
});
