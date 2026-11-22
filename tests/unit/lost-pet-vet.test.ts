import { describe, expect, it } from "vitest";
import { validateLostPetData } from "@/profile-types/lost_pet/schema";

describe("lost pet vet clinic", () => {
  it("can't be used to publish the owner's own phone number or email", () => {
    expect(validateLostPetData({ vetName: "Call me 07700 900123" }).success).toBe(false);
    expect(validateLostPetData({ vetName: "owner@example.com" }).success).toBe(false);
    expect(validateLostPetData({ vetName: "Riverside Vets" }).success).toBe(true);
  });
});
