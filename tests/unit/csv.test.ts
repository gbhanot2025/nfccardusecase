import { describe, expect, it } from "vitest";
import { toCsv } from "@/app/admin/IssuedSheet";

describe("batch CSV", () => {
  it("has a header row and one quoted row per tag", () => {
    const csv = toCsv({
      batchId: "b_abc",
      label: "Pilot",
      labels: [
        {
          tagId: "t1",
          publicCode: "P1",
          claimCode: "ABCDE-12345",
          nfcUrl: "https://x.test/t/t1",
          qrUrl: "https://x.test/q/P1",
          qrSvg: "<svg/>",
        },
      ],
    });
    expect(csv.split("\r\n")).toEqual([
      "batch_id,tag_id,public_code,nfc_url,qr_url,claim_code",
      '"b_abc","t1","P1","https://x.test/t/t1","https://x.test/q/P1","ABCDE-12345"',
      "",
    ]);
  });
});
