import { describe, expect, it } from "vitest";
import { businessCardSchema, type BusinessCardData } from "@/profile-types/business_card/schema";
import {
  VCARD_MAX_PHOTO_BYTES,
  buildVCard,
  escapeText,
  foldLine,
  vcardFilename,
} from "@/profile-types/business_card/vcard";

const REV = new Date("2026-01-02T03:04:05.678Z");
const encoder = new TextEncoder();

/** Undoes RFC 2426 folding and splits into content lines. */
function unfold(vcard: string): string[] {
  return vcard
    .replace(/\r\n[ \t]/g, "")
    .split("\r\n")
    .filter((l) => l !== "");
}

function propertyNames(vcard: string): string[] {
  return unfold(vcard).map((l) => l.split(/[:;]/)[0]);
}

const full: BusinessCardData = businessCardSchema.parse({
  name: "Jane Q. Doe",
  title: "Head of Product",
  company: "Acme, Inc.; Widgets",
  bio: "Builds things.\nLikes tea.",
  phones: [
    { label: "mobile", number: "+44 20 7946 0958" },
    { label: "work", number: "+1 415 555 2671" },
  ],
  emails: [{ label: "work", address: "jane@acme.example" }],
  website: "https://jane.example",
  companyUrl: "https://acme.example/about",
  socials: [{ network: "linkedin", url: "https://www.linkedin.com/in/jane" }],
});

describe("buildVCard", () => {
  it("produces a vCard 3.0 with CRLF line endings", () => {
    const vcard = buildVCard(full, { revision: REV });
    expect(vcard.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(vcard.endsWith("END:VCARD\r\n")).toBe(true);
    expect(vcard.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(unfold(vcard)).toEqual([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Doe;Jane Q.;;;",
      "FN:Jane Q. Doe",
      "ORG:Acme\\, Inc.\\; Widgets",
      "TITLE:Head of Product",
      "TEL;TYPE=CELL,VOICE:+44 20 7946 0958",
      "TEL;TYPE=WORK,VOICE:+1 415 555 2671",
      "EMAIL;TYPE=INTERNET,WORK:jane@acme.example",
      "URL:https://jane.example/",
      "item1.URL:https://acme.example/about",
      "item1.X-ABLabel:Company",
      "item2.URL:https://www.linkedin.com/in/jane",
      "item2.X-ABLabel:LinkedIn",
      "NOTE:Builds things.\\nLikes tea.",
      "REV:2026-01-02T03:04:05Z",
      "END:VCARD",
    ]);
  });

  it("handles an empty profile (FN and N are always present)", () => {
    expect(unfold(buildVCard({}, { revision: REV }))).toEqual([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:;;;;",
      "FN:Contact",
      "REV:2026-01-02T03:04:05Z",
      "END:VCARD",
    ]);
  });

  it("uses the given name only when the name is a single word", () => {
    expect(unfold(buildVCard({ name: "Cher" }, { revision: REV }))).toContain("N:;Cher;;;");
  });

  it("escapes backslash, comma, semicolon and newlines", () => {
    expect(escapeText("a\\b,c;d\ne\r\nf\rg")).toBe("a\\\\b\\,c\\;d\\ne\\nf\\ng");
    expect(escapeText("x y")).toBe("x\\ny");
    expect(escapeText("tab\there\u0000")).toBe("tabhere");
  });

  it("makes newline injection into extra properties impossible", () => {
    // Bypass the schema on purpose: the builder must be safe even if handed unvalidated data.
    const evil = {
      name: "Eve\r\nEMAIL:attacker@evil.example\r\nX-INJECTED:1",
      title: "T\nURL:https://evil.example",
      company: "C\rTEL:+10000000000",
      bio: "B\r\n\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:Second",
      phones: [{ label: "mobile", number: "+1555\r\nX-PHONE:1" }],
      emails: [{ label: "work\r\nX-LABEL:1", address: "a@b.example\nX-EMAIL:1" }],
      website: "https://ok.example/\r\nX-URL:1",
      socials: [{ network: "github", url: "https://github.com/x\nX-SOCIAL:1" }],
    } as unknown as BusinessCardData;
    const vcard = buildVCard(evil, { revision: REV });
    expect(propertyNames(vcard)).toEqual([
      "BEGIN",
      "VERSION",
      "N",
      "FN",
      "ORG",
      "TITLE",
      "TEL",
      "EMAIL",
      "URL",
      "item1.URL",
      "item1.X-ABLabel",
      "NOTE",
      "REV",
      "END",
    ]);
    const lines = unfold(vcard);
    expect(lines.filter((l) => l === "BEGIN:VCARD")).toHaveLength(1);
    expect(lines.filter((l) => l === "END:VCARD")).toHaveLength(1);
    expect(lines).toContain("NOTE:B\\n\\nEND:VCARD\\nBEGIN:VCARD\\nFN:Second");
    // Every physical line is either a property or a fold continuation (leading space).
    for (const line of vcard.split("\r\n").filter(Boolean)) {
      expect(line).toMatch(/^( |[A-Za-z0-9.-]+[:;])/);
    }
  });

  it("percent-encodes separators in URIs", () => {
    const vcard = buildVCard({ website: "https://a.example/x,y;z" }, { revision: REV });
    expect(unfold(vcard)).toContain("URL:https://a.example/x%2Cy%3Bz");
  });

  it("folds lines longer than 75 octets and unfolds back to the original", () => {
    const bio = "word ".repeat(80).trim();
    const vcard = buildVCard({ name: "Jane", bio }, { revision: REV });
    for (const line of vcard.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(unfold(vcard)).toContain(`NOTE:${bio}`);
  });

  it("folds by UTF-8 octets without splitting multi-byte characters", () => {
    const name = "Zoë 名前 Ñandú 😀".repeat(6);
    const line = `FN:${escapeText(name)}`;
    const folded = foldLine(line);
    const physical = folded.split("\r\n");
    expect(physical.length).toBeGreaterThan(1);
    for (const [i, l] of physical.entries()) {
      expect(encoder.encode(l).length).toBeLessThanOrEqual(75);
      if (i > 0) expect(l.startsWith(" ")).toBe(true);
      expect(l).not.toMatch(/[\uD800-\uDBFF]$|^ ?[\uDC00-\uDFFF]/); // no split surrogate pairs
      expect(l).not.toContain("�");
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("leaves short lines alone", () => {
    expect(foldLine("FN:Jane")).toBe("FN:Jane");
    const exactly75 = `NOTE:${"a".repeat(70)}`;
    expect(foldLine(exactly75)).toBe(exactly75);
    expect(foldLine(`${exactly75}b`).split("\r\n")).toEqual([exactly75, " b"]);
  });

  it("embeds a JPEG/PNG photo as base64", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const vcard = buildVCard({ name: "Jane" }, { photo: { bytes, mimeType: "image/jpeg" }, revision: REV });
    expect(unfold(vcard)).toContain(`PHOTO;ENCODING=b;TYPE=JPEG:${Buffer.from(bytes).toString("base64")}`);

    const big = new Uint8Array(3000).fill(7);
    const withPng = buildVCard({ name: "Jane" }, { photo: { bytes: big, mimeType: "image/png" }, revision: REV });
    const photoLine = unfold(withPng).find((l) => l.startsWith("PHOTO"));
    expect(photoLine).toBe(`PHOTO;ENCODING=b;TYPE=PNG:${Buffer.from(big).toString("base64")}`);
    for (const line of withPng.split("\r\n")) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
  });

  it("leaves out photos with unsupported types or that are too large", () => {
    const svg = buildVCard(
      { name: "Jane" },
      { photo: { bytes: encoder.encode("<svg/>"), mimeType: "image/svg+xml" }, revision: REV },
    );
    expect(svg).not.toContain("PHOTO");
    const huge = buildVCard(
      { name: "Jane" },
      { photo: { bytes: new Uint8Array(VCARD_MAX_PHOTO_BYTES + 1), mimeType: "image/jpeg" }, revision: REV },
    );
    expect(huge).not.toContain("PHOTO");
  });

  it("keeps UTF-8 text intact", () => {
    const vcard = buildVCard({ name: "José Müller", company: "Café Zoë" }, { revision: REV });
    expect(unfold(vcard)).toEqual(expect.arrayContaining(["FN:José Müller", "N:Müller;José;;;", "ORG:Café Zoë"]));
  });
});

describe("vcardFilename", () => {
  it.each([
    [{ name: "Jane Doe" }, "jane-doe.vcf"],
    [{ name: "José Müller" }, "jose-muller.vcf"],
    [{ name: '"; rm -rf /\r\n' }, "rm-rf.vcf"],
    [{ name: "名前" }, "contact.vcf"],
    [{ company: "Acme, Inc." }, "acme-inc.vcf"],
    [{}, "contact.vcf"],
  ])("%j → %s", (data, expected) => {
    expect(vcardFilename(data as BusinessCardData)).toBe(expected);
  });
});
